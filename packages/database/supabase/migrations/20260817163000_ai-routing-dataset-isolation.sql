DO $$
BEGIN
  CREATE TYPE "aiRoutingDatasetRole" AS ENUM ('Training', 'Evaluation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "aiRoutingEvaluationRunStatus" AS ENUM ('Pending', 'Running', 'Succeeded', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "aiRoutingSample"
  ADD COLUMN "datasetRole" "aiRoutingDatasetRole" NOT NULL DEFAULT 'Training',
  ADD COLUMN "lockedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "lockedBy" TEXT REFERENCES "user"("id");

CREATE INDEX "aiRoutingSample_datasetRole_idx"
  ON "aiRoutingSample" ("companyId", "status", "datasetRole");

DROP POLICY IF EXISTS "SELECT" ON "public"."aiRoutingSample";
CREATE POLICY "SELECT" ON "public"."aiRoutingSample"
FOR SELECT USING (
  "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."aiRoutingSample";
CREATE POLICY "INSERT" ON "public"."aiRoutingSample"
FOR INSERT WITH CHECK (
  "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  AND "lockedAt" IS NULL
  AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."aiRoutingSample";
CREATE POLICY "UPDATE" ON "public"."aiRoutingSample"
FOR UPDATE USING (
  "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  AND "lockedAt" IS NULL
  AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
) WITH CHECK (
  "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  AND "lockedAt" IS NULL
  AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."aiRoutingSample";
CREATE POLICY "DELETE" ON "public"."aiRoutingSample"
FOR DELETE USING (
  "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  AND "lockedAt" IS NULL
  AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

CREATE TABLE "aiRoutingEvaluationRun" (
  "id" TEXT NOT NULL DEFAULT id('airer'),
  "companyId" TEXT NOT NULL,
  "status" "aiRoutingEvaluationRunStatus" NOT NULL DEFAULT 'Pending',
  "trainingSampleIds" TEXT[] NOT NULL DEFAULT '{}',
  "evaluationSampleIds" TEXT[] NOT NULL DEFAULT '{}',
  "generatorVersion" TEXT NOT NULL,
  "promptVersion" TEXT,
  "extractorSchemaVersion" TEXT NOT NULL,
  "modelProvider" TEXT,
  "modelName" TEXT,
  "caseResults" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "metrics" JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  CONSTRAINT "aiRoutingEvaluationRun_caseResults_array" CHECK (jsonb_typeof("caseResults") = 'array'),
  CONSTRAINT "aiRoutingEvaluationRun_metrics_object" CHECK (jsonb_typeof("metrics") = 'object')
);

CREATE INDEX "aiRoutingEvaluationRun_companyId_idx"
  ON "aiRoutingEvaluationRun" ("companyId");
CREATE INDEX "aiRoutingEvaluationRun_status_idx"
  ON "aiRoutingEvaluationRun" ("companyId", "status", "createdAt" DESC);
CREATE INDEX "aiRoutingEvaluationRun_createdBy_idx"
  ON "aiRoutingEvaluationRun" ("createdBy");

ALTER TABLE "public"."aiRoutingEvaluationRun" ENABLE ROW LEVEL SECURITY;

-- Deliberately no ordinary-user policies: evaluation answers and runs are only
-- available to the permission-gated server-side evaluator through service role.
