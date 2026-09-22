DROP INDEX IF EXISTS "aiDrawingExtraction_document_hash_version_idx";

CREATE UNIQUE INDEX "aiDrawingExtraction_document_hash_schema_prompt_idx"
  ON "aiDrawingExtraction" (
    "companyId",
    "documentId",
    "contentHash",
    "extractorSchemaVersion",
    (COALESCE("promptVersion", ''))
  )
  WHERE "contentHash" IS NOT NULL
    AND "extractorSchemaVersion" IS NOT NULL;
