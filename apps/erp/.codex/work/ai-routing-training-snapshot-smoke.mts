import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function loadEnvFile(path: string, override = false) {
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
    if (!override && process.env[key] !== undefined) continue;

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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);

const requireFromDatabase = createRequire(
  resolve(root, "packages/database/package.json")
);
const pgModule = await import(
  pathToFileURL(requireFromDatabase.resolve("pg")).href
);
const Pool = pgModule.Pool ?? pgModule.default.Pool;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  max: 1
});
const companyId = "d8s9bh4f8gm357312pbg";
const readableId = process.argv[2] ?? "1927930207";

try {
  const itemResult = await pool.query<{
    id: string;
    readableId: string | null;
    readableIdWithRevision: string | null;
  }>(
    `
    SELECT "id", "readableId", "readableIdWithRevision"
    FROM "item"
    WHERE "companyId" = $1
      AND ("readableId" = $2 OR "readableIdWithRevision" = $2)
    LIMIT 1
  `,
    [companyId, readableId]
  );

  const item = itemResult.rows[0];
  if (!item) {
    throw new Error(`Part ${readableId} was not found`);
  }

  const documents = await pool.query<{
    id: string;
    name: string | null;
    path: string | null;
    extension: string | null;
    type: string | null;
    sourceDocument: string | null;
    sourceDocumentId: string | null;
    active: boolean | null;
  }>(
    `
    SELECT
      "id",
      "name",
      "path",
      "extension",
      "type",
      "sourceDocument",
      "sourceDocumentId",
      "active"
    FROM "document"
    WHERE "companyId" = $1
      AND "sourceDocument" = 'Part'
      AND "sourceDocumentId" = $2
      AND "active" = TRUE
      AND "type" = 'PDF'
      AND LOWER("extension") = 'pdf'
    ORDER BY "createdAt" DESC, "id" ASC
  `,
    [companyId, item.id]
  );

  if (documents.rows.length === 0) {
    throw new Error("Part training sample requires an active Part PDF document");
  }

  const extractions = await pool.query<{
    id: string;
    itemId: string;
    documentId: string;
    status: string | null;
    contentHash: string | null;
    rendererVersion: string | null;
    extractorSchemaVersion: string | null;
    promptVersion: string | null;
    modelProvider: string | null;
    modelName: string | null;
    pageCount: number | null;
    completedAt: string | null;
    extraction: unknown;
  }>(
    `
    SELECT
      "id",
      "itemId",
      "documentId",
      "status",
      "contentHash",
      "rendererVersion",
      "extractorSchemaVersion",
      "promptVersion",
      "modelProvider",
      "modelName",
      "pageCount",
      "completedAt",
      "extraction"
    FROM "aiDrawingExtraction"
    WHERE "companyId" = $1
      AND "itemId" = $2
      AND "documentId" = ANY($3::text[])
    ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `,
    [companyId, item.id, documents.rows.map((document) => document.id)]
  );

  const seenPaths = new Set<string>();
  const currentDocuments = documents.rows.filter((document) => {
    const key = document.path?.trim() || document.id;
    if (seenPaths.has(key)) return false;
    seenPaths.add(key);
    return true;
  });

  const snapshots = currentDocuments.map((document) => {
    const extraction = extractions.rows.find(
      (row) => row.documentId === document.id && row.status === "Succeeded"
    );
    if (!extraction) {
      throw new Error(
        "Part training sample requires a succeeded AI drawing extraction"
      );
    }

    const extractionBody = objectValue(extraction.extraction);
    const documentBody = objectValue(extractionBody.document);
    const extractionContentHash = stringValue(documentBody.contentHash);
    const schemaVersion = stringValue(extractionBody.schemaVersion);

    if (
      !extraction.contentHash ||
      extraction.contentHash !== extractionContentHash ||
      !extraction.extractorSchemaVersion ||
      extraction.extractorSchemaVersion !== schemaVersion
    ) {
      throw new Error("Part training sample has a stale AI drawing extraction");
    }

    return {
      id: document.id,
      name: document.name,
      path: document.path,
      extension: document.extension,
      type: document.type,
      sourceDocument: document.sourceDocument,
      sourceDocumentId: document.sourceDocumentId,
      aiDrawingExtraction: {
        id: extraction.id,
        documentId: extraction.documentId,
        contentHash: extraction.contentHash,
        rendererVersion: extraction.rendererVersion,
        extractorSchemaVersion: extraction.extractorSchemaVersion,
        promptVersion: extraction.promptVersion,
        modelProvider: extraction.modelProvider,
        modelName: extraction.modelName,
        pageCount: extraction.pageCount,
        completedAt: extraction.completedAt
      }
    };
  });

  const serialized = JSON.stringify(snapshots);
  const containsFullExtractionPayload =
    serialized.includes('"features"') ||
    serialized.includes('"dimensions"') ||
    serialized.includes('"notes"');

  if (containsFullExtractionPayload) {
    throw new Error("Training drawing snapshot contains full extraction facts");
  }

  console.log(
    JSON.stringify(
      {
        readableId,
        itemId: item.id,
        snapshotCount: snapshots.length,
        extractionIds: snapshots.map(
          (snapshot) => snapshot.aiDrawingExtraction.id
        ),
        documentIds: snapshots.map((snapshot) => snapshot.id),
        containsFullExtractionPayload
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}



