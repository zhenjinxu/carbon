ALTER TABLE "aiDrawingExtraction"
  ALTER COLUMN "contentHash" DROP NOT NULL,
  ALTER COLUMN "rendererVersion" DROP NOT NULL,
  ALTER COLUMN "extractorSchemaVersion" DROP NOT NULL;

ALTER TABLE "aiDrawingExtraction"
  DROP CONSTRAINT IF EXISTS "aiDrawingExtraction_contentHash_sha256";

ALTER TABLE "aiDrawingExtraction"
  ADD CONSTRAINT "aiDrawingExtraction_contentHash_sha256"
  CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "aiDrawingExtraction"
  ADD CONSTRAINT "aiDrawingExtraction_succeeded_metadata"
  CHECK (
    "status" <> 'Succeeded'
    OR (
      "contentHash" IS NOT NULL
      AND "rendererVersion" IS NOT NULL
      AND "extractorSchemaVersion" IS NOT NULL
      AND "pageCount" IS NOT NULL
      AND "extraction" <> '{}'::jsonb
    )
  );
