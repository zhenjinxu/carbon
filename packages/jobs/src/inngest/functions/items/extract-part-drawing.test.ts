import { AI_ROUTING_DRAWING_SCHEMA_VERSION } from "@carbon/lib/ai-routing-drawing";
import { describe, expect, it, vi } from "vitest";
import {
  AI_ROUTING_DRAWING_PROMPT_VERSION,
  aiRoutingDrawingExtractionPayloadSchema,
  PermanentAiRoutingDrawingExtractionError,
  runAiRoutingDrawingExtraction
} from "./extract-part-drawing.runner";
import {
  AI_ROUTING_PDF_RENDERER_VERSION,
  type AiRoutingPdfRenderForModel,
  type AiRoutingPdfRenderSummary
} from "./part-drawing-renderer";

const payload = {
  companyId: "company-1",
  userId: "user-1",
  itemId: "part-1",
  documentId: "doc-1",
  extractionId: "aide-1"
};

const renderSummary: AiRoutingPdfRenderSummary = {
  rendererVersion: AI_ROUTING_PDF_RENDERER_VERSION,
  contentHash: "a".repeat(64),
  pdfByteLength: 1234,
  pageCount: 1,
  renderedPageCount: 1,
  scale: 2,
  totalPngByteLength: 4567,
  durationMs: 89,
  pages: [
    {
      pageNumber: 1,
      width: 1684,
      height: 1191,
      textItemCount: 10,
      textCharCount: 100,
      pngByteLength: 4567,
      renderDurationMs: 80
    }
  ]
};

const renderForModel: AiRoutingPdfRenderForModel = {
  summary: renderSummary,
  pages: [
    {
      pageNumber: 1,
      width: 1684,
      height: 1191,
      mediaType: "image/png",
      imageBytes: new Uint8Array([137, 80, 78, 71])
    }
  ]
};

const extraction = {
  schemaVersion: AI_ROUTING_DRAWING_SCHEMA_VERSION,
  document: {
    pageCount: 1,
    renderedPageCount: 1,
    contentHash: renderSummary.contentHash
  },
  titleBlock: {
    partNumber: "1927930202",
    revision: null,
    material: null,
    finish: null,
    heatTreatment: null
  },
  part: {
    class: "machined",
    stockForm: "plate"
  },
  dimensions: [],
  features: {
    holes: [],
    threads: [],
    slots: [],
    pockets: [],
    bends: [],
    welds: [],
    surfaces: []
  },
  notes: [],
  explicitUnknowns: ["material"],
  warnings: []
};
const extractionResult = {
  extraction,
  modelProvider: "openai",
  modelName: "test-vision-model",
  promptVersion: AI_ROUTING_DRAWING_PROMPT_VERSION
};

describe("AI routing drawing extraction job", () => {
  it("accepts an ID-only event payload and rejects drawing contents in the event", () => {
    expect(aiRoutingDrawingExtractionPayloadSchema.parse(payload)).toEqual(
      payload
    );

    expect(() =>
      aiRoutingDrawingExtractionPayloadSchema.parse({
        ...payload,
        pdfBytes: "%PDF-1.4",
        fullDrawingText: "secret drawing text",
        signedUrl: "https://example.invalid/private.pdf"
      })
    ).toThrow();
  });

  it("marks Processing, validates extraction output, and persists only structured summary data on success", async () => {
    const markProcessing = vi.fn(async () => undefined);
    const markSucceeded = vi.fn(async () => undefined);
    const markFailed = vi.fn(async () => undefined);

    const result = await runAiRoutingDrawingExtraction(payload, {
      markProcessing,
      loadPartPdf: vi.fn(async () => ({
        bytes: new TextEncoder().encode("%PDF-1.4 fake bytes")
      })),
      renderPdf: vi.fn(async () => renderForModel),
      extractDrawing: vi.fn(async (args) => {
        expect(args.renderSummary).toBe(renderSummary);
        expect(args.pages).toHaveLength(1);
        expect(args.pages[0].imageBytes.byteLength).toBeGreaterThan(0);
        return extractionResult;
      }),
      markSucceeded,
      markFailed
    });

    expect(result.status).toBe("Succeeded");
    expect(markProcessing).toHaveBeenCalledWith(payload);
    expect(markSucceeded).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        contentHash: renderSummary.contentHash,
        pageCount: 1,
        rendererVersion: renderSummary.rendererVersion,
        extraction: expect.objectContaining({
          schemaVersion: AI_ROUTING_DRAWING_SCHEMA_VERSION
        }),
        modelProvider: "openai",
        modelName: "test-vision-model",
        promptVersion: AI_ROUTING_DRAWING_PROMPT_VERSION
      })
    );
    expect(markFailed).not.toHaveBeenCalled();
    expect(JSON.stringify(markSucceeded.mock.calls)).not.toContain("%PDF-1.4");
  });

  it("marks permanent input errors as Failed without asking Inngest to retry", async () => {
    const markFailed = vi.fn(async () => undefined);

    const result = await runAiRoutingDrawingExtraction(payload, {
      markProcessing: vi.fn(async () => undefined),
      loadPartPdf: vi.fn(async () => {
        throw new PermanentAiRoutingDrawingExtractionError(
          "INVALID_PDF_BYTES",
          "Not a PDF"
        );
      }),
      renderPdf: vi.fn(async () => renderForModel),
      extractDrawing: vi.fn(async (args) => {
        expect(args.renderSummary).toBe(renderSummary);
        expect(args.pages).toHaveLength(1);
        expect(args.pages[0].imageBytes.byteLength).toBeGreaterThan(0);
        return extractionResult;
      }),
      markSucceeded: vi.fn(async () => undefined),
      markFailed
    });

    expect(result).toEqual({
      status: "Failed",
      errorCategory: "Input",
      errorCode: "INVALID_PDF_BYTES"
    });
    expect(markFailed).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        status: "Failed",
        errorCategory: "Input",
        errorCode: "INVALID_PDF_BYTES",
        retryable: false
      })
    );
  });
});
