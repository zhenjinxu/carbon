import { describe, expect, it, vi } from "vitest";
import type { ExtractDrawingArgs } from "./extract-part-drawing.runner";

vi.mock("@carbon/lib/ai-routing-drawing", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { aiRoutingDrawingExtractionSchema: undefined, default: original };
});

const { extractDrawingWithConfiguredModel } = await import(
  "./extract-part-drawing-model"
);

const extractArgs: ExtractDrawingArgs = {
  payload: {
    companyId: "company-1",
    userId: "user-1",
    itemId: "part-1",
    documentId: "doc-1",
    extractionId: "aide-1"
  },
  renderSummary: {
    rendererVersion: "ai-routing-pdf-renderer.test",
    contentHash: "c".repeat(64),
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
        textItemCount: 0,
        textCharCount: 0,
        pngByteLength: 4567,
        renderDurationMs: 80
      }
    ]
  },
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

describe("AI routing drawing model package interop", () => {
  it("passes the drawing extraction schema when the package namespace is default-only", async () => {
    const generateObject = vi.fn(async (request) => {
      expect(request.schema).toBeDefined();
      return { object: { ok: true } };
    });

    const result = await extractDrawingWithConfiguredModel(extractArgs, {
      env: {
        AI_ROUTING_DRAWING_MODEL_PROVIDER: "openai",
        AI_ROUTING_DRAWING_MODEL_NAME: "vision-test"
      },
      createOpenAiModel: vi.fn(),
      generateObject
    });

    expect(result.extraction).toEqual({ ok: true });
  });
});
