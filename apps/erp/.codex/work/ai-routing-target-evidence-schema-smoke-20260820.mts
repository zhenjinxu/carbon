import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnv(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
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
      if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") {
        return current;
      }
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnv(resolve(root, ".env"));
loadEnv(resolve(root, ".env.local"), { override: true });
loadEnv(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });

const companyId = "d8s9bh4f8gm357312pbg";
const itemId = "wodiitem_0141582866eb9de5f7c76491";
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-target-evidence-schema-smoke-20260820.json"
);

try {
  const result = await pool.query(
    `
      SELECT
        item."id" AS "itemId",
        item."readableId" AS "readableId",
        item."notes" AS "customFields",
        extraction."id" AS "extractionId",
        jsonb_typeof(extraction."extraction") AS "extractionType"
      FROM "item" AS item
      JOIN LATERAL (
        SELECT "id", "extraction", "completedAt", "updatedAt", "createdAt"
        FROM "aiDrawingExtraction"
        WHERE "companyId" = $1
          AND "itemId" = $2
          AND "status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND jsonb_typeof("extraction") = 'object'
        ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
        LIMIT 1
      ) AS extraction ON TRUE
      WHERE item."companyId" = $1
        AND item."id" = $2
      LIMIT 1
    `,
    [companyId, itemId]
  );
  const row = result.rows[0] ?? null;
  const output = {
    companyId,
    itemId,
    checkedAt: new Date().toISOString(),
    hasTargetEvidence: Boolean(row),
    readableId: row?.readableId ?? null,
    extractionId: row?.extractionId ?? null,
    extractionType: row?.extractionType ?? null,
    customFieldsSource: "item.notes"
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
