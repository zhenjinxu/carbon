import { describe, expect, it } from "vitest";
import {
  AI_ROUTING_PART_PDF_MAX_BYTES,
  downloadAiRoutingPartPdfFromDocument,
  validateAiRoutingPartPdfDocument
} from "./ai-routing-drawing.server";

const validDocument = {
  id: "doc-1",
  companyId: "company-1",
  sourceDocument: "Part",
  sourceDocumentId: "part-1",
  active: true,
  path: "company-1/parts/part-1/drawing.pdf",
  extension: "pdf",
  type: "PDF",
  size: 128
};

const request = {
  companyId: "company-1",
  itemId: "part-1",
  documentId: "doc-1"
};

function copyToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function storageReturning(bytes: Uint8Array) {
  let calls = 0;
  return {
    calls: () => calls,
    storage: {
      from(bucket: string) {
        expect(bucket).toBe("private");
        return {
          async download(path: string) {
            calls += 1;
            expect(path).toBe(validDocument.path);
            return {
              data: new Blob([copyToArrayBuffer(bytes)], {
                type: "application/pdf"
              }),
              error: null
            };
          }
        };
      }
    }
  };
}

describe("AI routing Part PDF access", () => {
  it("accepts active Part PDF metadata scoped to the requested company and item", () => {
    expect(validateAiRoutingPartPdfDocument(validDocument, request)).toEqual({
      bucket: "private",
      path: validDocument.path,
      maxBytes: AI_ROUTING_PART_PDF_MAX_BYTES
    });
  });

  it("rejects cross-company, wrong-item, stale, non-PDF, oversized, and prefix-confused documents", () => {
    const invalidDocuments = [
      { ...validDocument, companyId: "other-company" },
      { ...validDocument, sourceDocumentId: "other-part" },
      { ...validDocument, active: false },
      { ...validDocument, sourceDocument: "Quote" },
      { ...validDocument, type: "Document" },
      { ...validDocument, extension: "txt" },
      { ...validDocument, size: AI_ROUTING_PART_PDF_MAX_BYTES + 1 },
      { ...validDocument, path: "company-1/parts/part-10/drawing.pdf" },
      { ...validDocument, path: "company-1/parts/part-1/../other.pdf" }
    ];

    for (const document of invalidDocuments) {
      expect(() =>
        validateAiRoutingPartPdfDocument(document, request)
      ).toThrow();
    }
  });

  it("downloads only after metadata validation and returns bytes with a SHA-256 hash", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\n% test drawing");
    const fake = storageReturning(pdfBytes);

    const result = await downloadAiRoutingPartPdfFromDocument({
      document: validDocument,
      storage: fake.storage,
      ...request
    });

    expect(fake.calls()).toBe(1);
    expect(result.bytes).toEqual(pdfBytes);
    expect(result.contentHash).toBe(
      "bbab7a23b21abe196f1f66fd5d27dcd59e076a8047941c0497344346c82897bd"
    );
    expect(result.mediaType).toBe("application/pdf");
  });

  it("does not call storage when document metadata is invalid", async () => {
    const fake = storageReturning(new TextEncoder().encode("%PDF-1.7"));

    await expect(
      downloadAiRoutingPartPdfFromDocument({
        document: { ...validDocument, path: "company-1/parts/part-10/a.pdf" },
        storage: fake.storage,
        ...request
      })
    ).rejects.toThrow();

    expect(fake.calls()).toBe(0);
  });

  it("rejects downloaded objects that are not PDF bytes or exceed the byte limit", async () => {
    const notPdf = storageReturning(new TextEncoder().encode("not a pdf"));
    await expect(
      downloadAiRoutingPartPdfFromDocument({
        document: validDocument,
        storage: notPdf.storage,
        ...request
      })
    ).rejects.toThrow(/PDF/);

    const tooLarge = storageReturning(
      new Uint8Array(AI_ROUTING_PART_PDF_MAX_BYTES + 1).fill(37)
    );
    await expect(
      downloadAiRoutingPartPdfFromDocument({
        document: { ...validDocument, size: null },
        storage: tooLarge.storage,
        ...request
      })
    ).rejects.toThrow(/size/i);
  });
});
