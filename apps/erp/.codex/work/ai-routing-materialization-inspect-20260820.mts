import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) continue;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {
      // keep walking
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeJson(value: string) {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function snapshotRecord(value: unknown) {
  return typeof value === "string" ? safeJson(value) : asRecord(value);
}

function snapshotOperationCount(value: unknown) {
  return asArray(snapshotRecord(value).suggestedOperations).length;
}

function snapshotTargetItemId(value: unknown) {
  const targetItemId = snapshotRecord(value).targetItemId;
  return typeof targetItemId === "string" ? targetItemId : null;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = findRoot(scriptDir);
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is not configured");
}

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });

const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const preferredReadableId = process.env.AI_ROUTING_READABLE_ID ?? "192793050201";
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-materialization-inspect-20260820.json"
);

try {
  const itemResult = await pool.query<{
    id: string;
    readableId: string | null;
    readableIdWithRevision: string | null;
    name: string | null;
    createdBy: string | null;
  }>(
    `
      SELECT "id", "readableId", "readableIdWithRevision", "name", "createdBy"
      FROM "item"
      WHERE "companyId" = $1
        AND ("readableId" = $2 OR "readableIdWithRevision" = $2)
      ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC
      LIMIT 1
    `,
    [companyId, preferredReadableId]
  );

  const preferredItem = itemResult.rows[0] ?? null;

  const draftResult = await pool.query<{
    id: string;
    itemId: string;
    readableId: string | null;
    readableIdWithRevision: string | null;
    itemName: string | null;
    targetMakeMethodId: string | null;
    targetMakeMethodStatus: string | null;
    targetMakeMethodVersion: string | null;
    acceptedMakeMethodId: string | null;
    acceptedMakeMethodStatus: string | null;
    status: string;
    source: string | null;
    createdAt: string;
    updatedAt: string | null;
    acceptedAt: string | null;
    acceptedBy: string | null;
    createdBy: string | null;
    suggestedOperations: unknown;
    referenceSamples: unknown;
    latestFeedbackId: string | null;
    latestFeedbackCreatedAt: string | null;
    confirmedRouteSnapshot: unknown;
  }>(
    `
      SELECT
        d."id",
        d."itemId",
        i."readableId",
        i."readableIdWithRevision",
        i."name" AS "itemName",
        d."targetMakeMethodId",
        target_method."status"::text AS "targetMakeMethodStatus",
        target_method."version"::text AS "targetMakeMethodVersion",
        d."acceptedMakeMethodId",
        accepted_method."status"::text AS "acceptedMakeMethodStatus",
        d."status"::text AS "status",
        d."source",
        d."createdAt",
        d."updatedAt",
        d."acceptedAt",
        d."acceptedBy",
        d."createdBy",
        d."suggestedOperations",
        d."referenceSamples",
        feedback."id" AS "latestFeedbackId",
        feedback."createdAt" AS "latestFeedbackCreatedAt",
        feedback."confirmedRouteSnapshot"
      FROM "aiRoutingDraft" d
      INNER JOIN "item" i
        ON i."id" = d."itemId"
       AND i."companyId" = d."companyId"
      LEFT JOIN "makeMethod" target_method
        ON target_method."id" = d."targetMakeMethodId"
       AND target_method."companyId" = d."companyId"
       AND target_method."itemId" = d."itemId"
      LEFT JOIN "makeMethod" accepted_method
        ON accepted_method."id" = d."acceptedMakeMethodId"
       AND accepted_method."companyId" = d."companyId"
       AND accepted_method."itemId" = d."itemId"
      LEFT JOIN LATERAL (
        SELECT f."id", f."createdAt", f."confirmedRouteSnapshot"
        FROM "aiRoutingFeedback" f
        WHERE f."companyId" = d."companyId"
          AND f."draftId" = d."id"
          AND f."itemId" = d."itemId"
        ORDER BY f."createdAt" DESC
        LIMIT 1
      ) feedback ON TRUE
      WHERE d."companyId" = $1
        AND (
          d."status" = 'Accepted'::"aiRoutingDraftStatus"
          OR i."readableId" = $2
          OR i."readableIdWithRevision" = $2
        )
      ORDER BY
        CASE WHEN i."readableId" = $2 OR i."readableIdWithRevision" = $2 THEN 0 ELSE 1 END,
        d."createdAt" DESC
    `,
    [companyId, preferredReadableId]
  );

  const itemIds = Array.from(new Set(draftResult.rows.map((row) => row.itemId)));
  const countsByItem = new Map<string, { methodCount: number; operationCount: number; activeMethodIds: string[] }>();
  if (itemIds.length > 0) {
    const counts = await pool.query<{
      itemId: string;
      methodCount: string;
      operationCount: string;
      activeMethodIds: string[] | null;
    }>(
      `
        WITH methods AS (
          SELECT "id", "itemId", "status"::text AS "status"
          FROM "makeMethod"
          WHERE "companyId" = $1
            AND "itemId" = ANY($2::text[])
        )
        SELECT
          item_id."itemId",
          COUNT(DISTINCT methods."id")::text AS "methodCount",
          COUNT(operation."id")::text AS "operationCount",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT methods."id") FILTER (WHERE methods."status" = 'Active'), NULL) AS "activeMethodIds"
        FROM (SELECT UNNEST($2::text[]) AS "itemId") item_id
        LEFT JOIN methods ON methods."itemId" = item_id."itemId"
        LEFT JOIN "methodOperation" operation
          ON operation."companyId" = $1
         AND operation."makeMethodId" = methods."id"
        GROUP BY item_id."itemId"
      `,
      [companyId, itemIds]
    );
    for (const row of counts.rows) {
      countsByItem.set(row.itemId, {
        methodCount: Number(row.methodCount),
        operationCount: Number(row.operationCount),
        activeMethodIds: row.activeMethodIds ?? []
      });
    }
  }

  const drafts = draftResult.rows.map((row) => {
    const counts = countsByItem.get(row.itemId) ?? {
      methodCount: 0,
      operationCount: 0,
      activeMethodIds: []
    };
    const confirmedSnapshotTargetItemId = snapshotTargetItemId(row.confirmedRouteSnapshot);
    const confirmedSnapshotOperationCount = snapshotOperationCount(row.confirmedRouteSnapshot);
    return {
      id: row.id,
      itemId: row.itemId,
      readableId: row.readableId,
      readableIdWithRevision: row.readableIdWithRevision,
      itemName: row.itemName,
      status: row.status,
      source: row.source,
      targetMakeMethodId: row.targetMakeMethodId,
      targetMakeMethodStatus: row.targetMakeMethodStatus,
      targetMakeMethodVersion: row.targetMakeMethodVersion,
      acceptedMakeMethodId: row.acceptedMakeMethodId,
      acceptedMakeMethodStatus: row.acceptedMakeMethodStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      acceptedAt: row.acceptedAt,
      acceptedByPresent: Boolean(row.acceptedBy),
      createdByPresent: Boolean(row.createdBy),
      suggestedOperationsCount: asArray(row.suggestedOperations).length,
      referenceSamplesCount: asArray(row.referenceSamples).length,
      latestFeedbackId: row.latestFeedbackId,
      latestFeedbackCreatedAt: row.latestFeedbackCreatedAt,
      confirmedSnapshotTargetItemId,
      confirmedSnapshotOperationCount,
      routeCounts: counts,
      materializationCandidate:
        row.status === "Accepted" &&
        row.acceptedMakeMethodId === null &&
        Boolean(row.targetMakeMethodId) &&
        Boolean(row.latestFeedbackId) &&
        confirmedSnapshotTargetItemId === row.itemId &&
        confirmedSnapshotOperationCount > 0
    };
  });

  const preferredCandidates = drafts.filter(
    (row) =>
      row.materializationCandidate &&
      (row.readableId === preferredReadableId || row.readableIdWithRevision === preferredReadableId)
  );
  const allCandidates = drafts.filter((row) => row.materializationCandidate);

  const output = {
    companyId,
    preferredReadableId,
    preferredItem: preferredItem
      ? {
          id: preferredItem.id,
          readableId: preferredItem.readableId,
          readableIdWithRevision: preferredItem.readableIdWithRevision,
          name: preferredItem.name,
          createdByPresent: Boolean(preferredItem.createdBy)
        }
      : null,
    inspectedDraftCount: drafts.length,
    preferredCandidateCount: preferredCandidates.length,
    allCandidateCount: allCandidates.length,
    preferredCandidates,
    allCandidates: allCandidates.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      readableId: row.readableId,
      readableIdWithRevision: row.readableIdWithRevision,
      acceptedAt: row.acceptedAt,
      confirmedSnapshotOperationCount: row.confirmedSnapshotOperationCount,
      routeCounts: row.routeCounts
    })),
    drafts
  };

  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
