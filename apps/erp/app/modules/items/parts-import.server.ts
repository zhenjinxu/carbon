import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import mssql from "mssql";
import { upsertDocument } from "~/modules/documents";
import { getDatabaseClient } from "~/services/database.server";
import { stripSpecialCharacters } from "~/utils/string";
import {
  buildWholeBomFailures,
  type PartImportRow,
  type WholeBomFailure,
  type WholeBomImportPlan
} from "./parts-import";
import { u8MethodOperationId } from "./parts-import-identity.server";

type U8Item = {
  partId: string;
  code: string;
  name: string;
  specification: string | null;
  unitCode: string | null;
  isManufactured: boolean;
  isPurchased: boolean;
};

type U8Bom = {
  bomId: string;
  parentPartId: string;
  version: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type U8Edge = {
  opComponentId: string;
  bomId: string;
  parentPartId: string;
  childPartId: string;
  opSeq: string | null;
  sortSeq: number;
  quantity: number;
  childCode: string;
};

type U8RouteOperation = {
  routeId: string;
  opSeq: string;
  operationId: string;
  operationCode: string;
  description: string;
};

type U8Snapshot = {
  items: Map<string, U8Item>;
  boms: Map<string, U8Bom>;
  bomsByPartId: Map<string, U8Bom>;
  edges: U8Edge[];
  operationsByPartId: Map<string, U8RouteOperation[]>;
  missingCodes: string[];
};

const MAX_ROWS = 1000;
const MAX_BOM_DEPTH = 50;

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash("sha1")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function text(value: unknown, fallback: string | null = null) {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

function getU8Config() {
  const fallback = Object.assign(
    {},
    ...[
      process.env.U8_ENV_FILE,
      "/repo/.env.local",
      "/repo/.env",
      "D:/Object/0.1.7/.env"
    ]
      .filter((file): file is string => Boolean(file))
      .map(parseEnvFile)
  );
  const value = (key: string) => process.env[key] ?? fallback[key];
  const required = ["U8_SERVER", "U8_DATABASE", "U8_USER", "U8_PASSWORD"];
  for (const key of required) {
    if (!value(key)) throw new Error(`${key} is not configured`);
  }
  return {
    server: value("U8_SERVER")!,
    database: value("U8_DATABASE")!,
    user: value("U8_USER")!,
    password: value("U8_PASSWORD")!,
    port: Number(value("U8_PORT") ?? 1433),
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000,
    requestTimeout: 120000
  };
}

function bindIntList(
  request: { input: (...args: unknown[]) => unknown },
  values: string[],
  prefix: string
) {
  return values.map((value, index) => {
    const name = `${prefix}${index}`;
    request.input(name, mssql.Int, Number(value));
    return `@${name}`;
  });
}

async function loadU8Snapshot(codes: string[]): Promise<U8Snapshot> {
  const pool = await new mssql.ConnectionPool(getU8Config()).connect();
  try {
    const requestedCodes = [
      ...new Set(codes.map((code) => code.trim()).filter(Boolean))
    ];
    const partRequest = pool.request();
    const codeParams = requestedCodes.map((code, index) => {
      const name = `code${index}`;
      partRequest.input(name, mssql.NVarChar(255), code);
      return `@${name}`;
    });
    const partResult = await partRequest.query(
      `SELECT p.PartId, p.InvCode, i.cInvName, i.cInvStd, i.cComUnitCode, i.bSelf, i.bPurchase
       FROM dbo.bas_part p LEFT JOIN dbo.Inventory i ON i.cInvCode = p.InvCode
       WHERE p.InvCode IN (${codeParams.join(",")})`
    );

    const items = new Map<string, U8Item>();
    for (const row of partResult.recordset) {
      const code = text(row.InvCode);
      if (!code) continue;
      items.set(String(row.PartId), {
        partId: String(row.PartId),
        code,
        name: text(row.cInvName, code)!,
        specification: text(row.cInvStd),
        unitCode: text(row.cComUnitCode),
        isManufactured: row.bSelf === true || row.bSelf === 1,
        isPurchased: row.bPurchase === true || row.bPurchase === 1
      });
    }

    const missingCodes = requestedCodes.filter(
      (code) => ![...items.values()].some((item) => item.code === code)
    );
    const boms = new Map<string, U8Bom>();
    const bomsByPartId = new Map<string, U8Bom>();
    const edges: U8Edge[] = [];
    let pendingPartIds = [...items.keys()];
    const visitedPartIds = new Set<string>();

    for (
      let depth = 0;
      depth < MAX_BOM_DEPTH && pendingPartIds.length > 0;
      depth++
    ) {
      const partIds = pendingPartIds.filter(
        (partId) => !visitedPartIds.has(partId)
      );
      if (partIds.length === 0) break;
      partIds.forEach((partId) => {
        visitedPartIds.add(partId);
      });

      const bomRequest = pool.request();
      bomRequest.input("asOfDate", mssql.Date, new Date());
      const partParams = bindIntList(bomRequest, partIds, "part");
      const bomResult = await bomRequest.query(
        `WITH ranked AS (
          SELECT bp.ParentId, b.BomId, b.Version, b.VersionEffDate, b.VersionEndDate,
            ROW_NUMBER() OVER (PARTITION BY bp.ParentId ORDER BY COALESCE(b.VersionEffDate, '19000101') DESC, COALESCE(b.Version, 0) DESC, b.BomId DESC) rn
          FROM dbo.bom_parent bp JOIN dbo.bom_bom b ON b.BomId = bp.BomId
          WHERE b.Status = 3 AND bp.ParentId IN (${partParams.join(",")})
            AND (b.VersionEffDate IS NULL OR CAST(b.VersionEffDate AS date) <= @asOfDate)
            AND (b.VersionEndDate IS NULL OR CAST(b.VersionEndDate AS date) >= @asOfDate)
        ) SELECT * FROM ranked WHERE rn = 1`
      );

      const bomIds: string[] = [];
      for (const row of bomResult.recordset) {
        const bom: U8Bom = {
          bomId: String(row.BomId),
          parentPartId: String(row.ParentId),
          version: row.Version === null ? null : String(row.Version),
          effectiveFrom: row.VersionEffDate
            ? new Date(row.VersionEffDate).toISOString()
            : null,
          effectiveTo: row.VersionEndDate
            ? new Date(row.VersionEndDate).toISOString()
            : null
        };
        boms.set(bom.bomId, bom);
        bomsByPartId.set(bom.parentPartId, bom);
        bomIds.push(bom.bomId);
      }

      if (bomIds.length === 0) {
        pendingPartIds = [];
        continue;
      }

      const edgeRequest = pool.request();
      edgeRequest.input("asOfDate", mssql.Date, new Date());
      const bomParams = bindIntList(edgeRequest, bomIds, "bom");
      const edgeResult = await edgeRequest.query(
        `SELECT op.OpComponentId, op.BomId, bp.ParentId, op.SortSeq, op.OpSeq,
          op.ComponentId, p2.InvCode AS ChildCode, op.BaseQtyN, op.BaseQtyD
         FROM dbo.bom_opcomponent op
         JOIN dbo.bom_parent bp ON bp.BomId = op.BomId
         JOIN dbo.bas_part p2 ON p2.PartId = op.ComponentId
         WHERE op.BomId IN (${bomParams.join(",")})
           AND (op.EffBegDate IS NULL OR CAST(op.EffBegDate AS date) <= @asOfDate)
           AND (op.EffEndDate IS NULL OR CAST(op.EffEndDate AS date) >= @asOfDate)
         ORDER BY op.BomId, op.SortSeq, op.OpComponentId`
      );
      const nextPartIds = new Set<string>();
      for (const row of edgeResult.recordset) {
        const childPartId = String(row.ComponentId);
        const childCode = text(row.ChildCode);
        if (!childCode) continue;
        edges.push({
          opComponentId: String(row.OpComponentId),
          bomId: String(row.BomId),
          parentPartId: String(row.ParentId),
          childPartId,
          opSeq: text(row.OpSeq),
          sortSeq: Number(row.SortSeq ?? 0),
          quantity:
            Number(row.BaseQtyD || 0) === 0
              ? 0
              : Number(row.BaseQtyN || 0) / Number(row.BaseQtyD),
          childCode
        });
        nextPartIds.add(childPartId);
      }
      const childIds = [...nextPartIds].filter((partId) => !items.has(partId));
      if (childIds.length > 0) {
        const childRequest = pool.request();
        const childParams = bindIntList(childRequest, childIds, "child");
        const childResult = await childRequest.query(
          `SELECT p.PartId, p.InvCode, i.cInvName, i.cInvStd, i.cComUnitCode, i.bSelf, i.bPurchase
           FROM dbo.bas_part p LEFT JOIN dbo.Inventory i ON i.cInvCode = p.InvCode
           WHERE p.PartId IN (${childParams.join(",")})`
        );
        for (const row of childResult.recordset) {
          const code = text(row.InvCode);
          if (!code) continue;
          items.set(String(row.PartId), {
            partId: String(row.PartId),
            code,
            name: text(row.cInvName, code)!,
            specification: text(row.cInvStd),
            unitCode: text(row.cComUnitCode),
            isManufactured: row.bSelf === true || row.bSelf === 1,
            isPurchased: row.bPurchase === true || row.bPurchase === 1
          });
        }
      }
      pendingPartIds = [...nextPartIds];
    }

    const routePartIds = [...items.keys()];
    const operationsByPartId = new Map<string, U8RouteOperation[]>();
    if (routePartIds.length > 0) {
      const routeRequest = pool.request();
      const routeParams = bindIntList(routeRequest, routePartIds, "routePart");
      const routeResult = await routeRequest.query(
        `WITH ranked AS (
          SELECT spp.PartId, r.PRoutingId, r.Version,
            ROW_NUMBER() OVER (PARTITION BY spp.PartId ORDER BY COALESCE(r.Version, 0) DESC, r.PRoutingId DESC) rn
          FROM dbo.sfc_proutingpart spp JOIN dbo.sfc_prouting r ON r.PRoutingId = spp.PRoutingId
          WHERE r.Status = 3 AND spp.PartId IN (${routeParams.join(",")})
        ) SELECT PartId, PRoutingId FROM ranked WHERE rn = 1`
      );
      const routeIds = routeResult.recordset.map(
        (row: Record<string, unknown>) => String(row.PRoutingId)
      );
      if (routeIds.length > 0) {
        const detailRequest = pool.request();
        const detailParams = bindIntList(detailRequest, routeIds, "route");
        const detailResult = await detailRequest.query(
          `SELECT spp.PartId, d.PRoutingId, d.OpSeq, d.OperationId, o.OpCode, o.Description AS OpName, d.Description
           FROM dbo.sfc_proutingpart spp
           JOIN dbo.sfc_proutingdetail d ON d.PRoutingId = spp.PRoutingId
           JOIN dbo.sfc_operation o ON o.OperationId = d.OperationId
           WHERE d.PRoutingId IN (${detailParams.join(",")})
           ORDER BY spp.PartId, d.OpSeq`
        );
        const routePartById = new Map<string, string>(
          routeResult.recordset.map((row: Record<string, unknown>) => [
            String(row.PRoutingId),
            String(row.PartId)
          ])
        );
        for (const row of detailResult.recordset) {
          const partId = routePartById.get(String(row.PRoutingId));
          if (!partId) continue;
          const rows = operationsByPartId.get(partId) ?? [];
          rows.push({
            routeId: String(row.PRoutingId),
            opSeq: text(row.OpSeq, "")!,
            operationId: String(row.OperationId),
            operationCode: text(row.OpCode, `U8-${row.OperationId}`)!,
            description: text(
              row.OpName,
              text(row.Description, "U8 operation")!
            )!
          });
          operationsByPartId.set(partId, rows);
        }
      }
    }
    return {
      items,
      boms,
      bomsByPartId,
      edges,
      operationsByPartId,
      missingCodes
    };
  } finally {
    await pool.close();
  }
}

function methodTypeForItem(item: U8Item, hasBom: boolean) {
  if (hasBom && item.isPurchased) return "Buy and Make";
  if (hasBom || item.isManufactured) return "Make";
  return "Buy";
}

async function upsertItems(
  tx: Kysely<KyselyDatabase>,
  rows: Array<U8Item | PartImportRow>,
  companyId: string,
  userId: string,
  snapshot?: U8Snapshot
) {
  const u8ByCode = new Map(
    [...(snapshot?.items.values() ?? [])].map((item) => [item.code, item])
  );
  const values = rows.map((row) => {
    const u8 = u8ByCode.get(row.code);
    const code = row.code;
    const name = u8 ? u8.name : (row as PartImportRow).description;
    const notes = u8
      ? {
          u8: {
            partId: u8.partId,
            itemCode: u8.code,
            specification: u8.specification
          }
        }
      : undefined;
    const hasBom = Boolean(u8 && snapshot?.bomsByPartId.has(u8.partId));
    return {
      readableId: code,
      revision: "0",
      name,
      description: u8?.specification ?? (row as PartImportRow).description,
      type: "Part" as const,
      replenishmentSystem: u8 ? methodTypeForItem(u8, hasBom) : "Buy",
      defaultMethodType: u8
        ? hasBom || u8.isManufactured
          ? "Make to Order"
          : "Pull from Inventory"
        : "Pull from Inventory",
      itemTrackingType: "Inventory" as const,
      unitOfMeasureCode: "EA",
      active: true,
      companyId,
      createdBy: userId,
      updatedBy: userId,
      ...(notes ? { notes } : {})
    };
  });
  await tx
    .insertInto("item")
    .values(values as never)
    .onConflict((conflict) =>
      conflict.constraint("item_unique").doUpdateSet({
        name: sql`excluded."name"`,
        description: sql`excluded."description"`,
        replenishmentSystem: sql`excluded."replenishmentSystem"`,
        defaultMethodType: sql`excluded."defaultMethodType"`,
        unitOfMeasureCode: sql`excluded."unitOfMeasureCode"`,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .execute();

  const itemRows = await tx
    .selectFrom("item")
    .select(["id", "readableId"])
    .where("companyId", "=", companyId)
    .where("type", "=", "Part")
    .where("revision", "=", "0")
    .where(
      "readableId",
      "in",
      values.map((value) => value.readableId)
    )
    .execute();
  const itemIdByCode = new Map(itemRows.map((row) => [row.readableId, row.id]));
  const partRows = values.flatMap((value) => {
    const itemId = itemIdByCode.get(value.readableId);
    if (!itemId) return [];
    return [
      {
        id: itemId,
        companyId,
        createdBy: userId,
        updatedBy: userId,
        customFields: snapshot?.items
          ? { u8: { itemCode: value.readableId } }
          : undefined
      }
    ];
  });
  await tx
    .insertInto("part")
    .values(partRows as never)
    .onConflict((conflict) =>
      conflict
        .columns(["id", "companyId"])
        .doUpdateSet({ updatedBy: userId, updatedAt: new Date().toISOString() })
    )
    .execute();
  return itemIdByCode;
}

async function ensureProcesses(
  tx: Kysely<KyselyDatabase>,
  operations: U8RouteOperation[],
  companyId: string,
  userId: string
) {
  const unique = [
    ...new Map(
      operations.map((operation) => [operation.operationCode, operation])
    ).values()
  ];
  if (unique.length === 0) return new Map<string, string>();
  await tx
    .insertInto("process")
    .values(
      unique.map((operation) => ({
        id: stableId("u8proc", companyId, operation.operationId),
        name: `U8 ${operation.operationCode} ${operation.description}`.slice(
          0,
          255
        ),
        defaultStandardFactor: "Hours/Piece" as const,
        companyId,
        createdBy: userId,
        customFields: {
          u8OperationId: operation.operationId,
          u8OperationCode: operation.operationCode
        }
      })) as never
    )
    .onConflict((conflict) =>
      conflict
        .constraint("process_name_companyId_key")
        .doUpdateSet({ updatedBy: userId, updatedAt: new Date().toISOString() })
    )
    .execute();
  const names = unique.map((operation) =>
    `U8 ${operation.operationCode} ${operation.description}`.slice(0, 255)
  );
  const processRows = await tx
    .selectFrom("process")
    .select(["id", "name"])
    .where("companyId", "=", companyId)
    .where("name", "in", names)
    .execute();
  return new Map(processRows.map((row) => [row.name, row.id]));
}

export async function importPartsFromRows({
  rows,
  companyId,
  userId,
  enrichFromU8 = false
}: {
  rows: PartImportRow[];
  companyId: string;
  userId: string;
  enrichFromU8?: boolean;
}) {
  if (rows.length > MAX_ROWS)
    throw new Error(`Excel may contain at most ${MAX_ROWS} rows`);
  const snapshot = enrichFromU8
    ? await loadU8Snapshot(rows.map((row) => row.code))
    : undefined;
  const sourceRows = new Map<string, U8Item | PartImportRow>(
    rows.map((row) => [row.code, row])
  );
  for (const item of snapshot?.items.values() ?? []) {
    sourceRows.set(item.code, item);
  }
  const db = getDatabaseClient();
  return db.transaction().execute(async (tx) => {
    const itemIdByCode = await upsertItems(
      tx,
      [...sourceRows.values()],
      companyId,
      userId,
      snapshot
    );
    if (snapshot) {
      await importU8Methods(tx, snapshot, itemIdByCode, companyId, userId);
    }
    return {
      imported: rows.length,
      enriched: snapshot
        ? rows.filter((row) =>
            [...snapshot.items.values()].some((item) => item.code === row.code)
          ).length
        : 0,
      missingU8: snapshot?.missingCodes ?? []
    };
  });
}

export async function enrichPartsFromU8({
  itemIds,
  companyId,
  userId
}: {
  itemIds: string[];
  companyId: string;
  userId: string;
}) {
  const db = getDatabaseClient();
  const selected = await db
    .selectFrom("item")
    .select(["id", "readableId"])
    .where("id", "in", itemIds)
    .where("companyId", "=", companyId)
    .where("type", "=", "Part")
    .execute();
  const snapshot = await loadU8Snapshot(selected.map((row) => row.readableId));
  return db.transaction().execute(async (tx) => {
    const itemIdByCode = await upsertItems(
      tx,
      [...snapshot.items.values()],
      companyId,
      userId,
      snapshot
    );
    await importU8Methods(tx, snapshot, itemIdByCode, companyId, userId);
    return {
      enriched: selected.filter((row) =>
        [...snapshot.items.values()].some(
          (item) => item.code === row.readableId
        )
      ).length,
      missingU8: snapshot.missingCodes
    };
  });
}

async function importU8Methods(
  tx: Kysely<KyselyDatabase>,
  snapshot: U8Snapshot,
  itemIdByCode: Map<string, string>,
  companyId: string,
  userId: string
) {
  const methodPartIds = new Set([
    ...snapshot.bomsByPartId.keys(),
    ...snapshot.operationsByPartId.keys()
  ]);
  if (methodPartIds.size === 0) return;

  const methodRows = await tx
    .selectFrom("makeMethod")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("itemId", "in", [...itemIdByCode.values()])
    .execute();
  const methodsByItemId = new Map<string, (typeof methodRows)[number]>();
  for (const method of methodRows) {
    const current = methodsByItemId.get(method.itemId);
    if (
      !current ||
      (current.status !== "Active" && method.status === "Active")
    ) {
      methodsByItemId.set(method.itemId, method);
    }
  }

  const methodByPartId = new Map<string, string>();
  for (const partId of methodPartIds) {
    const item = snapshot.items.get(partId);
    const itemId = item ? itemIdByCode.get(item.code) : undefined;
    if (!itemId) continue;

    const bom = snapshot.bomsByPartId.get(partId);
    const route = snapshot.operationsByPartId.get(partId)?.[0];
    let method = methodsByItemId.get(itemId);
    if (!method) {
      const sourceId = bom?.bomId ?? route?.routeId ?? partId;
      const id = stableId("u8method", companyId, sourceId);
      await tx
        .insertInto("makeMethod")
        .values({
          id,
          itemId,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          version: Number(bom?.version ?? 1),
          status: "Draft",
          customFields: {
            u8: {
              ...(bom ? { bomId: bom.bomId, version: bom.version } : {}),
              ...(route ? { routeId: route.routeId } : {})
            }
          }
        } as never)
        .onConflict((conflict) => conflict.column("id").doNothing())
        .execute();
      method = await tx
        .selectFrom("makeMethod")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    }
    if (!method) continue;
    methodByPartId.set(partId, method.id);

    const currentCustomFields =
      method.customFields &&
      typeof method.customFields === "object" &&
      !Array.isArray(method.customFields)
        ? method.customFields
        : {};
    await tx
      .updateTable("makeMethod")
      .set({
        customFields: {
          ...currentCustomFields,
          u8: {
            ...(typeof currentCustomFields.u8 === "object" &&
            currentCustomFields.u8 &&
            !Array.isArray(currentCustomFields.u8)
              ? currentCustomFields.u8
              : {}),
            ...(bom
              ? {
                  bomId: bom.bomId,
                  version: bom.version,
                  effectiveFrom: bom.effectiveFrom,
                  effectiveTo: bom.effectiveTo
                }
              : {}),
            ...(route ? { routeId: route.routeId } : {})
          }
        },
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      } as never)
      .where("id", "=", method.id)
      .execute();
  }

  const allOperations = [...snapshot.operationsByPartId.values()].flat();
  const processIds = await ensureProcesses(
    tx,
    allOperations,
    companyId,
    userId
  );
  const operationByPartAndSeq = new Map<string, string>();
  for (const [partId, operations] of snapshot.operationsByPartId) {
    const methodId = methodByPartId.get(partId);
    if (!methodId) continue;
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index]!;
      const processName =
        `U8 ${operation.operationCode} ${operation.description}`.slice(0, 255);
      const processId = processIds.get(processName);
      if (!processId) continue;
      const id = u8MethodOperationId(companyId, operation);
      await tx
        .insertInto("methodOperation")
        .values({
          id,
          makeMethodId: methodId,
          order: index + 1,
          operationOrder: "After Previous",
          processId,
          description: operation.description,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          operationType: "Inside",
          customFields: {
            u8: {
              routeId: operation.routeId,
              operationId: operation.operationId,
              operationCode: operation.operationCode,
              opSeq: operation.opSeq
            }
          }
        } as never)
        .onConflict((conflict) =>
          conflict.column("id").doUpdateSet({
            description: operation.description,
            processId,
            order: index + 1,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          } as never)
        )
        .execute();
      operationByPartAndSeq.set(`${partId}:${operation.opSeq.trim()}`, id);
    }
  }

  const unitCode = await tx
    .selectFrom("unitOfMeasure")
    .select("code")
    .where("companyId", "=", companyId)
    .where("code", "=", "EA")
    .executeTakeFirst();
  if (!unitCode)
    throw new Error("Carbon unit of measure EA is required for U8 enrichment");
  let order = 1;
  for (const edge of snapshot.edges) {
    const methodId = methodByPartId.get(edge.parentPartId);
    const child = snapshot.items.get(edge.childPartId);
    const childItemId = child ? itemIdByCode.get(child.code) : undefined;
    if (!methodId || !childItemId) continue;
    const materialOrder = order++;
    const methodOperationId = edge.opSeq
      ? (operationByPartAndSeq.get(
          `${edge.parentPartId}:${edge.opSeq.trim()}`
        ) ?? null)
      : null;
    await tx
      .insertInto("methodMaterial")
      .values({
        id: stableId("u8material", companyId, edge.opComponentId),
        makeMethodId: methodId,
        methodOperationId,
        itemId: childItemId,
        itemType: "Part",
        methodType: child
          ? child.isManufactured
            ? "Make to Order"
            : "Purchase to Order"
          : "Purchase to Order",
        sourcingType: "Specified",
        quantity: edge.quantity,
        unitOfMeasureCode: unitCode.code,
        order: materialOrder,
        companyId,
        createdBy: userId,
        updatedBy: userId,
        customFields: {
          u8: {
            bomId: edge.bomId,
            opComponentId: edge.opComponentId,
            opSeq: edge.opSeq,
            childCode: edge.childCode
          }
        },
        storageUnitIds: {},
        kit: false
      } as never)
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          makeMethodId: methodId,
          methodOperationId,
          itemId: childItemId,
          quantity: edge.quantity,
          order: materialOrder,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        } as never)
      )
      .execute();
  }
}

