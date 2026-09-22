import { Buffer } from "node:buffer";
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
const { openai } = await import(
  pathToFileURL(requireFromJobs.resolve("@ai-sdk/openai")).href
);
const { generateObject } = await import(
  pathToFileURL(requireFromJobs.resolve("ai")).href
);
const {
  AI_ROUTING_DRAWING_SCHEMA_VERSION,
  aiRoutingDrawingExtractionSchema,
  normalizeAiRoutingDrawingExtraction
} = await import(
  pathToFileURL(resolve(root, "packages/lib/src/ai-routing-drawing.ts")).href
);
const { renderAiRoutingPdfDrawingForModel } = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/part-drawing-renderer.ts")
  ).href
);

const AI_ROUTING_DRAWING_PROMPT_VERSION = "ai-routing-drawing.prompt.v1";
const AI_ROUTING_DRAWING_SCHEMA_NAME = "ai_routing_drawing_extraction";
const AI_ROUTING_DRAWING_SCHEMA_DESCRIPTION =
  "Traceable structured facts extracted only from visible Part PDF drawing pages";

class PermanentAiRoutingDrawingExtractionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly errorCategory: "Input" | "Storage" | "Model" | "Configuration" = "Input"
  ) {
    super(message);
    this.name = "PermanentAiRoutingDrawingExtractionError";
  }
}

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

function buildSystemPrompt() {
  return `You extract structured manufacturing facts from Part PDF drawing page images for Carbon AI routing.

Return only the JSON object matching the supplied schema. Use exact field names and enum values from the schema.

Rules:
- Use only visible PDF drawing evidence from the supplied page images and render metadata.
- Do not use existing make-methods, confirmed route records, training answers, process sequences, work centers, or resource assignments.
- Do not propose manufacturing operations. Extract drawing facts only.
- If a value is missing, unreadable, or uncertain, use null, an empty array, explicitUnknowns, and warnings as appropriate.
- Every dimension, feature, and note must include page-level evidence with confidence.
- boundingBox coordinates are optional, but when present they must be normalized page fractions, not pixels: x/pageWidth, y/pageHeight, width/pageWidth, and height/pageHeight. Each value must be between 0 and 1, and the box must stay within the page bounds.
- Keep evidence text short and limited to the visible callout/title-block text needed for traceability.
- Set document.contentHash, document.pageCount, and document.renderedPageCount from the render metadata supplied in the user message.`;
}

function buildUserText(args: any) {
  const pageLines = args.renderSummary.pages
    .map(
      (page: any) =>
        `page ${page.pageNumber}: ${page.width}x${page.height}px, textItems=${page.textItemCount}, textChars=${page.textCharCount}`
    )
    .join("\n");

  return `Use only visible PDF drawing evidence.

Document metadata:
- schemaVersion: ${AI_ROUTING_DRAWING_PROMPT_VERSION}
- contentHash: ${args.renderSummary.contentHash}
- pageCount: ${args.renderSummary.pageCount}
- renderedPageCount: ${args.renderSummary.renderedPageCount}
- rendererVersion: ${args.renderSummary.rendererVersion}

Rendered pages:
${pageLines}

When including boundingBox evidence, normalize coordinates against that page's listed pixel width and height. Never return pixel coordinates.

Return a complete ai-routing-drawing.v1 object. Do not infer missing material, dimensions, tolerances, features, finish, heat treatment, or part class from prior Carbon data.`;
}

