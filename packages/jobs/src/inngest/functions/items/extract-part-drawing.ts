import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";
import {
  type AiRoutingDrawingExtractionPayload,
  aiRoutingDrawingExtractionPayloadSchema,
  type FailedUpdate,
  type LoadPartPdfResult,
  PermanentAiRoutingDrawingExtractionError,
  runAiRoutingDrawingExtraction,
  type SucceededUpdate
} from "./extract-part-drawing.runner";
import { extractDrawingWithConfiguredModel } from "./extract-part-drawing-model";
import { renderAiRoutingPdfDrawingForModel } from "./part-drawing-renderer";

export {
  aiRoutingDrawingExtractionPayloadSchema,
  PermanentAiRoutingDrawingExtractionError,
  runAiRoutingDrawingExtraction
} from "./extract-part-drawing.runner";
export const extractPartDrawingFunction = inngest.createFunction(
  {
    id: "ai-routing-extract-part-drawing",
    retries: 2,
    idempotency: "event.data.extractionId",
    concurrency: {
      limit: 2,
      key: "event.data.companyId + '-' + event.data.itemId"
    }
  },
  { event: "carbon/ai-routing.extract-part-drawing" },
  async ({ event, step }) => {
    const payload = aiRoutingDrawingExtractionPayloadSchema.parse(event.data);

    return runAiRoutingDrawingExtraction(payload, {
      markProcessing: async (data) => {
        await step.run("mark-processing", () => markExtractionProcessing(data));
      },
      loadPartPdf,
      renderPdf: renderAiRoutingPdfDrawingForModel,
      extractDrawing: (args) =>
        step.run("extract-drawing", () =>
          extractDrawingWithConfiguredModel(args)
        ),
      markSucceeded: async (data, update) => {
        await step.run("mark-succeeded", () =>
          markExtractionSucceeded(data, update)
        );
      },
      markFailed: async (data, update) => {
        await step.run("mark-failed", () => markExtractionFailed(data, update));
      }
    });
  }
);

async function markExtractionProcessing(
  payload: AiRoutingDrawingExtractionPayload
) {
  const carbon = getCarbonServiceRole() as any;
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

  if (error) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "EXTRACTION_ROW_NOT_FOUND",
      error.message,
      "Input"
    );
  }
}

async function markExtractionSucceeded(
  payload: AiRoutingDrawingExtractionPayload,
  update: SucceededUpdate
) {
  const carbon = getCarbonServiceRole() as any;
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

  if (error) {
    throw error;
  }
}

async function markExtractionFailed(
  payload: AiRoutingDrawingExtractionPayload,
  update: FailedUpdate
) {
  const carbon = getCarbonServiceRole() as any;
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

  if (error && !update.retryable) {
    throw error;
  }
}

const AI_ROUTING_PART_PDF_MAX_BYTES = 30 * 1024 * 1024;

async function loadPartPdf(
  payload: AiRoutingDrawingExtractionPayload
): Promise<LoadPartPdfResult> {
  const carbon = getCarbonServiceRole() as any;
  const documentResult = await carbon
    .from("document")
    .select(
      "id, companyId, sourceDocument, sourceDocumentId, active, path, extension, type, size"
    )
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
  if (
    document.sourceDocument !== "Part" ||
    document.sourceDocumentId !== payload.itemId
  ) {
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
  if (
    Number.isFinite(metadataSize) &&
    metadataSize > AI_ROUTING_PART_PDF_MAX_BYTES
  ) {
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

  const { data, error } = await carbon.storage
    .from("private")
    .download(document.path);

  if (error || !data) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "STORAGE_DOWNLOAD_FAILED",
      error?.message ?? "Failed to download Part PDF from private storage",
      "Storage"
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > AI_ROUTING_PART_PDF_MAX_BYTES) {
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
