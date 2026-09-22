import { readFileSync } from "node:fs";
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

function compactExtraction(value: unknown) {
  const row = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const titleBlock = row.titleBlock && typeof row.titleBlock === "object" ? row.titleBlock : {};
  const features = row.features && typeof row.features === "object" ? row.features : {};
  return {
    schemaVersion: row.schemaVersion ?? null,
    material: titleBlock.material ?? null,
    finish: titleBlock.finish ?? null,
    dimensions: Array.isArray(row.dimensions) ? row.dimensions.length : 0,
    holes: Array.isArray(features.holes) ? features.holes.length : 0,
    threads: Array.isArray(features.threads) ? features.threads.length : 0,
    bends: Array.isArray(features.bends) ? features.bends.length : 0,
    surfaces: Array.isArray(features.surfaces) ? features.surfaces.length : 0,
    notes: Array.isArray(row.notes) ? row.notes.length : 0,
    warnings: Array.isArray(row.warnings) ? row.warnings.length : 0
  };
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = findRoot(scriptDir);
loadEnvFile(resolve(root, ".env"));
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

const companyId = "d8s9bh4f8gm357312pbg";
const readableId = "192793050201";

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
      LIMIT 1
    `,
    [companyId, readableId]
  );

  const item = itemResult.rows[0];
  if (!item) throw new Error(`Part ${readableId} not found`);

  const documentResult = await pool.query<{
    id: string;
    name: string | null;
    path: string | null;
    type: string | null;
    extension: string | null;
    active: boolean | null;
    size: number | null;
    updatedAt: string | null;
  }>(
    `
      SELECT "id", "name", "path", "type", "extension", "active", "size", "updatedAt"
      FROM "document"
      WHERE "companyId" = $1
        AND "sourceDocument" = 'Part'
        AND "sourceDocumentId" = $2
        AND "active" = TRUE
        AND ("type" = 'PDF' OR LOWER(COALESCE("extension", '')) = 'pdf')
      ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `,
    [companyId, item.id]
  );

  const documentIds = documentResult.rows.map((document) => document.id);
  const extractionResult = await pool.query<{
    id: string;
    status: string;
    documentId: string;
    contentHash: string | null;
    rendererVersion: string | null;
    extractorSchemaVersion: string | null;
    promptVersion: string | null;
    modelProvider: string | null;
    modelName: string | null;
    pageCount: number | null;
    errorCategory: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string | null;
    extraction: unknown;
  }>(
    `
      SELECT
        "id", "status", "documentId", "contentHash", "rendererVersion",
        "extractorSchemaVersion", "promptVersion", "modelProvider", "modelName",
        "pageCount", "errorCategory", "errorCode", "errorMessage", "startedAt",
        "completedAt", "createdAt", "updatedAt", "extraction"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = $1
        AND "itemId" = $2
      ORDER BY "createdAt" DESC, "id" DESC
    `,
    [companyId, item.id]
  );

  const activeFormalRoutes = await pool.query<{ methodCount: string; operationCount: string }>(
    `
      WITH methods AS (
        SELECT "id"
        FROM "makeMethod"
        WHERE "companyId" = $1
          AND "itemId" = $2
      )
      SELECT
        (SELECT COUNT(*) FROM methods)::text AS "methodCount",
        (SELECT COUNT(*) FROM "methodOperation" WHERE "companyId" = $1 AND "makeMethodId" IN (SELECT "id" FROM methods))::text AS "operationCount"
    `,
    [companyId, item.id]
  );

  const output = {
    companyId,
    readableId,
    item: {
      id: item.id,
      readableId: item.readableId,
      readableIdWithRevision: item.readableIdWithRevision,
      name: item.name,
      hasCreatedBy: Boolean(item.createdBy)
    },
    documents: documentResult.rows.map((document) => ({
      id: document.id,
      name: document.name,
      type: document.type,
      extension: document.extension,
      active: document.active,
      size: document.size,
      updatedAt: document.updatedAt
    })),
    latestExtraction: extractionResult.rows[0]
      ? {
          ...Object.fromEntries(
            Object.entries(extractionResult.rows[0]).filter(([key]) => key !== "extraction")
          ),
          compactExtraction: compactExtraction(extractionResult.rows[0].extraction)
        }
      : null,
    extractionCount: extractionResult.rows.length,
    activeExtractionCount: extractionResult.rows.filter((row) =>
      ["Pending", "Processing"].includes(row.status)
    ).length,
    sameDocumentExtractionCount: extractionResult.rows.filter((row) =>
      documentIds.includes(row.documentId)
    ).length,
    formalRouteBefore: activeFormalRoutes.rows[0] ?? {
      methodCount: "0",
      operationCount: "0"
    }
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