async function extractDrawing(args: any) {
  if (args.pages.length === 0) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "NO_RENDERED_PAGES",
      "Part PDF produced no rendered pages for drawing extraction",
      "Input"
    );
  }
  const provider = process.env.AI_ROUTING_DRAWING_MODEL_PROVIDER?.trim().toLowerCase();
  const modelName = process.env.AI_ROUTING_DRAWING_MODEL_NAME?.trim();
  if (provider !== "openai" || !modelName) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "MODEL_NOT_CONFIGURED",
      "AI routing drawing extraction model is not configured",
      "Configuration"
    );
  }

  const { object } = await generateObject({
    model: openai(modelName),
    schema: aiRoutingDrawingExtractionSchema,
    schemaName: AI_ROUTING_DRAWING_SCHEMA_NAME,
    schemaDescription: AI_ROUTING_DRAWING_SCHEMA_DESCRIPTION,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildUserText(args) },
          ...args.pages.map((page: any) => ({
            type: "image" as const,
            image: Buffer.from(page.imageBytes),
            mediaType: page.mediaType
          }))
        ]
      }
    ],
    temperature: 0.1,
    abortSignal: AbortSignal.timeout(600000),
    maxRetries: 0
  } as any);

  return {
    extraction: object,
    modelProvider: provider,
    modelName,
    promptVersion: AI_ROUTING_DRAWING_PROMPT_VERSION
  };
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
  if (!document.active) throw new PermanentAiRoutingDrawingExtractionError("INACTIVE_DOCUMENT", "Part PDF document is not active");
  if (document.sourceDocument !== "Part" || document.sourceDocumentId !== payload.itemId) {
    throw new PermanentAiRoutingDrawingExtractionError("ITEM_MISMATCH", "Part PDF document is not attached to the requested item");
  }
  if (document.type !== "PDF" || document.extension?.toLowerCase() !== "pdf") {
    throw new PermanentAiRoutingDrawingExtractionError("NON_PDF_DOCUMENT", "Document metadata does not describe a PDF");
  }
  const metadataSize = Number(document.size);
  if (Number.isFinite(metadataSize) && metadataSize > maxBytes) {
    throw new PermanentAiRoutingDrawingExtractionError("OVERSIZED_DOCUMENT", "Part PDF document exceeds the maximum AI routing extraction size");
  }
  const expectedPrefix = `${payload.companyId}/parts/${payload.itemId}/`;
  const pathSegments = String(document.path).split("/");
  if (
    !document.path?.startsWith(expectedPrefix) ||
    pathSegments.some((segment) => segment === "." || segment === "..") ||
    !document.path.toLowerCase().endsWith(".pdf")
  ) {
    throw new PermanentAiRoutingDrawingExtractionError("INVALID_STORAGE_PATH", "Part PDF document path is outside the expected private storage prefix");
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
  if (bytes.byteLength > maxBytes) throw new PermanentAiRoutingDrawingExtractionError("OVERSIZED_DOCUMENT", "Downloaded Part PDF exceeds the maximum AI routing extraction size");
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (header !== "%PDF-") throw new PermanentAiRoutingDrawingExtractionError("INVALID_PDF_BYTES", "Downloaded file is not a PDF document");
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
}

async function markFailed(payload: any, update: any) {
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
}

async function runExtraction(payload: any) {
  try {
    console.log(
      JSON.stringify({ extractionId: payload.extractionId, phase: "mark-processing" })
    );
    await markProcessing(payload);
    console.log(
      JSON.stringify({ extractionId: payload.extractionId, phase: "load-pdf" })
    );
    const { bytes } = await loadPartPdf(payload);
    console.log(
      JSON.stringify({
        extractionId: payload.extractionId,
        phase: "render-pdf",
        bytes: bytes.byteLength
      })
    );
    const renderResult = await renderAiRoutingPdfDrawingForModel(bytes, { scale: 0.75 });
    console.log(
      JSON.stringify({
        extractionId: payload.extractionId,
        phase: "extract-model",
        pageCount: renderResult.summary.pageCount,
        contentHash: renderResult.summary.contentHash
      })
    );
    const extractionResult = await extractDrawing({
      payload,
      renderSummary: renderResult.summary,
      pages: renderResult.pages
    });
    console.log(
      JSON.stringify({ extractionId: payload.extractionId, phase: "normalize" })
    );
    const extraction = normalizeAiRoutingDrawingExtraction(
      extractionResult.extraction
    );
    if (extraction.document.contentHash !== renderResult.summary.contentHash) {
      throw new PermanentAiRoutingDrawingExtractionError(
        "EXTRACTION_HASH_MISMATCH",
        "Model extraction content hash does not match rendered PDF hash",
        "Model"
      );
    }
    console.log(
      JSON.stringify({ extractionId: payload.extractionId, phase: "mark-succeeded" })
    );
    await markSucceeded(payload, {
      contentHash: renderResult.summary.contentHash,
      rendererVersion: renderResult.summary.rendererVersion,
      extractorSchemaVersion: AI_ROUTING_DRAWING_SCHEMA_VERSION,
      promptVersion: extractionResult.promptVersion,
      modelProvider: extractionResult.modelProvider,
      modelName: extractionResult.modelName,
      pageCount: renderResult.summary.pageCount,
      extraction,
      warnings: extraction.warnings
    });
    return { status: "Succeeded" };
  } catch (error) {
    if (error instanceof PermanentAiRoutingDrawingExtractionError) {
      await markFailed(payload, {
        errorCategory: error.errorCategory,
        errorCode: error.code,
        errorMessage: error.message,
        retryable: false
      });
      return {
        status: "Failed",
        errorCategory: error.errorCategory,
        errorCode: error.code
      };
    }
    await markFailed(payload, {
      errorCategory: "Model",
      errorCode: error instanceof Error ? error.name : "RETRYABLE_EXTRACTION_ERROR",
      errorMessage: safeMessage(error),
      retryable: true
    });
    throw error;
  }
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
    const result = await runExtraction(payload);
    results.push({ readableId, extractionId: extraction.id, ...result });
    console.log(JSON.stringify({ readableId, extractionId: extraction.id, ...result }));
  } catch (error) {
    const result = { readableId, extractionId: extraction.id, status: "Failed", error: safeMessage(error) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}

const counts = results.reduce((acc: Record<string, number>, result: any) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ companyId, model: process.env.AI_ROUTING_DRAWING_MODEL_NAME, counts, results }, null, 2));
if ((counts.Succeeded ?? 0) + (counts.Skipped ?? 0) !== results.length) process.exitCode = 2;
