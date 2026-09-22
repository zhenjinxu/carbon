DO $$
BEGIN
  CREATE TYPE "aiDrawingExtractionStatus" AS ENUM ('Pending', 'Processing', 'Succeeded', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "aiDrawingExtraction" (
  "id" TEXT NOT NULL DEFAULT id('aide'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" "aiDrawingExtractionStatus" NOT NULL DEFAULT 'Pending',
  "contentHash" TEXT NOT NULL,
  "rendererVersion" TEXT NOT NULL,
  "extractorSchemaVersion" TEXT NOT NULL,
  "promptVersion" TEXT,
  "modelProvider" TEXT,
  "modelName" TEXT,
  "pageCount" INTEGER,
  "extraction" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "warnings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "errorCategory" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP WITH TIME ZONE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE,
  CONSTRAINT "aiDrawingExtraction_contentHash_sha256" CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "aiDrawingExtraction_pageCount_positive" CHECK ("pageCount" IS NULL OR "pageCount" > 0),
  CONSTRAINT "aiDrawingExtraction_extraction_object" CHECK (jsonb_typeof("extraction") = 'object'),
  CONSTRAINT "aiDrawingExtraction_warnings_array" CHECK (jsonb_typeof("warnings") = 'array'),
  CONSTRAINT "aiDrawingExtraction_completion_status" CHECK (
    ("status" IN ('Succeeded', 'Failed') AND "completedAt" IS NOT NULL)
    OR ("status" IN ('Pending', 'Processing') AND "completedAt" IS NULL)
  )
);

CREATE INDEX "aiDrawingExtraction_companyId_idx"
  ON "aiDrawingExtraction" ("companyId");
CREATE INDEX "aiDrawingExtraction_itemId_idx"
  ON "aiDrawingExtraction" ("itemId");
CREATE INDEX "aiDrawingExtraction_documentId_idx"
  ON "aiDrawingExtraction" ("documentId");
CREATE INDEX "aiDrawingExtraction_status_idx"
  ON "aiDrawingExtraction" ("companyId", "status", "createdAt" DESC);
CREATE INDEX "aiDrawingExtraction_createdBy_idx"
  ON "aiDrawingExtraction" ("createdBy");
CREATE UNIQUE INDEX "aiDrawingExtraction_document_hash_version_idx"
  ON "aiDrawingExtraction" ("companyId", "documentId", "contentHash", "extractorSchemaVersion");

ALTER TABLE "public"."aiDrawingExtraction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."aiDrawingExtraction"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."aiDrawingExtraction"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."aiDrawingExtraction"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
) WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."aiDrawingExtraction"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);