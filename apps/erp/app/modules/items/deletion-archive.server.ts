import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable
} from "kysely";

type Timestamp = ColumnType<string, string | Date, string | Date>;

type DeletionArchiveTable = {
  id: Generated<string>;
  companyId: string;
  entityType: string;
  entityId: string;
  reason: string;
  payload: unknown;
  restoredAt: Timestamp | null;
  restoredBy: string | null;
  createdBy: string;
  createdAt: Generated<Timestamp>;
  updatedBy: string | null;
  updatedAt: Timestamp | null;
};

type DeletionArchiveKyselyDatabase = KyselyDatabase & {
  deletionArchive: DeletionArchiveTable;
};

type DeletionArchiveRow = Selectable<DeletionArchiveTable>;
type ItemInsert = Insertable<KyselyDatabase["item"]>;
type PartInsert = Insertable<KyselyDatabase["part"]>;
type PartUpdate = Updateable<KyselyDatabase["part"]>;
type MethodMaterialInsert = Insertable<KyselyDatabase["methodMaterial"]>;

export type DeletionArchiveDatabase = Kysely<KyselyDatabase>;

export const MAX_DELETION_ARCHIVE_RESTORE = 100;

export const deletionArchiveEntityTypes = [
  "Part",
  "Material",
  "Tool",
  "Consumable"
] as const;

export type DeletionArchiveEntityType =
  (typeof deletionArchiveEntityTypes)[number];

const deletionArchiveEntityTypeSet = new Set<string>(
  deletionArchiveEntityTypes
);

export class DeletionArchiveAuthorizationError extends Error {}

export function assertDeletionArchiveSession(headers: Headers) {
  if (headers.has("carbon-key")) {
    throw new Response("Deletion archive restore requires a user session", {
      status: 403
    });
  }
}

