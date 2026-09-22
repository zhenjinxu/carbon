import { createHash } from "node:crypto";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export const AI_ROUTING_PART_PDF_MAX_BYTES = 30 * 1024 * 1024;

export class AiRoutingPartPdfAccessError extends Error {
  constructor(
    public readonly code:
      | "DOCUMENT_NOT_FOUND"
      | "COMPANY_MISMATCH"
      | "ITEM_MISMATCH"
      | "INACTIVE_DOCUMENT"
      | "WRONG_SOURCE_DOCUMENT"
      | "NON_PDF_DOCUMENT"
      | "OVERSIZED_DOCUMENT"
      | "INVALID_STORAGE_PATH"
      | "STORAGE_DOWNLOAD_FAILED"
      | "INVALID_PDF_BYTES",
    message: string
  ) {
    super(message);
    this.name = "AiRoutingPartPdfAccessError";
  }
}

export type AiRoutingPartPdfDocumentRow = {
  id: string;
  companyId: string;
  sourceDocument?: string | null;
  sourceDocumentId?: string | null;
  active: boolean;
  path: string;
  extension?: string | null;
  type?: string | null;
  size?: number | null;
};

type ValidateAiRoutingPartPdfArgs = {
  companyId: string;
  itemId: string;
  documentId: string;
  maxBytes?: number;
};

type AiRoutingPdfStorageClient = {
  from(bucket: "private"): {
    download(path: string): Promise<{
      data: Blob | null;
      error: { message?: string } | null;
    }>;
  };
};

type DownloadAiRoutingPartPdfArgs = ValidateAiRoutingPartPdfArgs & {
  document: AiRoutingPartPdfDocumentRow | null | undefined;
  storage: AiRoutingPdfStorageClient;
};

function fail(
  code: ConstructorParameters<typeof AiRoutingPartPdfAccessError>[0],
  message: string
): never {
  throw new AiRoutingPartPdfAccessError(code, message);
}

function hasPathTraversal(path: string) {
  return path.split("/").some((segment) => segment === ".." || segment === ".");
}

function assertPdfBytes(bytes: Uint8Array, maxBytes: number) {
  if (bytes.byteLength > maxBytes) {
    fail("OVERSIZED_DOCUMENT", "Part PDF exceeds the maximum allowed size");
  }

  const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    fail("INVALID_PDF_BYTES", "Downloaded file is not a PDF document");
  }
}

export function validateAiRoutingPartPdfDocument(
  document: AiRoutingPartPdfDocumentRow | null | undefined,
  args: ValidateAiRoutingPartPdfArgs
) {
  if (!document || document.id !== args.documentId) {
    fail("DOCUMENT_NOT_FOUND", "Part PDF document was not found");
  }

  if (document.companyId !== args.companyId) {
    fail("COMPANY_MISMATCH", "Part PDF document belongs to another company");
  }

  if (!document.active) {
    fail("INACTIVE_DOCUMENT", "Part PDF document is not active");
  }

  if (document.sourceDocument !== "Part") {
    fail("WRONG_SOURCE_DOCUMENT", "Document is not attached to a Part");
  }

  if (document.sourceDocumentId !== args.itemId) {
    fail("ITEM_MISMATCH", "Part PDF document is attached to another item");
  }

  if (document.type !== "PDF" || document.extension?.toLowerCase() !== "pdf") {
    fail("NON_PDF_DOCUMENT", "Document metadata does not describe a PDF");
  }

  const maxBytes = args.maxBytes ?? AI_ROUTING_PART_PDF_MAX_BYTES;
  if (typeof document.size === "number" && document.size > maxBytes) {
    fail(
      "OVERSIZED_DOCUMENT",
      "Part PDF metadata exceeds the maximum allowed size"
    );
  }

  const expectedPrefix = `${args.companyId}/parts/${args.itemId}/`;
  if (
    !document.path.startsWith(expectedPrefix) ||
    hasPathTraversal(document.path) ||
    !document.path.toLowerCase().endsWith(".pdf")
  ) {
    fail(
      "INVALID_STORAGE_PATH",
      "Part PDF document path is outside the expected private storage prefix"
    );
  }

  return {
    bucket: "private" as const,
    path: document.path,
    maxBytes
  };
}

export async function downloadAiRoutingPartPdfFromDocument(
  args: DownloadAiRoutingPartPdfArgs
) {
  const { bucket, path, maxBytes } = validateAiRoutingPartPdfDocument(
    args.document,
    args
  );

  const { data, error } = await args.storage.from(bucket).download(path);
  if (error || !data) {
    fail(
      "STORAGE_DOWNLOAD_FAILED",
      error?.message ?? "Failed to download Part PDF from private storage"
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  assertPdfBytes(bytes, maxBytes);

  return {
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/pdf" as const,
    bucket,
    path
  };
}

export async function getAuthorizedAiRoutingPartPdf(
  db: Kysely<KyselyDatabase>,
  storage: AiRoutingPdfStorageClient,
  args: ValidateAiRoutingPartPdfArgs
) {
  const row = await db
    .selectFrom("document as document")
    .innerJoin("item as item", (join) =>
      join
        .onRef("item.id", "=", "document.sourceDocumentId")
        .onRef("item.companyId", "=", "document.companyId")
    )
    .select([
      "document.id as id",
      "document.companyId as companyId",
      "document.sourceDocument as sourceDocument",
      "document.sourceDocumentId as sourceDocumentId",
      "document.active as active",
      "document.path as path",
      "document.extension as extension",
      "document.type as type",
      "document.size as size"
    ])
    .where("document.id", "=", args.documentId)
    .where("document.companyId", "=", args.companyId)
    .where("item.id", "=", args.itemId)
    .where("item.companyId", "=", args.companyId)
    .where("item.type", "=", "Part")
    .executeTakeFirst();

  return downloadAiRoutingPartPdfFromDocument({
    document: row ?? null,
    storage,
    ...args
  });
}
