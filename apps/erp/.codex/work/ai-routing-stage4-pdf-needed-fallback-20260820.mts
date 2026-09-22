import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
function findRoot(start: string) {
  let current = start;
  for (;;) {
    try { if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") return current; } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}
const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");
const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const currentSecondBatch = [
  "1927930501", "1927930502", "1927930503", "1927930601", "1927930602", "1927930603",
  "192793050101", "192793050200", "192793050201", "192793060101", "192793060200", "192793060201"
];
const selectedValid = new Set(["1927930202", "192793020201", "1927930206", "asm-top-001"]);
const outputJsonPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-pdf-needed-fallback-20260820.json");
const outputMarkdownPath = resolve(root, "llm/tasks/ai-routing-stage4-pdf-needed-fallback-20260820.md");
const bucketNeeds = [
  { key: "laser_bending_baseline", label: "Laser + bending sheet-metal baseline", needed: 2, patterns: [/激光.*折弯|折弯.*激光/] },
  { key: "hole_slot_countersink", label: "Hole-heavy / countersink / slot features", needed: 4, patterns: [/钻床|钻孔|攻丝|孔|线切割|槽/] },
  { key: "tapping_drilling_machining", label: "Tapping / drilling / machining follow-up", needed: 3, patterns: [/攻丝|钻床|机加工|加工中心|车床|铣|线切割|cnc/i] },
  { key: "welding_fabrication", label: "Welding / fabrication", needed: 5, patterns: [/焊|拼装|组焊|装配|铆/] },
  { key: "deburr_grind_brush_polish", label: "Deburr / grinding / brushing / polishing", needed: 4, patterns: [/打磨|拉丝|抛光|喷砂|磨/] },
  { key: "outsourcing_surface_treatment", label: "Outsourcing / surface treatment", needed: 3, patterns: [/外协|喷漆|喷涂|电镀|氧化|发黑|热处理|表面|喷砂/] },
  { key: "weak_ambiguous_drawings", label: "Weak / ambiguous drawings", needed: 1, patterns: [/^0010| -> 00|领料工作中心$/] }
] as const;
function norm(value: unknown) { return String(value ?? "").toLowerCase().replace(/u8\s+[a-z0-9_-]+\s+/gi, ""); }
function labelsFor(route: string, name: string) {
  const text = norm(`${route} ${name}`);
  return bucketNeeds.filter((bucket) => bucket.patterns.some((pattern) => pattern.test(text))).map((bucket) => bucket.key);
}
function score(row: any) {
  const text = norm(`${row.route} ${row.name ?? ""}`);
  let value = Number(row.ops ?? 0) * 5;
  if (/焊|攻丝|钻|机加工|加工中心|打磨|拉丝|抛光|外协|喷漆|氧化/.test(text)) value += 20;
  if (/^0010| -> 00/.test(text)) value -= 15;
  if (/领料工作中心$/.test(text)) value -= 10;
  return value;
}
try {
  const result = await pool.query(`
    WITH valid_pdf AS (
      SELECT DISTINCT "sourceDocumentId" AS "itemId"
      FROM "document"
      WHERE "companyId" = $1
        AND "active" = true
        AND "sourceDocument" = 'Part'
        AND "type" = 'PDF'
        AND lower(COALESCE("extension", '')) = 'pdf'
    ), active_route AS (
      SELECT
        mm."itemId",
        COUNT(mo."id")::int AS ops,
        STRING_AGG(COALESCE(p."name", mo."processId"), ' -> ' ORDER BY mo."order") AS route
      FROM "makeMethod" mm
      INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
      LEFT JOIN "process" p ON p."companyId" = mo."companyId" AND p."id" = mo."processId"
      WHERE mm."companyId" = $1 AND mm."status" = 'Active'::"makeMethodStatus"
      GROUP BY mm."itemId"
    ), roles AS (
      SELECT "itemId", ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS roles
      FROM "aiRoutingSample"
      WHERE "companyId" = $1
      GROUP BY "itemId"
    ), drafts AS (
      SELECT "itemId", COUNT(*)::int AS "draftCount"
      FROM "aiRoutingDraft"
      WHERE "companyId" = $1
      GROUP BY "itemId"
    )
    SELECT
      item."id" AS "itemId",
      item."readableId",
      item."readableIdWithRevision",
      item."name",
      active_route.ops,
      active_route.route,
      COALESCE(roles.roles, ARRAY[]::text[]) AS roles,
      COALESCE(drafts."draftCount", 0)::int AS "draftCount"
    FROM "item" item
    INNER JOIN active_route ON active_route."itemId" = item."id"
    LEFT JOIN valid_pdf ON valid_pdf."itemId" = item."id"
    LEFT JOIN roles ON roles."itemId" = item."id"
    LEFT JOIN drafts ON drafts."itemId" = item."id"
    WHERE item."companyId" = $1
      AND valid_pdf."itemId" IS NULL
      AND NOT COALESCE(roles.roles && ARRAY['Training','Evaluation'], false)
      AND COALESCE(drafts."draftCount", 0) = 0
      AND COALESCE(item."readableId", '') <> ALL($2::text[])
      AND COALESCE(item."readableIdWithRevision", '') <> ALL($2::text[])
    ORDER BY item."readableId"
  `, [companyId, currentSecondBatch]);
  const candidates = result.rows
    .map((row: any) => ({
      ...row,
      readableId: row.readableId ?? row.readableIdWithRevision ?? row.itemId,
      labels: labelsFor(row.route, row.name),
      score: score(row)
    }))
    .filter((row: any) => !selectedValid.has(row.readableId));
  const selected: any[] = [];
  const selectedIds = new Set<string>();
  const bucketSummary = bucketNeeds.map((bucket) => {
    const pool = candidates
      .filter((row: any) => row.labels.includes(bucket.key) && !selectedIds.has(row.itemId))
      .sort((a: any, b: any) => b.score - a.score || String(a.readableId).localeCompare(String(b.readableId)));
    const picked = pool.slice(0, bucket.needed);
    for (const row of picked) {
      row.bucket = bucket.label;
      selectedIds.add(row.itemId);
      selected.push(row);
    }
    return { key: bucket.key, label: bucket.label, needed: bucket.needed, selected: picked.length, available: pool.length };
  });
  if (selected.length < 22) {
    const fill = candidates
      .filter((row: any) => !selectedIds.has(row.itemId))
      .sort((a: any, b: any) => b.score - a.score || String(a.readableId).localeCompare(String(b.readableId)))
      .slice(0, 22 - selected.length);
    for (const row of fill) {
      row.bucket = "Best remaining active truth route needing PDF";
      selectedIds.add(row.itemId);
      selected.push(row);
    }
  }
  selected.forEach((row, index) => { row.rank = index + 1; });
  const output = {
    companyId,
    scannedAt: new Date().toISOString(),
    fallbackType: "Not valid Evaluation holdouts until active Part PDFs are attached/provided.",
    poolCount: candidates.length,
    selectedCount: selected.length,
    bucketSummary,
    selected: selected.map((row) => ({
      rank: row.rank,
      readableId: row.readableId,
      readableIdWithRevision: row.readableIdWithRevision,
      name: row.name,
      bucket: row.bucket,
      operationCount: Number(row.ops ?? 0),
      routeSignature: row.route,
      labels: row.labels
    }))
  };
  const rows = output.selected.map((row) => `| ${row.rank} | ${row.readableId} | ${row.name ?? ""} | ${row.bucket} | ${row.operationCount} | ${row.routeSignature.replace(/\|/g, "/")} |`).join("\n");
  const markdown = `# AI Routing Stage 4 PDF-Needed Fallback Candidates (2026-08-20)\n\nThese are not valid Evaluation holdouts yet because no active Part PDF is attached in Carbon. Use this list only to request/provide drawings when the strict PDF-backed pool is insufficient.\n\n- Active truth routes without valid Part PDF and without current AI Routing Training/Evaluation role: ${output.poolCount}\n- Suggested fallback parts needing PDF: ${output.selectedCount}\n\n| Rank | Part | Name | Coverage | Ops | Active Truth Route |\n|---:|---|---|---|---:|---|\n${rows}\n\nNext gate: attach/provide PDFs, then rerun \`ai-routing-stage4-propose-evaluation-holdouts-20260820.mts\`.\n`;
  writeFileSync(outputJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(outputMarkdownPath, markdown, "utf8");
  console.log(JSON.stringify({ selectedCount: output.selectedCount, poolCount: output.poolCount, outputJsonPath, outputMarkdownPath, selected: output.selected }, null, 2));
} finally {
  await pool.end();
}