type WholeBomImportResult = {
  imported: number;
  existing: number;
  bomLinks: number;
  rootCode: string;
  failures: WholeBomFailure[];
  itemIdByCode: Record<string, string>;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function importWholeBomFromPlan({
  plan,
  companyId,
  userId
}: {
  plan: WholeBomImportPlan;
  companyId: string;
  userId: string;
}): Promise<WholeBomImportResult> {
  if (plan.items.length > MAX_ROWS) {
    throw new Error(`Excel may contain at most ${MAX_ROWS} BOM items`);
  }

  const db = getDatabaseClient();
  return db.transaction().execute(async (tx) => {
    const codes = plan.items.map((item) => item.code);
    const existingRows = await tx
      .selectFrom("item")
      .select(["id", "readableId"])
      .where("companyId", "=", companyId)
      .where("type", "=", "Part")
      .where("revision", "=", "0")
      .where("readableId", "in", codes)
      .execute();
    const existingCodes = new Set(existingRows.map((row) => row.readableId));
    const failures = buildWholeBomFailures(plan, existingCodes);
    const newItems = plan.items.filter((item) => !existingCodes.has(item.code));

    if (newItems.length > 0) {
      await tx
        .insertInto("item")
        .values(
          newItems.map((item) => ({
            readableId: item.code,
            revision: "0",
            name: item.name,
            description: item.specification ?? item.remark ?? item.name,
            type: "Part" as const,
            replenishmentSystem: item.replenishmentSystem,
            defaultMethodType: item.methodType,
            itemTrackingType: "Inventory" as const,
            unitOfMeasureCode: "EA",
            active: true,
            companyId,
            createdBy: userId,
            updatedBy: userId,
            notes: {
              bomImport: {
                source: "whole-machine-bom",
                rootCode: plan.rootCode,
                rowNumber: item.rowNumber,
                attributes: item.attributes
              }
            }
          })) as never
        )
        .onConflict((conflict) =>
          conflict.constraint("item_unique").doNothing()
        )
        .execute();
    }

    const itemRows = await tx
      .selectFrom("item")
      .select(["id", "readableId"])
      .where("companyId", "=", companyId)
      .where("type", "=", "Part")
      .where("revision", "=", "0")
      .where("readableId", "in", codes)
      .execute();
    const itemIdByCode = new Map(
      itemRows.map((row) => [row.readableId, row.id])
    );

    const partRows = plan.items.flatMap((item) => {
      const itemId = itemIdByCode.get(item.code);
      if (!itemId) return [];
      return [
        {
          id: itemId,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          customFields: {
            bomImport: {
              itemId,
              rootCode: plan.rootCode,
              rowNumber: item.rowNumber,
              drawingCategory: item.drawingCategory,
              materialCategory: item.materialCategory,
              drawingPage: item.drawingPage,
              attributes: item.attributes
            }
          }
        }
      ];
    });
    if (partRows.length > 0) {
      await tx
        .insertInto("part")
        .values(partRows as never)
        .onConflict((conflict) =>
          conflict.columns(["id", "companyId"]).doUpdateSet({
            customFields: sql`coalesce("part"."customFields", '{}'::jsonb) || excluded."customFields"`,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          } as never)
        )
        .execute();
    }

    const unitCode = await tx
      .selectFrom("unitOfMeasure")
      .select("code")
      .where("companyId", "=", companyId)
      .where("code", "=", "EA")
      .executeTakeFirst();
    if (!unitCode) {
      throw new Error("Carbon unit of measure EA is required for BOM import");
    }

    const parentCodes = [...new Set(plan.edges.map((edge) => edge.parentCode))];
    const parentItemIds = parentCodes.flatMap((code) => {
      const itemId = itemIdByCode.get(code);
      return itemId ? [itemId] : [];
    });
    const existingMethods = parentItemIds.length
      ? await tx
          .selectFrom("makeMethod")
          .selectAll()
          .where("companyId", "=", companyId)
          .where("itemId", "in", parentItemIds)
          .execute()
      : [];
    const methodByItemId = new Map<string, (typeof existingMethods)[number]>();
    for (const method of existingMethods) {
      const current = methodByItemId.get(method.itemId);
      if (
        !current ||
        (current.status !== "Active" && method.status === "Active")
      ) {
        methodByItemId.set(method.itemId, method);
      }
    }

    const methodIdByParentCode = new Map<string, string>();
    for (const parentCode of parentCodes) {
      const itemId = itemIdByCode.get(parentCode);
      if (!itemId) continue;
      let method = methodByItemId.get(itemId);
      if (!method) {
        const id = stableId("bombom", companyId, parentCode);
        await tx
          .insertInto("makeMethod")
          .values({
            id,
            itemId,
            companyId,
            createdBy: userId,
            updatedBy: userId,
            version: 1,
            status: "Draft",
            customFields: {
              bomImport: {
                source: "whole-machine-bom",
                rootCode: plan.rootCode,
                parentCode
              }
            }
          } as never)
          .onConflict((conflict) => conflict.column("id").doNothing())
          .execute();
        method = await tx
          .selectFrom("makeMethod")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
      }
      if (!method) continue;
      methodIdByParentCode.set(parentCode, method.id);
      await tx
        .updateTable("makeMethod")
        .set({
          customFields: {
            ...jsonObject(method.customFields),
            bomImport: {
              ...jsonObject(jsonObject(method.customFields).bomImport),
              source: "whole-machine-bom",
              rootCode: plan.rootCode,
              parentCode,
              importedAt: new Date().toISOString()
            }
          },
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        } as never)
        .where("id", "=", method.id)
        .execute();
    }

    const itemByCode = new Map(plan.items.map((item) => [item.code, item]));
    for (const edge of plan.edges) {
      const makeMethodId = methodIdByParentCode.get(edge.parentCode);
      const childItemId = itemIdByCode.get(edge.childCode);
      const childItem = itemByCode.get(edge.childCode);
      if (!makeMethodId || !childItemId || !childItem) continue;
      const materialMakeMethodId =
        methodIdByParentCode.get(edge.childCode) ?? null;
      await tx
        .insertInto("methodMaterial")
        .values({
          id: stableId(
            "bombommat",
            companyId,
            plan.rootCode,
            edge.parentCode,
            edge.childCode,
            String(edge.rowNumber)
          ),
          makeMethodId,
          methodOperationId: null,
          materialMakeMethodId,
          itemId: childItemId,
          itemType: "Part",
          methodType: childItem.methodType,
          sourcingType: "Specified",
          quantity: edge.quantity,
          unitOfMeasureCode: unitCode.code,
          order: edge.order,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          customFields: {
            bomImport: {
              source: "whole-machine-bom",
              rootCode: plan.rootCode,
              parentCode: edge.parentCode,
              childCode: edge.childCode,
              rowNumber: edge.rowNumber,
              attributes: childItem.attributes
            }
          },
          storageUnitIds: {},
          kit: false
        } as never)
        .onConflict((conflict) =>
          conflict.column("id").doUpdateSet({
            makeMethodId,
            itemId: childItemId,
            materialMakeMethodId,
            quantity: edge.quantity,
            order: edge.order,
            methodType: childItem.methodType,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          } as never)
        )
        .execute();
    }

    return {
      imported: newItems.length,
      existing: existingCodes.size,
      bomLinks: plan.edges.length,
      rootCode: plan.rootCode,
      failures,
      itemIdByCode: Object.fromEntries(itemIdByCode.entries())
    };
  });
}

export async function uploadWholeBomDrawingFiles({
  files,
  itemIdByCode,
  companyId,
  userId
}: {
  files: File[];
  itemIdByCode: Record<string, string>;
  companyId: string;
  userId: string;
}) {
  const serviceRole = getCarbonServiceRole();
  const uploaded: string[] = [];
  const missing: string[] = [];
  const failed: { fileName: string; message: string }[] = [];

  for (const file of files) {
    const fileName = String(file.name ?? "");
    if (extname(fileName).toLowerCase() !== ".pdf") {
      failed.push({ fileName, message: "Only PDF drawings are supported" });
      continue;
    }
    const code = fileName.replace(/\.pdf$/i, "");
    const itemId = itemIdByCode[code];
    if (!itemId) {
      missing.push(fileName);
      continue;
    }
    const sanitizedFileName = stripSpecialCharacters(fileName);
    const storagePath = `${companyId}/parts/${itemId}/${sanitizedFileName}`;
    const upload = await serviceRole.storage
      .from("private")
      .upload(storagePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true,
        contentType: file.type || "application/pdf"
      });
    if (upload.error) {
      failed.push({ fileName, message: upload.error.message });
      continue;
    }
    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    const existingDocument = await serviceRole
      .from("document")
      .select("id")
      .eq("companyId", companyId)
      .eq("path", storagePath)
      .maybeSingle();
    if (existingDocument.error) {
      failed.push({ fileName, message: existingDocument.error.message });
      continue;
    }
    if (existingDocument.data?.id) {
      const updateDocument = await serviceRole
        .from("document")
        .update({
          name: fileName,
          size: sizeKb,
          sourceDocument: "Part",
          sourceDocumentId: itemId,
          readGroups: [userId],
          writeGroups: [userId],
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        } as never)
        .eq("id", existingDocument.data.id);
      if (updateDocument.error) {
        failed.push({ fileName, message: updateDocument.error.message });
        continue;
      }
      uploaded.push(fileName);
      continue;
    }
    const document = await upsertDocument(serviceRole, {
      path: storagePath,
      name: fileName,
      size: sizeKb,
      sourceDocument: "Part",
      sourceDocumentId: itemId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId
    });
    if (document.error) {
      failed.push({ fileName, message: document.error.message });
      continue;
    }
    uploaded.push(fileName);
  }

  return { uploaded, missing, failed };
}
