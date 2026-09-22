import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
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
const { data: items, error: itemError } = await carbon
  .from("item")
  .select("id,readableId,readableIdWithRevision,name")
  .eq("companyId", companyId)
  .eq("readableId", "192793050201")
  .limit(1);
if (itemError) throw itemError;
const item = items?.[0];
if (!item) throw new Error("Item not found");

const { data: documents, error: documentError } = await carbon
  .from("document")
  .select("id,name,path,extension,type,sourceDocument,sourceDocumentId,size,active")
  .eq("companyId", companyId)
  .eq("sourceDocumentId", item.id)
  .eq("active", true)
  .order("createdAt", { ascending: false });
if (documentError) throw documentError;

const rows = [];
for (const document of documents ?? []) {
  const row: Record<string, unknown> = {
    id: document.id,
    name: document.name,
    path: document.path,
    extension: document.extension,
    type: document.type,
    sourceDocument: document.sourceDocument,
    sourceDocumentId: document.sourceDocumentId,
    size: document.size,
    signedUrl: null,
    downloadedPath: null,
    downloadError: null
  };
  if (document.extension?.toLowerCase() === "pdf" && document.path) {
    const signed = await carbon.storage
      .from("private")
      .createSignedUrl(document.path, 600);
    if (signed.error) {
      row.downloadError = signed.error.message;
    } else if (signed.data?.signedUrl) {
      row.signedUrl = "[redacted]";
      try {
        const response = await fetch(signed.data.signedUrl);
        if (!response.ok) {
          row.downloadError = "HTTP " + response.status;
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const safeName = String(document.name ?? document.id).replace(
            /[^A-Za-z0-9_.-]+/g,
            "_"
          );
          const outputPath = resolve(
            process.cwd(),
            ".codex/work/192793050201-" + (safeName || document.id) + ".pdf"
          );
          writeFileSync(outputPath, bytes);
          row.downloadedPath = outputPath;
        }
      } catch (error) {
        row.downloadError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  rows.push(row);
}

const { data: extractions, error: extractionError } = await carbon
  .from("aiDrawingExtraction")
  .select("id,documentId,status,completedAt,modelName,pageCount,contentHash")
  .eq("companyId", companyId)
  .eq("itemId", item.id)
  .order("createdAt", { ascending: false });
if (extractionError) throw extractionError;

const outputPath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-192793050201-document-info-20260819.json"
);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      item,
      documents: rows,
      extractions
    },
    null,
    2
  ),
  "utf8"
);
console.log(JSON.stringify({ outputPath, item, documents: rows, extractions }, null, 2));