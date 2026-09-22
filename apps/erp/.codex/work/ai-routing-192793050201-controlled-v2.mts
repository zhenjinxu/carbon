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
    if (!key || rawValue === undefined) continue;
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
loadEnvFile(resolve(root, "apps/erp/.env.local"), true);
process.env.AI_ROUTING_DRAWING_MODEL_PROVIDER = "openai";
process.env.AI_ROUTING_DRAWING_MODEL_NAME = "gpt-5.6-terra";

const requireFromRoot = createRequire(resolve(root, "package.json"));
const { getPostgresConnectionPool, getPostgresClient } = await import(
  pathToFileURL(
    resolve(root, "packages/database/supabase/functions/lib/postgres/index.ts")
  ).href
);
const { PostgresDriver } = await import(
  pathToFileURL(requireFromRoot.resolve("kysely")).href
);
const { enqueueAiRoutingDrawingExtraction } = await import(
  pathToFileURL(resolve(root, "apps/erp/app/modules/items/ai-routing.server.ts")).href
);
const {
  runAiRoutingDrawingExtraction,
  PermanentAiRoutingDrawingExtractionError
} = await import(
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
const { createClient } = await import(
  pathToFileURL(requireFromRoot.resolve("@supabase/supabase-js")).href
);

const companyId = "d8s9bh4f8gm357312pbg";
const readableId = "192793050201";
const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

const { data: item, error: itemError } = await carbon
  .from("item")
  .select("id, readableId, createdBy")
  .eq("companyId", companyId)
  .eq("readableId", readableId)
  .maybeSingle();
if (itemError || !item) throw itemError ?? new Error(`Part ${readableId} not found`);

const { data: document, error: documentError } = await carbon
  .from("document")
  .select("id, name, path, type, extension, active")
  .eq("companyId", companyId)
  .eq("sourceDocument", "Part")
  .eq("sourceDocumentId", item.id)
  .eq("active", true)
  .eq("type", "PDF")
  .order("createdAt", { ascending: false })
  .limit(1)
  .maybeSingle();
if (documentError || !document) {
  throw documentError ?? new Error(`Active PDF for ${readableId} not found`);
}

const userId = item.createdBy;
if (!userId) throw new Error(`Part ${readableId} has no createdBy user`);

let capturedPayload: Record<string, string> | null = null;
const enqueueResult = await enqueueAiRoutingDrawingExtraction(
  getPostgresClient(getPostgresConnectionPool(4), PostgresDriver),
  { companyId, userId, itemId: item.id, documentId: document.id },
  async (payload) => {
    capturedPayload = payload;
  }
);
const extractionId = enqueueResult.extractionId;
if (!capturedPayload || capturedPayload.extractionId !== extractionId) {
  throw new Error("Controlled enqueue did not return its committed event payload");
}

const markProcessing = async (payload: Record<string, string>) => {
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
};

const markSucceeded = async (payload: Record<string, string>, update: Record<string, unknown>) => {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Succeeded",
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
};

const markFailed = async (payload: Record<string, string>, update: Record<string, unknown>) => {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Failed",
      errorCategory: update.errorCategory,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
      completedAt: new Date().toISOString(),
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error && !update.retryable) throw error;
};

try {
  const result = await runAiRoutingDrawingExtraction(capturedPayload, {
    markProcessing,
    loadPartPdf: async (payload) => {
      const { data, error } = await carbon.storage.from("private").download(document.path);
      if (error || !data) {
        throw new PermanentAiRoutingDrawingExtractionError(
          "STORAGE_DOWNLOAD_FAILED",
          error?.message ?? "Failed to download Part PDF",
          "Storage"
        );
      }
      return { bytes: new Uint8Array(await data.arrayBuffer()) };
    },
    renderPdf: renderAiRoutingPdfDrawingForModel,
    extractDrawing: extractDrawingWithConfiguredModel,
    markSucceeded,
    markFailed
  });
  console.log(JSON.stringify({ readableId, extractionId, result }));
} catch (error) {
  console.log(JSON.stringify({ readableId, extractionId, status: "Failed", error: safeMessage(error) }));
  process.exitCode = 1;
}

await carbon.auth.signOut();