export function normalizeDeletionArchiveIds(archiveIds: string[]) {
  const normalized = archiveIds.map((archiveId) => archiveId.trim());

  if (
    normalized.length === 0 ||
    normalized.some((archiveId) => archiveId === "")
  ) {
    throw new Error("Select at least one archive record to restore");
  }
  if (normalized.length > MAX_DELETION_ARCHIVE_RESTORE) {
    throw new Error(
      `Select at most ${MAX_DELETION_ARCHIVE_RESTORE} archive records to restore`
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Duplicate archive IDs are not allowed");
  }

  return normalized;
}

export type DeletionArchiveListItem = {
  id: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  readableId: string;
  name: string;
  action: "delete" | "deactivate" | "unknown";
  actionLabel: string;
  reason: string;
  relatedSummary: string;
  createdBy: string;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function jsonValue<T>(value: unknown) {
  return value as T;
}

function requiredString(value: unknown, label: string) {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(`Archived payload is missing ${label}`);
  return parsed;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeEntityType(entityType: string) {
  if (!deletionArchiveEntityTypeSet.has(entityType)) {
    throw new Error(`Unsupported archive entity type: ${entityType}`);
  }
  return entityType as DeletionArchiveEntityType;
}

function entityTypeLabel(entityType: string) {
  switch (entityType) {
    case "Part":
      return "零件";
    case "Material":
      return "材料";
    case "Tool":
      return "工具";
    case "Consumable":
      return "消耗品";
    default:
      return entityType;
  }
}

function archiveAction(payload: Record<string, unknown> | undefined) {
  const action = stringValue(payload?.action);
  if (action === "delete" || action === "deactivate") return action;

  // Legacy delete archives were created before payload.action existed, but
  // still carried the deleted item snapshot needed for restore.
  if (asRecord(payload?.item)) return "delete";

  return "unknown";
}

function archiveActionLabel(action: DeletionArchiveListItem["action"]) {
  switch (action) {
    case "delete":
      return "删除归档";
    case "deactivate":
      return "停用归档";
    default:
      return "未知归档";
  }
}

function relatedSummary(payload: Record<string, unknown> | undefined) {
  const methodMaterialCount = asArray(payload?.methodMaterials).length;
  const testJobCount = asArray(payload?.testJobs).length;
  const jobReferences = asRecord(payload?.jobReferences);
  const referencedJobCount = asArray(jobReferences?.jobs).length;
  const parts = [];

  if (methodMaterialCount > 0) parts.push(`BOM ${methodMaterialCount}`);
  if (testJobCount > 0) parts.push(`测试工单 ${testJobCount}`);
  if (referencedJobCount > 0) parts.push(`工单引用 ${referencedJobCount}`);

  return parts.length > 0 ? parts.join(" / ") : "无关联快照";
}

export function summarizeDeletionArchiveRow(
  row: DeletionArchiveRow
): DeletionArchiveListItem {
  const payload = asRecord(row.payload);
  const item = asRecord(payload?.item);
  const action = archiveAction(payload);

  return {
    id: row.id,
    entityType: row.entityType,
    entityTypeLabel: entityTypeLabel(row.entityType),
    entityId: row.entityId,
    readableId:
      stringValue(item?.readableIdWithRevision) ??
      stringValue(item?.readableId) ??
      row.entityId,
    name: stringValue(item?.name) ?? stringValue(item?.description) ?? "-",
    action,
    actionLabel: archiveActionLabel(action),
    reason: row.reason,
    relatedSummary: relatedSummary(payload),
    createdBy: row.createdBy,
    createdAt: String(row.createdAt)
  };
}

function countValue(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function affectedRows(value: unknown, key: "numUpdatedRows") {
  if (!isRecord(value)) return 0;
  return countValue(value[key]);
}

export async function getDeletionArchives(
  db: DeletionArchiveDatabase,
  input: {
    companyId: string;
    entityType?: DeletionArchiveEntityType;
    limit: number;
    offset: number;
  }
) {
  const archiveDb = db as unknown as Kysely<DeletionArchiveKyselyDatabase>;

  let rowsQuery = archiveDb
    .selectFrom("deletionArchive")
    .selectAll()
    .where("companyId", "=", input.companyId)
    .where("restoredAt", "is", null);
  let countQuery = archiveDb
    .selectFrom("deletionArchive")
    .select(({ fn }) => fn.countAll().as("count"))
    .where("companyId", "=", input.companyId)
    .where("restoredAt", "is", null);

  if (input.entityType) {
    rowsQuery = rowsQuery.where("entityType", "=", input.entityType);
    countQuery = countQuery.where("entityType", "=", input.entityType);
  }

  const [rows, countRow] = await Promise.all([
    rowsQuery
      .orderBy("createdAt", "desc")
      .limit(input.limit)
      .offset(input.offset)
      .execute(),
    countQuery.executeTakeFirst()
  ]);

  return {
    data: rows.map(summarizeDeletionArchiveRow),
    count: countValue(countRow?.count)
  };
}

function parseArchivedItem(
  row: DeletionArchiveRow,
  companyId: string
): Record<string, unknown> {
  const payload = asRecord(row.payload);
  const item = asRecord(payload?.item);
  if (!item) throw new Error("Archived payload is missing item snapshot");

  const itemId = requiredString(item.id, "item.id");
  const itemCompanyId = requiredString(item.companyId, "item.companyId");
  const itemType = requiredString(item.type, "item.type");

  if (itemId !== row.entityId) {
    throw new Error("Archived item snapshot does not match archive entity");
  }
  if (itemCompanyId !== companyId || row.companyId !== companyId) {
    throw new Error("Archived item does not belong to the current company");
  }
  if (itemType !== row.entityType) {
    throw new Error("Archived item type does not match archive entity type");
  }

  normalizeEntityType(itemType);
  return item;
}

function itemInsertFromArchive(item: Record<string, unknown>): ItemInsert {
  return {
    id: requiredString(item.id, "item.id"),
    active: optionalBoolean(item.active, true),
    assignee: optionalString(item.assignee),
    companyId: requiredString(item.companyId, "item.companyId"),
    createdAt: stringValue(item.createdAt),
    createdBy: requiredString(item.createdBy, "item.createdBy"),
    defaultMethodType: jsonValue<ItemInsert["defaultMethodType"]>(
      item.defaultMethodType ?? null
    ),
    description: optionalString(item.description),
    embedding: item.embedding,
    itemTrackingType: jsonValue<ItemInsert["itemTrackingType"]>(
      requiredString(item.itemTrackingType, "item.itemTrackingType")
    ),
    modelUploadId: optionalString(item.modelUploadId),
    name: requiredString(item.name, "item.name"),
    notes: jsonValue<ItemInsert["notes"]>(item.notes ?? null),
    readableId: requiredString(item.readableId, "item.readableId"),
    replenishmentSystem: jsonValue<ItemInsert["replenishmentSystem"]>(
      item.replenishmentSystem ?? "Buy"
    ),
    requiresInspection: optionalBoolean(item.requiresInspection, false),
    revision: optionalString(item.revision),
    thumbnailPath: optionalString(item.thumbnailPath),
    trackingMethod: optionalString(item.trackingMethod),
    type: jsonValue<ItemInsert["type"]>(requiredString(item.type, "item.type")),
    unitOfMeasureCode: optionalString(item.unitOfMeasureCode),
    updatedAt: optionalString(item.updatedAt),
    updatedBy: optionalString(item.updatedBy)
  };
}

function partInsertFromArchive(
  part: Record<string, unknown>,
  item: Record<string, unknown>,
  input: { companyId: string }
): PartInsert {
  const readableId = requiredString(item.readableId, "item.readableId");
  const partId = requiredString(part.id, "part.id");
  const partCompanyId = requiredString(part.companyId, "part.companyId");

  if (partId !== readableId) {
    throw new Error("Archived part snapshot does not match item readable ID");
  }
  if (partCompanyId !== input.companyId) {
    throw new Error("Archived part does not belong to the current company");
  }

  return {
    id: partId,
    approved: optionalBoolean(part.approved, false),
    approvedBy: optionalString(part.approvedBy),
    companyId: partCompanyId,
    createdAt: stringValue(part.createdAt),
    createdBy: requiredString(part.createdBy, "part.createdBy"),
    customFields: jsonValue<PartInsert["customFields"]>(
      part.customFields ?? null
    ),
    fromDate: optionalString(part.fromDate),
    tags: jsonValue<PartInsert["tags"]>(
      Array.isArray(part.tags) ? part.tags : null
    ),
    toDate: optionalString(part.toDate),
    updatedAt: optionalString(part.updatedAt),
    updatedBy: optionalString(part.updatedBy)
  };
}

function fallbackPartInsertFromItem(
  item: Record<string, unknown>,
  input: { companyId: string }
): PartInsert {
  return {
    id: requiredString(item.readableId, "item.readableId"),
    companyId: input.companyId,
    createdAt: stringValue(item.createdAt),
    createdBy: requiredString(item.createdBy, "item.createdBy"),
    customFields: null
  };
}

function partUpdateFromInsert(part: PartInsert): PartUpdate {
  return {
    approved: part.approved,
    approvedBy: part.approvedBy,
    createdAt: part.createdAt,
    createdBy: part.createdBy,
    customFields: part.customFields,
    fromDate: part.fromDate,
    tags: part.tags,
    toDate: part.toDate,
    updatedAt: part.updatedAt,
    updatedBy: part.updatedBy
  };
}
async function resolveMaterialMakeMethodId(
  trx: Kysely<DeletionArchiveKyselyDatabase>,
  methodMaterial: Record<string, unknown>,
  input: { companyId: string }
) {
  const archivedMaterialMakeMethodId = optionalString(
    methodMaterial.materialMakeMethodId
  );
  const methodType = stringValue(methodMaterial.methodType);

  if (archivedMaterialMakeMethodId) {
    const existingMakeMethod = await trx
      .selectFrom("makeMethod")
      .select("id")
      .where("id", "=", archivedMaterialMakeMethodId)
      .where("companyId", "=", input.companyId)
      .executeTakeFirst();

    if (existingMakeMethod?.id) return archivedMaterialMakeMethodId;
  }

  if (methodType !== "Make to Order") return null;

  const itemId = requiredString(methodMaterial.itemId, "methodMaterial.itemId");
  const currentMakeMethod = await trx
    .selectFrom("activeMakeMethods")
    .select("id")
    .where("itemId", "=", itemId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();

  return stringValue(currentMakeMethod?.id) ?? null;
}

function methodMaterialInsertFromArchive(
  methodMaterial: Record<string, unknown>,
  input: {
    companyId: string;
    itemId: string;
    materialMakeMethodId: string | null;
  }
): MethodMaterialInsert {
  const companyId = requiredString(
    methodMaterial.companyId,
    "methodMaterial.companyId"
  );
  const itemId = requiredString(methodMaterial.itemId, "methodMaterial.itemId");
  if (companyId !== input.companyId || itemId !== input.itemId) {
    throw new Error("Archived BOM material does not match restored item");
  }

  return {
    id: stringValue(methodMaterial.id),
    companyId,
    createdAt: stringValue(methodMaterial.createdAt),
    createdBy: requiredString(
      methodMaterial.createdBy,
      "methodMaterial.createdBy"
    ),
    customFields: jsonValue<MethodMaterialInsert["customFields"]>(
      methodMaterial.customFields ?? null
    ),
    itemId,
    itemType: stringValue(methodMaterial.itemType),
    kit: booleanValue(methodMaterial.kit),
    makeMethodId: requiredString(
      methodMaterial.makeMethodId,
      "methodMaterial.makeMethodId"
    ),
    materialMakeMethodId: input.materialMakeMethodId,
    methodOperationId: optionalString(methodMaterial.methodOperationId),
    methodType: jsonValue<MethodMaterialInsert["methodType"]>(
      methodMaterial.methodType ?? "Buy"
    ),
    order: numberValue(methodMaterial.order),
    quantity: numberValue(methodMaterial.quantity) ?? 0,
    scrapQuantity: numberValue(methodMaterial.scrapQuantity),
    sourcingType: jsonValue<MethodMaterialInsert["sourcingType"]>(
      methodMaterial.sourcingType ?? "Buy"
    ),
    storageUnitIds: jsonValue<MethodMaterialInsert["storageUnitIds"]>(
      methodMaterial.storageUnitIds ?? []
    ),
    tags: jsonValue<MethodMaterialInsert["tags"]>(
      Array.isArray(methodMaterial.tags) ? methodMaterial.tags : null
    ),
    unitOfMeasureCode: requiredString(
      methodMaterial.unitOfMeasureCode,
      "methodMaterial.unitOfMeasureCode"
    ),
    updatedAt: optionalString(methodMaterial.updatedAt),
    updatedBy: optionalString(methodMaterial.updatedBy)
  };
}

async function restoreDeactivatedItem(
  trx: Kysely<DeletionArchiveKyselyDatabase>,
  row: DeletionArchiveRow,
  input: { companyId: string; sessionUserId: string; restoredAt: string }
) {
  const item = parseArchivedItem(row, input.companyId);
  const result = await trx
    .updateTable("item")
    .set({
      active: optionalBoolean(item.active, true),
      updatedBy: input.sessionUserId,
      updatedAt: input.restoredAt
    })
    .where("id", "=", row.entityId)
    .where("companyId", "=", input.companyId)
    .where("type", "=", normalizeEntityType(row.entityType))
    .executeTakeFirst();

  if (affectedRows(result, "numUpdatedRows") !== 1) {
    throw new Error("Archived item is no longer available to reactivate");
  }
}

async function restoreDeletedItem(
  trx: Kysely<DeletionArchiveKyselyDatabase>,
  row: DeletionArchiveRow,
  input: { companyId: string }
) {
  const item = parseArchivedItem(row, input.companyId);
  const existing = await trx
    .selectFrom("item")
    .select("id")
    .where("id", "=", row.entityId)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .executeTakeFirst();

  if (existing) {
    throw new Error(
      "Archived item already exists and cannot be restored safely"
    );
  }

  await trx.insertInto("item").values(itemInsertFromArchive(item)).execute();

  if (row.entityType === "Part") {
    const payload = asRecord(row.payload);
    const archivedPart = asRecord(payload?.part);
    const readableId = requiredString(item.readableId, "item.readableId");
    const part = archivedPart
      ? partInsertFromArchive(archivedPart, item, {
          companyId: input.companyId
        })
      : fallbackPartInsertFromItem(item, { companyId: input.companyId });
    const existingPart = await trx
      .selectFrom("part")
      .select("id")
      .where("id", "=", readableId)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .executeTakeFirst();

    if (existingPart) {
      await trx
        .updateTable("part")
        .set(partUpdateFromInsert(part))
        .where("id", "=", part.id ?? readableId)
        .where("companyId", "=", input.companyId)
        .executeTakeFirst();
    } else {
      await trx.insertInto("part").values(part).execute();
    }
  }

  const payload = asRecord(row.payload);
  const methodMaterials = asArray(payload?.methodMaterials)
    .map(asRecord)
    .filter((value): value is Record<string, unknown> => Boolean(value));

  if (methodMaterials.length > 0) {
    const methodMaterialInserts: MethodMaterialInsert[] = [];
    for (const methodMaterial of methodMaterials) {
      methodMaterialInserts.push(
        methodMaterialInsertFromArchive(methodMaterial, {
          companyId: input.companyId,
          itemId: row.entityId,
          materialMakeMethodId: await resolveMaterialMakeMethodId(
            trx,
            methodMaterial,
            { companyId: input.companyId }
          )
        })
      );
    }

    await trx
      .insertInto("methodMaterial")
      .values(methodMaterialInserts)
      .execute();
  }
}

export async function restoreDeletionArchives(
  db: DeletionArchiveDatabase,
  input: {
    archiveIds: string[];
    companyId: string;
    sessionUserId: string;
  }
) {
  const archiveIds = normalizeDeletionArchiveIds(input.archiveIds);
  const archiveDb = db as unknown as Kysely<DeletionArchiveKyselyDatabase>;

  return archiveDb.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select("developer")
      .where("id", "=", input.sessionUserId)
      .forUpdate()
      .executeTakeFirst();
    if (user?.developer !== true) {
      throw new DeletionArchiveAuthorizationError(
        "Deletion archive restore requires a developer account"
      );
    }

    const rows = await trx
      .selectFrom("deletionArchive")
      .selectAll()
      .where("id", "in", archiveIds)
      .where("companyId", "=", input.companyId)
      .where("restoredAt", "is", null)
      .forUpdate()
      .execute();

    if (rows.length !== archiveIds.length) {
      throw new Error(
        "One or more selected archive records are no longer available"
      );
    }

    const restoredAt = new Date().toISOString();
    for (const row of rows) {
      const payload = asRecord(row.payload);
      const action = archiveAction(payload);
      if (action === "deactivate") {
        await restoreDeactivatedItem(trx, row, {
          companyId: input.companyId,
          sessionUserId: input.sessionUserId,
          restoredAt
        });
      } else if (action === "delete") {
        await restoreDeletedItem(trx, row, { companyId: input.companyId });
      } else {
        throw new Error("Unsupported archive action");
      }
    }

    const result = await trx
      .updateTable("deletionArchive")
      .set({
        restoredAt,
        restoredBy: input.sessionUserId,
        updatedAt: restoredAt,
        updatedBy: input.sessionUserId
      })
      .where("id", "in", archiveIds)
      .where("companyId", "=", input.companyId)
      .where("restoredAt", "is", null)
      .executeTakeFirst();

    if (affectedRows(result, "numUpdatedRows") !== archiveIds.length) {
      throw new Error("Restored archive rows did not match the request");
    }

    return { restored: rows.length };
  });
}
