import { createHash } from "node:crypto";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const AI_ROUTING_PDF_RENDERER_VERSION =
  "pdfjs-dist-5.4.296-napi-canvas.v1";

const DEFAULT_MAX_PAGES = 3;
const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_MAX_PIXELS_PER_PAGE = 8_000_000;

type AiRoutingPdfRendererErrorCode =
  | "INVALID_RENDER_OPTIONS"
  | "PAGE_LIMIT_EXCEEDED"
  | "PAGE_PIXEL_LIMIT_EXCEEDED";

export class AiRoutingPdfRendererError extends Error {
  constructor(
    public readonly code: AiRoutingPdfRendererErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AiRoutingPdfRendererError";
  }
}

export type AiRoutingPdfRenderOptions = {
  maxPages?: number;
  scale?: number;
  maxPixelsPerPage?: number;
};

export type AiRoutingRenderedPdfPageSummary = {
  pageNumber: number;
  width: number;
  height: number;
  textItemCount: number;
  textCharCount: number;
  pngByteLength: number;
  renderDurationMs: number;
};

export type AiRoutingPdfRenderSummary = {
  rendererVersion: typeof AI_ROUTING_PDF_RENDERER_VERSION;
  contentHash: string;
  pdfByteLength: number;
  pageCount: number;
  renderedPageCount: number;
  scale: number;
  totalPngByteLength: number;
  durationMs: number;
  pages: AiRoutingRenderedPdfPageSummary[];
};

export type AiRoutingRenderedPdfPageImage = {
  pageNumber: number;
  width: number;
  height: number;
  mediaType: "image/png";
  imageBytes: Uint8Array;
};

export type AiRoutingPdfRenderForModel = {
  summary: AiRoutingPdfRenderSummary;
  pages: AiRoutingRenderedPdfPageImage[];
};

type CanvasAndContext = {
  canvas: Canvas;
  context: ReturnType<Canvas["getContext"]>;
};

type TextContentLike = {
  items: Array<{ str?: unknown } | unknown>;
};

function fail(code: AiRoutingPdfRendererErrorCode, message: string): never {
  throw new AiRoutingPdfRendererError(code, message);
}

function positiveNumber(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    fail("INVALID_RENDER_OPTIONS", `${name} must be a positive number`);
  }
}

function createCanvasFactory() {
  return {
    create(width: number, height: number): CanvasAndContext {
      positiveNumber(width, "width");
      positiveNumber(height, "height");
      const canvas: Canvas = createCanvas(width, height);
      return {
        canvas,
        context: canvas.getContext("2d")
      };
    },
    reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
      positiveNumber(width, "width");
      positiveNumber(height, "height");
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext: CanvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
  };
}

function textStats(textContent: TextContentLike) {
  let textCharCount = 0;
  for (const item of textContent.items) {
    if (
      typeof item === "object" &&
      item !== null &&
      "str" in item &&
      typeof item.str === "string"
    ) {
      textCharCount += item.str.length;
    }
  }

  return {
    textItemCount: textContent.items.length,
    textCharCount
  };
}

function modelPageImage(
  metadata: Omit<AiRoutingRenderedPdfPageImage, "imageBytes">,
  imageBytes: Uint8Array
): AiRoutingRenderedPdfPageImage {
  const pageImage = { ...metadata } as AiRoutingRenderedPdfPageImage;
  Object.defineProperty(pageImage, "imageBytes", {
    value: new Uint8Array(imageBytes),
    enumerable: false
  });
  return pageImage;
}

async function renderAiRoutingPdfDrawingInternal(
  bytes: Uint8Array,
  options: AiRoutingPdfRenderOptions,
  includePageImages: boolean
): Promise<AiRoutingPdfRenderSummary | AiRoutingPdfRenderForModel> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const scale = options.scale ?? DEFAULT_RENDER_SCALE;
  const maxPixelsPerPage =
    options.maxPixelsPerPage ?? DEFAULT_MAX_PIXELS_PER_PAGE;
  positiveNumber(maxPages, "maxPages");
  positiveNumber(scale, "scale");
  positiveNumber(maxPixelsPerPage, "maxPixelsPerPage");

  const startedAt = performance.now();
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const documentParameters = {
    data: new Uint8Array(bytes),
    disableWorker: true
  } as unknown as Parameters<typeof pdfjs.getDocument>[0];
  const loadingTask = pdfjs.getDocument(documentParameters);

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) {
      fail(
        "PAGE_LIMIT_EXCEEDED",
        `PDF has ${pdf.numPages} pages, exceeding the limit of ${maxPages}`
      );
    }

    const factory = createCanvasFactory();
    const pages: AiRoutingRenderedPdfPageSummary[] = [];
    const pageImages: AiRoutingRenderedPdfPageImage[] = [];
    let totalPngByteLength = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width * height > maxPixelsPerPage) {
        fail(
          "PAGE_PIXEL_LIMIT_EXCEEDED",
          `Rendered page ${pageNumber} exceeds the maximum pixel count`
        );
      }

      const textContent = await page.getTextContent();
      const stats = textStats(textContent);
      const canvasAndContext = factory.create(width, height);
      const renderStartedAt = performance.now();
      const renderParameters = {
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory: factory
      } as unknown as Parameters<typeof page.render>[0];
      await page.render(renderParameters).promise;
      const pngBuffer = canvasAndContext.canvas.toBuffer("image/png");
      const pngByteLength = pngBuffer.byteLength;
      if (includePageImages) {
        pageImages.push(
          modelPageImage(
            {
              pageNumber,
              width,
              height,
              mediaType: "image/png"
            },
            pngBuffer
          )
        );
      }
      factory.destroy(canvasAndContext);
      totalPngByteLength += pngByteLength;
      pages.push({
        pageNumber,
        width,
        height,
        ...stats,
        pngByteLength,
        renderDurationMs: Math.round(performance.now() - renderStartedAt)
      });
    }

    const summary: AiRoutingPdfRenderSummary = {
      rendererVersion: AI_ROUTING_PDF_RENDERER_VERSION,
      contentHash,
      pdfByteLength: bytes.byteLength,
      pageCount: pdf.numPages,
      renderedPageCount: pages.length,
      scale,
      totalPngByteLength,
      durationMs: Math.round(performance.now() - startedAt),
      pages
    };

    if (includePageImages) {
      return { summary, pages: pageImages };
    }

    return summary;
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderAiRoutingPdfDrawing(
  bytes: Uint8Array,
  options: AiRoutingPdfRenderOptions = {}
): Promise<AiRoutingPdfRenderSummary> {
  return renderAiRoutingPdfDrawingInternal(
    bytes,
    options,
    false
  ) as Promise<AiRoutingPdfRenderSummary>;
}

export async function renderAiRoutingPdfDrawingForModel(
  bytes: Uint8Array,
  options: AiRoutingPdfRenderOptions = {}
): Promise<AiRoutingPdfRenderForModel> {
  return renderAiRoutingPdfDrawingInternal(
    bytes,
    options,
    true
  ) as Promise<AiRoutingPdfRenderForModel>;
}
