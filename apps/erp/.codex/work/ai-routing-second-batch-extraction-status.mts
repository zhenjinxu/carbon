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

const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);
const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href
);
const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const companyId = "d8s9bh4f8gm357312pbg";
const partIds = [
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
];

const { data: items, error: itemError } = await carbon
  .from("item")
  .select("id,readableId")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;
const itemById = new Map((items ?? []).map((item) => [item.id, item.readableId]));
const itemIds = (items ?? []).map((item) => item.id);
const { data: extractions, error } = itemIds.length
  ? await carbon
      .from("aiDrawingExtraction")
      .select("id,itemId,documentId,status,modelProvider,modelName,pageCount,createdAt,startedAt,completedAt,errorCode,errorMessage")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("createdAt", { ascending: false })
  : { data: [], error: null };
if (error) throw error;

const latestByItem = new Map<string, any>();
for (const extraction of extractions ?? []) {
  if (!latestByItem.has(extraction.itemId)) latestByItem.set(extraction.itemId, extraction);
}
const rows = partIds.map((readableId) => {
  const item = (items ?? []).find((row) => row.readableId === readableId);
  const extraction = item ? latestByItem.get(item.id) : null;
  return {
    readableId,
    status: extraction?.status ?? "Missing",
    extractionId: extraction?.id ?? null,
    model: extraction?.modelName ?? null,
    pageCount: extraction?.pageCount ?? null,
    startedAt: extraction?.startedAt ?? null,
    completedAt: extraction?.completedAt ?? null,
    errorCode: extraction?.errorCode ?? null,
    errorMessage: extraction?.errorMessage ?? null
  };
});
const counts = rows.reduce((acc: Record<string, number>, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ companyId, counts, rows }, null, 2));
if ((counts.Succeeded ?? 0) !== partIds.length) process.exitCode = 2;