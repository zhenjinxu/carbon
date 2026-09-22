import {
  AI_ROUTING_DRAWING_SCHEMA_VERSION,
  aiRoutingDrawingExtractionSchema
} from "@carbon/lib/ai-routing-drawing";
import { describe, expect, it, vi } from "vitest";
import {
  AI_ROUTING_DRAWING_PROMPT_VERSION,
  type ExtractDrawingArgs,
  type PermanentAiRoutingDrawingExtractionError
} from "./extract-part-drawing.runner";
import {
  extractDrawingWithConfiguredModel,
  resolveAiRoutingDrawingModelConfig
} from "./extract-part-drawing-model";
import {
  AI_ROUTING_PDF_RENDERER_VERSION,
  type AiRoutingPdfRenderSummary
} from "./part-drawing-renderer";

const renderSummary: AiRoutingPdfRenderSummary = {
  rendererVersion: AI_ROUTING_PDF_RENDERER_VERSION,
  contentHash: "b".repeat(64),
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

const extractArgs: ExtractDrawingArgs = {
  payload: {
    companyId: "company-1",
    userId: "user-1",
    itemId: "part-1",
    documentId: "doc-1",
    extractionId: "aide-1"
  },
  renderSummary,
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

describe("AI routing drawing model extraction", () => {
  it("fails closed when the drawing model is not configured", async () => {
    const generateObject = vi.fn();

    await expect(
      extractDrawingWithConfiguredModel(extractArgs, {
        env: {},
        createOpenAiModel: vi.fn(),
        generateObject
      })
    ).rejects.toMatchObject({
      code: "MODEL_NOT_CONFIGURED",
      errorCategory: "Configuration"
    } satisfies Partial<PermanentAiRoutingDrawingExtractionError>);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects unsupported providers before a model call", () => {
    expect(() =>
      resolveAiRoutingDrawingModelConfig({
        AI_ROUTING_DRAWING_MODEL_PROVIDER: "other",
        AI_ROUTING_DRAWING_MODEL_NAME: "vision-model"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_PROVIDER_NOT_SUPPORTED",
        errorCategory: "Configuration"
      })
    );
  });

  it("calls the configured OpenAI vision model with page images and strict schema", async () => {
    const model = { provider: "openai", name: "vision-test" };
    const createOpenAiModel = vi.fn(() => model);
    const generateObject = vi.fn(async (request) => {
      expect(request.model).toBe(model);
      expect(request.schema).toBe(aiRoutingDrawingExtractionSchema);
      expect(request.schemaName).toBe("ai_routing_drawing_extraction");
      expect(request.temperature).toBeLessThanOrEqual(0.1);
      expect(request.messages).toHaveLength(1);
      const content = request.messages[0].content;
      expect(content.filter((part) => part.type === "image")).toHaveLength(1);
      expect(content[1]).toEqual(
        expect.objectContaining({
          type: "image",
          mediaType: "image/png",
          image: expect.any(Buffer)
        })
      );
      const serializedRequest = JSON.stringify(request, (_key, value) => {
        if (Buffer.isBuffer(value)) return "<buffer>";
        return value;
      });
      expect(serializedRequest).toContain(renderSummary.contentHash);
      expect(serializedRequest).toContain(
        "Use only visible PDF drawing evidence"
      );
      expect(serializedRequest).toContain("normalized page fractions");
      expect(serializedRequest).toContain("Never return pixel coordinates");
      expect(serializedRequest).not.toContain("U8 operation");
      return { object: extraction };
    });

    const result = await extractDrawingWithConfiguredModel(extractArgs, {
      env: {
        AI_ROUTING_DRAWING_MODEL_PROVIDER: "openai",
        AI_ROUTING_DRAWING_MODEL_NAME: "vision-test"
      },
      createOpenAiModel,
      generateObject
    });

    expect(createOpenAiModel).toHaveBeenCalledWith("vision-test");
    expect(result).toEqual({
      extraction,
      modelProvider: "openai",
      modelName: "vision-test",
      promptVersion: AI_ROUTING_DRAWING_PROMPT_VERSION
    });
  });
});
