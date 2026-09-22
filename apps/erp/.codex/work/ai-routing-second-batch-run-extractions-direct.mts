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

process.env.AI_ROUTING_DRAWING_MODEL_PROVIDER = "openai";
process.env.AI_ROUTING_DRAWING_MODEL_NAME = "gpt-5.6-terra";
process.env.OPENAI_BASE_URL ??= "http://127.0.0.1:15721/v1";

const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href
);
const { runAiRoutingDrawingExtraction, PermanentAiRoutingDrawingExtractionError } =
  await import(
    pathToFileURL(
      resolve(root, "packages/jobs/src/inngest/functions/items/extract-part-drawing.runner.ts")
    ).href
  );
const { renderAiRoutingPdfDrawingForModel } = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/part-drawing-renderer.ts")
  ).href
);
const { extractDrawingWithConfiguredModel } = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/extract-part-drawing-model.ts")
  ).href
);

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const companyId = "d8s9bh4f8gm357312pbg";
const allPartIds = [
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
const requestedPartIds = process.argv.slice(2);
const partIds = requestedPartIds.length > 0 ? requestedPartIds : allPartIds;
const maxBytes = 30 * 1024 * 1024;

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

async function loadPartPdf(payload: any) {
  const documentResult = await carbon
    .from("document")
    .select("id, companyId, sourceDocument, sourceDocumentId, active, path, extension, type, size")
    .eq("id", payload.documentId)
    .eq("companyId", payload.companyId)
    .maybeSingle();

  if (documentResult.error || !documentResult.data) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "DOCUMENT_NOT_FOUND",
      documentResult.error?.message ?? "Part PDF document was not found"
    );
  }

  const itemResult = await carbon
    .from("item")
    .select("id, companyId, type")
    .eq("id", payload.itemId)
    .eq("companyId", payload.companyId)
    .maybeSingle();

  if (itemResult.error || !itemResult.data || itemResult.data.type !== "Part") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "ITEM_NOT_FOUND",
      itemResult.error?.message ?? "Part item was not found"
    );
  }

  const document = documentResult.data;
  if (!document.active) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INACTIVE_DOCUMENT",
      "Part PDF document is not active"
    );
  }
  if (document.sourceDocument !== "Part" || document.sourceDocumentId !== payload.itemId) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "ITEM_MISMATCH",
      "Part PDF document is not attached to the requested item"
    );
  }
  if (document.type !== "PDF" || document.extension?.toLowerCase() !== "pdf") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "NON_PDF_DOCUMENT",
      "Document metadata does not describe a PDF"
    );
  }
  const metadataSize = Number(document.size);
  if (Number.isFinite(metadataSize) && metadataSize > maxBytes) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "OVERSIZED_DOCUMENT",
      "Part PDF document exceeds the maximum AI routing extraction size"
    );
  }
  const expectedPrefix = `${payload.companyId}/parts/${payload.itemId}/`;
  const pathSegments = String(document.path).split("/");
  if (
    !document.path?.startsWith(expectedPrefix) ||
    pathSegments.some((segment) => segment === "." || segment === "..") ||
    !document.path.toLowerCase().endsWith(".pdf")
  ) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INVALID_STORAGE_PATH",
      "Part PDF document path is outside the expected private storage prefix"
    );
  }

  const { data, error } = await carbon.storage.from("private").download(document.path);
  if (error || !data) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "STORAGE_DOWNLOAD_FAILED",
      error?.message ?? "Failed to download Part PDF from private storage",
      "Storage"
    );
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "OVERSIZED_DOCUMENT",
      "Downloaded Part PDF exceeds the maximum AI routing extraction size"
    );
  }
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INVALID_PDF_BYTES",
      "Downloaded file is not a PDF document"
    );
  }
  return { bytes };
}

async function markProcessing(payload: any) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Processing",
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error) throw error;
}

async function markSucceeded(payload: any, update: any) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: update.status,
      contentHash: update.contentHash,
      rendererVersion: update.rendererVersion,
      extractorSchemaVersion: update.extractorSchemaVersion,
      promptVersion: update.promptVersion,
      modelProvider: update.modelProvider,
      modelName: update.modelName,
      pageCount: update.pageCount,
      extraction: update.extraction,
      warnings: update.warnings,
      completedAt: new Date().toISOString(),
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error) throw error;
}

async function markFailed(payload: any, update: any) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: update.status,
      errorCategory: update.errorCategory,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
      completedAt: new Date().toISOString(),
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error && !update.retryable) throw error;
}

const { data: items, error: itemError } = await carbon
  .from("item")
  .select("id,readableId")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;
const itemsByReadable = new Map((items ?? []).map((item) => [item.readableId, item]));
const results = [];

for (const readableId of partIds) {
  const item = itemsByReadable.get(readableId);
  if (!item) {
    results.push({ readableId, status: "Skipped", reason: "item_missing" });
    continue;
  }

  const { data: extractionRows, error } = await carbon
    .from("aiDrawingExtraction")
    .select("id,itemId,documentId,status,createdBy,updatedBy,createdAt")
    .eq("companyId", companyId)
    .eq("itemId", item.id)
    .order("createdAt", { ascending: false })
    .limit(1);
  if (error) throw error;
  const extraction = extractionRows?.[0];
  if (!extraction) {
    results.push({ readableId, status: "Skipped", reason: "extraction_missing" });
    continue;
  }
  if (extraction.status === "Succeeded") {
    results.push({ readableId, status: "Skipped", reason: "already_succeeded" });
    continue;
  }

  const payload = {
    companyId,
    userId: extraction.updatedBy || extraction.createdBy,
    itemId: item.id,
    documentId: extraction.documentId,
    extractionId: extraction.id
  };

  try {
    const result = await runAiRoutingDrawingExtraction(payload, {
      markProcessing,
      loadPartPdf,
      renderPdf: renderAiRoutingPdfDrawingForModel,
      extractDrawing: extractDrawingWithConfiguredModel,
      markSucceeded,
      markFailed
    });
    results.push({ readableId, extractionId: extraction.id, ...result });
    console.log(JSON.stringify({ readableId, extractionId: extraction.id, ...result }));
  } catch (error) {
    results.push({
      readableId,
      extractionId: extraction.id,
      status: "Failed",
      error: safeMessage(error)
    });
    console.log(
      JSON.stringify({
        readableId,
        extractionId: extraction.id,
        status: "Failed",
        error: safeMessage(error)
      })
    );
  }
}

const counts = results.reduce((acc: Record<string, number>, result: any) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ companyId, model: process.env.AI_ROUTING_DRAWING_MODEL_NAME, counts, results }, null, 2));
if ((counts.Succeeded ?? 0) + (counts.Skipped ?? 0) !== results.length) process.exitCode = 2;