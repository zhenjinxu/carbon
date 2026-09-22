import {
  AI_ROUTING_DRAWING_SCHEMA_VERSION,
  type AiRoutingDrawingExtraction,
  normalizeAiRoutingDrawingExtraction
} from "@carbon/lib/ai-routing-drawing";
import { z } from "zod";
import type {
  AiRoutingPdfRenderForModel,
  AiRoutingPdfRenderSummary,
  AiRoutingRenderedPdfPageImage
} from "./part-drawing-renderer";

export const AI_ROUTING_DRAWING_PROMPT_VERSION = "ai-routing-drawing.prompt.v1";

export const aiRoutingDrawingExtractionPayloadSchema = z
  .object({
    companyId: z.string().min(1),
    userId: z.string().min(1),
    itemId: z.string().min(1),
    documentId: z.string().min(1),
    extractionId: z.string().min(1)
  })
  .strict();

export type AiRoutingDrawingExtractionPayload = z.infer<
  typeof aiRoutingDrawingExtractionPayloadSchema
>;

type AiRoutingDrawingExtractionErrorCategory =
  | "Input"
  | "Storage"
  | "Model"
  | "Configuration";

export class PermanentAiRoutingDrawingExtractionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly errorCategory: AiRoutingDrawingExtractionErrorCategory = "Input"
  ) {
    super(message);
    this.name = "PermanentAiRoutingDrawingExtractionError";
  }
}

export type LoadPartPdfResult = {
  bytes: Uint8Array;
};

export type ExtractDrawingArgs = {
  payload: AiRoutingDrawingExtractionPayload;
  renderSummary: AiRoutingPdfRenderSummary;
  pages: AiRoutingRenderedPdfPageImage[];
};

export type ExtractDrawingResult = {
  extraction: unknown;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
};

export type SucceededUpdate = {
  status: "Succeeded";
  contentHash: string;
  rendererVersion: string;
  extractorSchemaVersion: typeof AI_ROUTING_DRAWING_SCHEMA_VERSION;
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  pageCount: number;
  extraction: AiRoutingDrawingExtraction;
  warnings: string[];
};

export type FailedUpdate = {
  status: "Failed";
  errorCategory: AiRoutingDrawingExtractionErrorCategory;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
};

type RunAiRoutingDrawingExtractionDependencies = {
  markProcessing(payload: AiRoutingDrawingExtractionPayload): Promise<void>;
  loadPartPdf(
    payload: AiRoutingDrawingExtractionPayload
  ): Promise<LoadPartPdfResult>;
  renderPdf(bytes: Uint8Array): Promise<AiRoutingPdfRenderForModel>;
  extractDrawing(args: ExtractDrawingArgs): Promise<ExtractDrawingResult>;
  markSucceeded(
    payload: AiRoutingDrawingExtractionPayload,
    update: SucceededUpdate
  ): Promise<void>;
  markFailed(
    payload: AiRoutingDrawingExtractionPayload,
    update: FailedUpdate
  ): Promise<void>;
};

export async function runAiRoutingDrawingExtraction(
  rawPayload: AiRoutingDrawingExtractionPayload,
  dependencies: RunAiRoutingDrawingExtractionDependencies
): Promise<
  | { status: "Succeeded" }
  | Pick<FailedUpdate, "status" | "errorCategory" | "errorCode">
> {
  const payload = aiRoutingDrawingExtractionPayloadSchema.parse(rawPayload);

  try {
    await dependencies.markProcessing(payload);
    const { bytes } = await dependencies.loadPartPdf(payload);
    const renderResult = await dependencies.renderPdf(bytes);
    const renderSummary = renderResult.summary;
    const extractionResult = await dependencies.extractDrawing({
      payload,
      renderSummary,
      pages: renderResult.pages
    });
    const extraction = normalizeAiRoutingDrawingExtraction(
      extractionResult.extraction
    );

    if (extraction.document.contentHash !== renderSummary.contentHash) {
      throw new PermanentAiRoutingDrawingExtractionError(
        "EXTRACTION_HASH_MISMATCH",
        "Model extraction content hash does not match rendered PDF hash",
        "Model"
      );
    }

    await dependencies.markSucceeded(payload, {
      status: "Succeeded",
      contentHash: renderSummary.contentHash,
      rendererVersion: renderSummary.rendererVersion,
      extractorSchemaVersion: AI_ROUTING_DRAWING_SCHEMA_VERSION,
      promptVersion: extractionResult.promptVersion,
      modelProvider: extractionResult.modelProvider,
      modelName: extractionResult.modelName,
      pageCount: renderSummary.pageCount,
      extraction,
      warnings: extraction.warnings
    });

    return { status: "Succeeded" };
  } catch (error) {
    if (error instanceof PermanentAiRoutingDrawingExtractionError) {
      await dependencies.markFailed(payload, {
        status: "Failed",
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

    const retryableError =
      error instanceof Error ? error : new Error("Unknown extraction failure");
    await dependencies.markFailed(payload, {
      status: "Failed",
      errorCategory: "Model",
      errorCode: retryableError.name || "RETRYABLE_EXTRACTION_ERROR",
      errorMessage: retryableError.message,
      retryable: true
    });
    throw retryableError;
  }
}
