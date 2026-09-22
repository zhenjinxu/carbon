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

const partReadableIds = [
  "1927930501",
  "1927930502",
  "1927930503",
  "1927930601",
  "1927930602",
  "1927930603",
  "192793050101",
  "192793050200",
  "192793050201",
  "192793060101",
  "192793060200",
  "192793060201"
] as const;

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
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-second-batch-12-part-status-20260820.json"
);

try {
  const items = await pool.query<{
    id: string;
    readableId: string | null;
    readableIdWithRevision: string | null;
    name: string | null;
  }>(
    `
      SELECT "id", "readableId", "readableIdWithRevision", "name"
      FROM "item"
      WHERE "companyId" = $1
        AND ("readableId" = ANY($2::text[]) OR "readableIdWithRevision" = ANY($2::text[]))
    `,
    [companyId, partReadableIds]
  );

  const itemIds = items.rows.map((item) => item.id);

  const samples = itemIds.length
    ? await pool.query<{
        itemId: string;
        roles: string[] | null;
        statuses: string[] | null;
        sampleCount: string;
        approvedCount: string;
        latestLockedAt: string | null;
      }>(
        `
          SELECT
            "itemId",
            ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS roles,
            ARRAY_AGG(DISTINCT "status"::text ORDER BY "status"::text) AS statuses,
            COUNT(*)::text AS "sampleCount",
            COUNT(*) FILTER (WHERE "status" = 'Approved'::"aiRoutingSampleStatus")::text AS "approvedCount",
            MAX("lockedAt")::text AS "latestLockedAt"
          FROM "aiRoutingSample"
          WHERE "companyId" = $1
            AND "itemId" = ANY($2::text[])
          GROUP BY "itemId"
        `,
        [companyId, itemIds]
      )
    : { rows: [] };

  const extractions = itemIds.length
    ? await pool.query<{
        itemId: string;
        statuses: string[] | null;
        totalCount: string;
        succeededCount: string;
        latestSucceededId: string | null;
        latestSucceededPromptVersion: string | null;
        latestSucceededModelProvider: string | null;
        latestSucceededModelName: string | null;
        latestSucceededCompletedAt: string | null;
        latestSucceededMaterial: string | null;
        latestSucceededWarnings: string | null;
      }>(
        `
          WITH base AS (
            SELECT e.*
            FROM "aiDrawingExtraction" e
            WHERE e."companyId" = $1
              AND e."itemId" = ANY($2::text[])
          ), latest_succeeded AS (
            SELECT DISTINCT ON ("itemId")
              "itemId",
              "id",
              "promptVersion",
              "modelProvider",
              "modelName",
              "completedAt",
              "extraction",
              "warnings"
            FROM base
            WHERE "status" = 'Succeeded'::"aiDrawingExtractionStatus"
            ORDER BY "itemId", "completedAt" DESC NULLS LAST, "createdAt" DESC
          )
          SELECT
            base."itemId",
            ARRAY_AGG(DISTINCT base."status"::text ORDER BY base."status"::text) AS statuses,
            COUNT(*)::text AS "totalCount",
            COUNT(*) FILTER (WHERE base."status" = 'Succeeded'::"aiDrawingExtractionStatus")::text AS "succeededCount",
            MAX(latest_succeeded."id") AS "latestSucceededId",
            MAX(latest_succeeded."promptVersion") AS "latestSucceededPromptVersion",
            MAX(latest_succeeded."modelProvider") AS "latestSucceededModelProvider",
            MAX(latest_succeeded."modelName") AS "latestSucceededModelName",
            MAX(latest_succeeded."completedAt")::text AS "latestSucceededCompletedAt",
            MAX(latest_succeeded."extraction"->>'material') AS "latestSucceededMaterial",
            MAX(jsonb_array_length(latest_succeeded."warnings")::text) AS "latestSucceededWarnings"
          FROM base
          LEFT JOIN latest_succeeded ON latest_succeeded."itemId" = base."itemId"
          GROUP BY base."itemId"
        `,
        [companyId, itemIds]
      )
    : { rows: [] };

  const methods = itemIds.length
    ? await pool.query<{
        itemId: string;
        methodCount: string;
        operationCount: string;
        statuses: string[] | null;
        activeMethodIds: string[] | null;
        activeOperationCount: string;
        activeRouteSignature: string | null;
      }>(
        `
          WITH operations AS (
            SELECT
              mm."itemId",
              mm."id" AS "makeMethodId",
              mm."status"::text AS "methodStatus",
              mo."id" AS "operationId",
              mo."order",
              p."name" AS "processName"
            FROM "makeMethod" mm
            LEFT JOIN "methodOperation" mo
              ON mo."companyId" = mm."companyId"
             AND mo."makeMethodId" = mm."id"
            LEFT JOIN "process" p
              ON p."companyId" = mo."companyId"
             AND p."id" = mo."processId"
            WHERE mm."companyId" = $1
              AND mm."itemId" = ANY($2::text[])
          )
          SELECT
            item_id."itemId",
            COUNT(DISTINCT operations."makeMethodId")::text AS "methodCount",
            COUNT(operations."operationId")::text AS "operationCount",
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT operations."methodStatus"), NULL) AS statuses,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT operations."makeMethodId") FILTER (WHERE operations."methodStatus" = 'Active'), NULL) AS "activeMethodIds",
            COUNT(operations."operationId") FILTER (WHERE operations."methodStatus" = 'Active')::text AS "activeOperationCount",
            STRING_AGG(operations."processName", ' -> ' ORDER BY operations."order") FILTER (WHERE operations."methodStatus" = 'Active') AS "activeRouteSignature"
          FROM (SELECT UNNEST($2::text[]) AS "itemId") item_id
          LEFT JOIN operations ON operations."itemId" = item_id."itemId"
          GROUP BY item_id."itemId"
        `,
        [companyId, itemIds]
      )
    : { rows: [] };

  const drafts = itemIds.length
    ? await pool.query<{
        itemId: string;
        draftCount: string;
        statuses: string[] | null;
        acceptedCount: string;
        linkedAcceptedMethodIds: string[] | null;
        latestDraftId: string | null;
        latestDraftStatus: string | null;
        latestDraftOperationCount: string | null;
      }>(
        `
          WITH ranked AS (
            SELECT
              d.*,
              ROW_NUMBER() OVER (PARTITION BY d."itemId" ORDER BY d."createdAt" DESC) AS draft_rank
            FROM "aiRoutingDraft" d
            WHERE d."companyId" = $1
              AND d."itemId" = ANY($2::text[])
          )
          SELECT
            "itemId",
            COUNT(*)::text AS "draftCount",
            ARRAY_AGG(DISTINCT "status"::text ORDER BY "status"::text) AS statuses,
            COUNT(*) FILTER (WHERE "status" = 'Accepted'::"aiRoutingDraftStatus")::text AS "acceptedCount",
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT "acceptedMakeMethodId"), NULL) AS "linkedAcceptedMethodIds",
            MAX("id") FILTER (WHERE draft_rank = 1) AS "latestDraftId",
            MAX("status"::text) FILTER (WHERE draft_rank = 1) AS "latestDraftStatus",
            MAX(jsonb_array_length("suggestedOperations")::text) FILTER (WHERE draft_rank = 1) AS "latestDraftOperationCount"
          FROM ranked
          GROUP BY "itemId"
        `,
        [companyId, itemIds]
      )
    : { rows: [] };

  const sampleByItem = new Map(samples.rows.map((row) => [row.itemId, row]));
  const extractionByItem = new Map(extractions.rows.map((row) => [row.itemId, row]));
  const methodByItem = new Map(methods.rows.map((row) => [row.itemId, row]));
  const draftByItem = new Map(drafts.rows.map((row) => [row.itemId, row]));
  const itemByReadable = new Map(
    items.rows.flatMap((item) => [
      [item.readableId, item],
      [item.readableIdWithRevision, item]
    ]).filter(([key]) => typeof key === "string") as [string, (typeof items.rows)[number]][]
  );

  const rows = partReadableIds.map((readableId) => {
    const item = itemByReadable.get(readableId);
    const sample = item ? sampleByItem.get(item.id) : undefined;
    const extraction = item ? extractionByItem.get(item.id) : undefined;
    const method = item ? methodByItem.get(item.id) : undefined;
    const draft = item ? draftByItem.get(item.id) : undefined;
    const roles = sample?.roles ?? [];
    return {
      readableId,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      datasetRoles: roles,
      intendedHandling: roles.includes("Training")
        ? "Keep as Training reference; do not generate/activate AI route for evaluation."
        : roles.includes("Evaluation")
          ? "Keep as Evaluation holdout unless explicitly selected for controlled human-review rollout."
          : "Not in current frozen 8/4 dataset; requires manual classification before use.",
      sample: sample
        ? {
            sampleCount: Number(sample.sampleCount),
            approvedCount: Number(sample.approvedCount),
            statuses: sample.statuses ?? [],
            latestLockedAt: sample.latestLockedAt
          }
        : null,
      extraction: extraction
        ? {
            totalCount: Number(extraction.totalCount),
            succeededCount: Number(extraction.succeededCount),
            statuses: extraction.statuses ?? [],
            latestSucceededId: extraction.latestSucceededId,
            latestSucceededPromptVersion: extraction.latestSucceededPromptVersion,
            latestSucceededModelProvider: extraction.latestSucceededModelProvider,
            latestSucceededModelName: extraction.latestSucceededModelName,
            latestSucceededCompletedAt: extraction.latestSucceededCompletedAt,
            latestSucceededMaterial: extraction.latestSucceededMaterial,
            latestSucceededWarnings: extraction.latestSucceededWarnings === null ? null : Number(extraction.latestSucceededWarnings)
          }
        : null,
      routing: method
        ? {
            methodCount: Number(method.methodCount),
            operationCount: Number(method.operationCount),
            statuses: method.statuses ?? [],
            activeMethodIds: method.activeMethodIds ?? [],
            activeOperationCount: Number(method.activeOperationCount),
            activeRouteSignature: method.activeRouteSignature
          }
        : null,
      draft: draft
        ? {
            draftCount: Number(draft.draftCount),
            statuses: draft.statuses ?? [],
            acceptedCount: Number(draft.acceptedCount),
            linkedAcceptedMethodIds: draft.linkedAcceptedMethodIds ?? [],
            latestDraftId: draft.latestDraftId,
            latestDraftStatus: draft.latestDraftStatus,
            latestDraftOperationCount: draft.latestDraftOperationCount === null ? null : Number(draft.latestDraftOperationCount)
          }
        : null
    };
  });

  const summary = {
    companyId,
    checkedAt: new Date().toISOString(),
    requestedPartCount: partReadableIds.length,
    foundItemCount: rows.filter((row) => row.itemId).length,
    trainingCount: rows.filter((row) => row.datasetRoles.includes("Training")).length,
    evaluationCount: rows.filter((row) => row.datasetRoles.includes("Evaluation")).length,
    activeAiMaterializedCount: rows.filter((row) =>
      asArray(row.draft?.linkedAcceptedMethodIds).some((id) => asArray(row.routing?.activeMethodIds).includes(id))
    ).length,
    partsWithDrafts: rows.filter((row) => (row.draft?.draftCount ?? 0) > 0).map((row) => row.readableId),
    partsWithActiveOperations: rows
      .filter((row) => (row.routing?.activeOperationCount ?? 0) > 0)
      .map((row) => row.readableId)
  };

  const output = { summary, rows };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
