import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function safeName(value: unknown) {
  return String(value ?? "file").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120) || "file";
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);
loadEnvFile(resolve(root, "apps/erp/.env.local"), true);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { createClient } = await import(pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href);
const carbon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const auditPath = resolve(root, "apps/erp/.codex/work/ai-routing-data-governance-residual-audit-20260824.json");
const outputDir = resolve(root, "apps/erp/.codex/work/ai-routing-source-pdf-review-packet-20260824");
const outputManifestPath = resolve(root, "apps/erp/.codex/work/ai-routing-source-pdf-review-downloads-20260824.json");
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
mkdirSync(outputDir, { recursive: true });

const downloads = [];
for (const target of audit.targets ?? []) {
  for (const document of target.sourceAvailability?.partPdfDocuments ?? []) {
    const row: Record<string, unknown> = {
      readableId: target.readableId,
      documentId: document.id,
      documentName: document.name ?? null,
      storagePath: document.path ?? null,
      localPath: null,
      byteLength: null,
      status: "pending",
      error: null
    };
    try {
      if (!document.path) throw new Error("Document path is missing");
      const signed = await carbon.storage.from("private").createSignedUrl(document.path, 600);
      if (signed.error) throw signed.error;
      if (!signed.data?.signedUrl) throw new Error("Signed URL was not returned");
      const response = await fetch(signed.data.signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const outputPath = resolve(outputDir, `${safeName(target.readableId)}-${safeName(document.name ?? document.id)}.pdf`);
      writeFileSync(outputPath, bytes);
      row.localPath = outputPath;
      row.byteLength = bytes.byteLength;
      row.status = "downloaded";
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
    }
    downloads.push(row);
  }
}

const output = {
  downloadedAt: new Date().toISOString(),
  outputDir,
  downloadCount: downloads.filter((row) => row.status === "downloaded").length,
  failureCount: downloads.filter((row) => row.status === "failed").length,
  downloads
};
writeFileSync(outputManifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  downloadedAt: output.downloadedAt,
  downloadCount: output.downloadCount,
  failureCount: output.failureCount,
  outputDir,
  outputManifestPath
}, null, 2));