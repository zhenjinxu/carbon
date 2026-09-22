import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
function loadEnvFile(path, override = false) {
  let content = "";
  try { content = readFileSync(path, "utf8"); } catch { return; }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);
const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
try {
  const result = await pool.query(`
    SELECT
      item."readableId",
      document."id" AS "documentId",
      document."name",
      document."path",
      document."createdAt" AS "documentCreatedAt",
      extraction."id" AS "extractionId",
      extraction."status",
      extraction."contentHash",
      extraction."completedAt"
    FROM "item" item
    JOIN "document" document
      ON document."companyId" = item."companyId"
      AND document."sourceDocument" = 'Part'
      AND document."sourceDocumentId" = item."id"
      AND document."active" = TRUE
      AND document."type" = 'PDF'
      AND LOWER(document."extension") = 'pdf'
    LEFT JOIN LATERAL (
      SELECT "id", "status", "contentHash", "completedAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = item."companyId"
        AND "itemId" = item."id"
        AND "documentId" = document."id"
      ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
      LIMIT 1
    ) extraction ON TRUE
    WHERE item."companyId" = $1
      AND item."readableId" = $2
    ORDER BY document."createdAt" DESC, document."id" ASC
  `, ["d8s9bh4f8gm357312pbg", "1927930205"]);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await pool.end();
}
