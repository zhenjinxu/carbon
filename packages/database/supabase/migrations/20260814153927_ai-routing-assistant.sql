DO $$
BEGIN
  CREATE TYPE "aiRoutingSampleStatus" AS ENUM ('Candidate', 'Approved', 'Retired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "aiRoutingDraftStatus" AS ENUM ('Draft', 'Accepted', 'Rejected', 'Superseded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "aiRoutingSample" (
  "id" TEXT NOT NULL DEFAULT id('airs'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "makeMethodId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'confirmed-method',
  "status" "aiRoutingSampleStatus" NOT NULL DEFAULT 'Candidate',
  "sampleVersion" INTEGER NOT NULL DEFAULT 1,
  "itemSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "drawingDocumentIds" TEXT[] NOT NULL DEFAULT '{}',
  "drawingSnapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "operationSnapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "materialTags" TEXT[] NOT NULL DEFAULT '{}',
  "featureTags" TEXT[] NOT NULL DEFAULT '{}',
  "processTags" TEXT[] NOT NULL DEFAULT '{}',
  "resourceTags" TEXT[] NOT NULL DEFAULT '{}',
  "qualitySnapshot" JSONB,
  "outcomeSnapshot" JSONB,
  "ontologySnapshot" JSONB,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL,
  CONSTRAINT "aiRoutingSample_itemSnapshot_object" CHECK (jsonb_typeof("itemSnapshot") = 'object'),
  CONSTRAINT "aiRoutingSample_drawingSnapshot_array" CHECK (jsonb_typeof("drawingSnapshot") = 'array'),
  CONSTRAINT "aiRoutingSample_operationSnapshot_array" CHECK (jsonb_typeof("operationSnapshot") = 'array')
);

CREATE INDEX "aiRoutingSample_companyId_idx" ON "aiRoutingSample" ("companyId");
CREATE INDEX "aiRoutingSample_itemId_idx" ON "aiRoutingSample" ("itemId");
CREATE INDEX "aiRoutingSample_makeMethodId_idx" ON "aiRoutingSample" ("makeMethodId");
CREATE INDEX "aiRoutingSample_createdBy_idx" ON "aiRoutingSample" ("createdBy");
CREATE INDEX "aiRoutingSample_materialTags_idx" ON "aiRoutingSample" USING GIN ("materialTags");
CREATE INDEX "aiRoutingSample_featureTags_idx" ON "aiRoutingSample" USING GIN ("featureTags");
CREATE INDEX "aiRoutingSample_processTags_idx" ON "aiRoutingSample" USING GIN ("processTags");
CREATE INDEX "aiRoutingSample_resourceTags_idx" ON "aiRoutingSample" USING GIN ("resourceTags");
CREATE UNIQUE INDEX "aiRoutingSample_company_makeMethod_active_idx"
  ON "aiRoutingSample" ("companyId", "makeMethodId")
  WHERE "makeMethodId" IS NOT NULL AND "status" <> 'Retired';

CREATE TABLE "aiRoutingDraft" (
  "id" TEXT NOT NULL DEFAULT id('aird'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "targetMakeMethodId" TEXT,
  "status" "aiRoutingDraftStatus" NOT NULL DEFAULT 'Draft',
  "source" TEXT NOT NULL DEFAULT 'similarity-retrieval',
  "confidence" NUMERIC,
  "suggestedOperations" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "referenceSamples" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "warnings" TEXT[] NOT NULL DEFAULT '{}',
  "rationale" JSONB,
  "acceptedMakeMethodId" TEXT,
  "acceptedAt" TIMESTAMP WITH TIME ZONE,
  "acceptedBy" TEXT REFERENCES "user"("id"),
  "rejectedAt" TIMESTAMP WITH TIME ZONE,
  "rejectedBy" TEXT REFERENCES "user"("id"),
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  FOREIGN KEY ("targetMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL,
  FOREIGN KEY ("acceptedMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL,
  CONSTRAINT "aiRoutingDraft_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "aiRoutingDraft_suggestedOperations_array" CHECK (jsonb_typeof("suggestedOperations") = 'array'),
  CONSTRAINT "aiRoutingDraft_referenceSamples_array" CHECK (jsonb_typeof("referenceSamples") = 'array')
);

CREATE INDEX "aiRoutingDraft_companyId_idx" ON "aiRoutingDraft" ("companyId");
CREATE INDEX "aiRoutingDraft_itemId_idx" ON "aiRoutingDraft" ("itemId");
CREATE INDEX "aiRoutingDraft_targetMakeMethodId_idx" ON "aiRoutingDraft" ("targetMakeMethodId");
CREATE INDEX "aiRoutingDraft_status_idx" ON "aiRoutingDraft" ("companyId", "status");
CREATE INDEX "aiRoutingDraft_createdBy_idx" ON "aiRoutingDraft" ("createdBy");

CREATE TABLE "aiRoutingFeedback" (
  "id" TEXT NOT NULL DEFAULT id('airf'),
  "companyId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "changeSummary" TEXT,
  "reason" TEXT,
  "outcomeStatus" TEXT,
  "originalSuggestion" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "confirmedRouteSnapshot" JSONB,
  "productionOutcome" JSONB,
  "qualityOutcome" JSONB,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("draftId", "companyId") REFERENCES "aiRoutingDraft"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "aiRoutingFeedback_originalSuggestion_object" CHECK (jsonb_typeof("originalSuggestion") = 'object')
);

CREATE INDEX "aiRoutingFeedback_companyId_idx" ON "aiRoutingFeedback" ("companyId");
CREATE INDEX "aiRoutingFeedback_draftId_idx" ON "aiRoutingFeedback" ("draftId");
CREATE INDEX "aiRoutingFeedback_itemId_idx" ON "aiRoutingFeedback" ("itemId");
CREATE INDEX "aiRoutingFeedback_createdBy_idx" ON "aiRoutingFeedback" ("createdBy");

ALTER TABLE "public"."aiRoutingSample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."aiRoutingDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."aiRoutingFeedback" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."aiRoutingSample"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."aiRoutingSample"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."aiRoutingSample"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."aiRoutingSample"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."aiRoutingDraft"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."aiRoutingDraft"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."aiRoutingDraft"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."aiRoutingDraft"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."aiRoutingFeedback"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."aiRoutingFeedback"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."aiRoutingFeedback"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."aiRoutingFeedback"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);
