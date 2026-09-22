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
const { trigger } = await import(
  pathToFileURL(resolve(root, "packages/lib/src/trigger.ts")).href
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

function first<T>(rows: T[] | null | undefined): T | null {
  return rows?.[0] ?? null;
}

const { data: itemRows, error: itemError } = await carbon
  .from("item")
  .select("id, readableId, createdBy")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;

const itemsByReadable = new Map(
  (itemRows ?? []).map((item) => [item.readableId, item])
);

const results = [];
for (const readableId of partIds) {
  const item = itemsByReadable.get(readableId);
  if (!item) {
    results.push({ readableId, status: "Skipped", reason: "item_missing" });
    continue;
  }

  const { data: documents, error: documentError } = await carbon
    .from("document")
    .select("id,name,path,extension,type,active,sourceDocument,sourceDocumentId,updatedAt")
    .eq("companyId", companyId)
    .eq("sourceDocument", "Part")
    .eq("sourceDocumentId", item.id)
    .eq("active", true)
    .order("updatedAt", { ascending: false });
  if (documentError) throw documentError;

  const document = first(
    (documents ?? []).filter((row) => {
      const extension = String(row.extension ?? "").toLowerCase();
      return row.type === "PDF" || extension === "pdf";
    })
  );

  if (!document) {
    results.push({ readableId, status: "Skipped", reason: "active_pdf_missing" });
    continue;
  }

  const { data: existingRows, error: existingError } = await carbon
    .from("aiDrawingExtraction")
    .select("id,status,createdAt")
    .eq("companyId", companyId)
    .eq("itemId", item.id)
    .eq("documentId", document.id)
    .in("status", ["Pending", "Processing"])
    .order("createdAt", { ascending: false })
    .limit(1);
  if (existingError) throw existingError;

  let extractionId = existingRows?.[0]?.id ?? null;
  const created = !extractionId;
  const userId = process.env.U8_CARBON_USER_ID || item.createdBy;
  if (!userId) {
    results.push({ readableId, status: "Skipped", reason: "user_missing" });
    continue;
  }

  if (!extractionId) {
    const { data: inserted, error: insertError } = await carbon
      .from("aiDrawingExtraction")
      .insert({
        companyId,
        itemId: item.id,
        documentId: document.id,
        status: "Pending",
        createdBy: userId,
        updatedBy: userId
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    extractionId = inserted.id;
  }

  await trigger("ai-routing-extract-part-drawing", {
    companyId,
    userId,
    itemId: item.id,
    documentId: document.id,
    extractionId
  });

  results.push({
    readableId,
    status: created ? "Queued" : "Requeued",
    documentId: document.id,
    extractionId
  });
}

console.log(
  JSON.stringify(
    {
      companyId,
      partCount: partIds.length,
      queued: results.filter((row) => row.status === "Queued").length,
      requeued: results.filter((row) => row.status === "Requeued").length,
      skipped: results.filter((row) => row.status === "Skipped").length,
      results
    },
    null,
    2
  )
);