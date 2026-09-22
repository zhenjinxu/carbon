import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AI_ROUTING_PDF_RENDERER_VERSION,
  type AiRoutingPdfRendererError,
  renderAiRoutingPdfDrawing,
  renderAiRoutingPdfDrawingForModel
} from "./part-drawing-renderer";

function buildPdf(pageTexts: string[]) {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`
  );

  const contentObjectStart = 3 + pageTexts.length;
  const fontObjectNumber = contentObjectStart + pageTexts.length;
  for (let index = 0; index < pageTexts.length; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`
    );
  }

  for (const text of pageTexts) {
    const stream = `BT /F1 24 Tf 20 50 Td (${text}) Tj ET`;
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
  }

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = chunks.join("").length;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return new TextEncoder().encode(chunks.join(""));
}

describe("part drawing PDF renderer", () => {
  it("renders a bounded PDF into page measurements without exposing PDF bytes in the summary", async () => {
    const bytes = buildPdf(["Carbon PDF"]);

    const result = await renderAiRoutingPdfDrawing(bytes, {
      maxPages: 3,
      scale: 2
    });

    expect(result.rendererVersion).toBe(AI_ROUTING_PDF_RENDERER_VERSION);
    expect(result.contentHash).toBe(
      createHash("sha256").update(bytes).digest("hex")
    );
    expect(result.pdfByteLength).toBe(bytes.byteLength);
    expect(result.pageCount).toBe(1);
    expect(result.renderedPageCount).toBe(1);
    expect(result.totalPngByteLength).toBeGreaterThan(0);
    expect(result.pages).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        width: 400,
        height: 200,
        textItemCount: expect.any(Number),
        textCharCount: expect.any(Number),
        pngByteLength: expect.any(Number),
        renderDurationMs: expect.any(Number)
      })
    ]);
    expect(JSON.stringify(result)).not.toContain("Carbon PDF");
  });

  it("rejects PDFs that exceed the configured page limit", async () => {
    const bytes = buildPdf(["First", "Second"]);

    await expect(
      renderAiRoutingPdfDrawing(bytes, { maxPages: 1 })
    ).rejects.toMatchObject({
      code: "PAGE_LIMIT_EXCEEDED"
    } satisfies Partial<AiRoutingPdfRendererError>);
  });

  it("returns in-memory PNG pages for model input without serializing page bytes", async () => {
    const bytes = buildPdf(["Model page"]);

    const result = await renderAiRoutingPdfDrawingForModel(bytes, {
      maxPages: 3,
      scale: 2
    });

    expect(result.summary.contentHash).toBe(
      createHash("sha256").update(bytes).digest("hex")
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toEqual(
      expect.objectContaining({
        pageNumber: 1,
        width: 400,
        height: 200,
        mediaType: "image/png"
      })
    );
    const page = result.pages[0];
    const summaryPage = result.summary.pages[0];
    if (!page || !summaryPage) throw new Error("Expected one rendered page");
    expect(page.imageBytes.byteLength).toBeGreaterThan(0);
    expect(summaryPage.pngByteLength).toBe(page.imageBytes.byteLength);
    expect(JSON.stringify(result)).not.toContain("imageBytes");
    expect(JSON.stringify(result)).not.toContain("Model page");
  });
});
