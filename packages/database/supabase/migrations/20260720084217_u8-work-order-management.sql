-- Company-scoped U8 work-order import control and dashboard projection.
-- Depends on 20260716140000_wodimes-integration.sql.

CREATE TABLE "u8WorkOrderImportConfig" (
  "id" TEXT NOT NULL DEFAULT id('u8cfg'),
  "companyId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 5 CHECK ("intervalMinutes" BETWEEN 1 AND 1440),
  "customerNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "moCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "soCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "startDate" DATE,
  "endDate" DATE,
  "nextRunAt" TIMESTAMP WITH TIME ZONE,
  "lastRunAt" TIMESTAMP WITH TIME ZONE,
  "configVersion" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "u8WorkOrderImportConfig_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "u8WorkOrderImportConfig_companyId_key" UNIQUE ("companyId"),
  CONSTRAINT "u8WorkOrderImportConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "u8WorkOrderImportConfig_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "u8WorkOrderImportConfig_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "u8WorkOrderImportConfig_date_range_check" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate")
);

CREATE TABLE "u8WorkOrder" (
  "id" TEXT NOT NULL DEFAULT id('u8wo'),
  "companyId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sourceMoDId" TEXT NOT NULL,
  "moCode" TEXT NOT NULL,
  "salesOrderCode" TEXT,
  "customerCode" TEXT,
  "customerName" TEXT,
  "departmentName" TEXT,
  "personInCharge" TEXT,
  "itemCode" TEXT,
  "itemName" TEXT,
  "sourceStatus" TEXT,
  "plannedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "sourceQualifiedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "plannedStartDate" DATE,
  "dueDate" DATE,
  "sourceUpdatedAt" TIMESTAMP WITH TIME ZONE,
  "payloadHash" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "u8WorkOrder_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "u8WorkOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "u8WorkOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "u8WorkOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "u8WorkOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "u8WorkOrder_job_company_key" UNIQUE ("jobId", "companyId"),
  CONSTRAINT "u8WorkOrder_source_company_key" UNIQUE ("sourceMoDId", "companyId")
);

ALTER TABLE "wodiMESSyncRun"
  ADD COLUMN IF NOT EXISTS "triggerType" TEXT NOT NULL DEFAULT 'Migration',
  ADD COLUMN IF NOT EXISTS "filterSnapshot" JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS "configVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "scannedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insertedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "updatedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skippedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "message" TEXT;

ALTER TABLE "wodiMESSyncRun" DROP CONSTRAINT IF EXISTS "wodiMESSyncRun_triggerType_check";
ALTER TABLE "wodiMESSyncRun"
  ADD CONSTRAINT "wodiMESSyncRun_triggerType_check"
  CHECK ("triggerType" IN ('Migration', 'Manual', 'Scheduled'));

CREATE INDEX "u8WorkOrderImportConfig_due_idx"
  ON "u8WorkOrderImportConfig" ("enabled", "nextRunAt")
  WHERE "enabled" = TRUE;
CREATE INDEX "u8WorkOrder_company_status_idx"
  ON "u8WorkOrder" ("companyId", "sourceStatus");
CREATE INDEX "u8WorkOrder_company_mocode_idx"
  ON "u8WorkOrder" ("companyId", "moCode");
CREATE INDEX "u8WorkOrder_company_customer_idx"
  ON "u8WorkOrder" ("companyId", "customerName");
CREATE INDEX "u8WorkOrder_company_sales_order_idx"
  ON "u8WorkOrder" ("companyId", "salesOrderCode");
CREATE INDEX "u8WorkOrder_company_start_date_idx"
  ON "u8WorkOrder" ("companyId", "plannedStartDate");
CREATE INDEX "u8WorkOrder_company_due_date_idx"
  ON "u8WorkOrder" ("companyId", "dueDate", "moCode");
CREATE INDEX "u8WorkOrder_jobId_idx" ON "u8WorkOrder" ("jobId");
CREATE INDEX "wodiMESSyncRun_u8_history_idx"
  ON "wodiMESSyncRun" ("companyId", "startedAt" DESC)
  WHERE "source" = 'U8';

ALTER TABLE "public"."u8WorkOrderImportConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."u8WorkOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."u8WorkOrderImportConfig"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::TEXT[])
);
CREATE POLICY "INSERT" ON "public"."u8WorkOrderImportConfig"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::TEXT[])
);
CREATE POLICY "UPDATE" ON "public"."u8WorkOrderImportConfig"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::TEXT[])
);
CREATE POLICY "DELETE" ON "public"."u8WorkOrderImportConfig"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::TEXT[])
);

CREATE POLICY "SELECT" ON "public"."u8WorkOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::TEXT[])
);
CREATE POLICY "INSERT" ON "public"."u8WorkOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::TEXT[])
);
CREATE POLICY "UPDATE" ON "public"."u8WorkOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::TEXT[])
);
CREATE POLICY "DELETE" ON "public"."u8WorkOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::TEXT[])
);

-- Seed the dashboard projection from the compatibility import. The first direct
-- U8 run refreshes these values from the source database.
INSERT INTO "u8WorkOrder" (
  "id", "companyId", "jobId", "sourceMoDId", "moCode", "salesOrderCode",
  "customerName", "departmentName", "personInCharge", "itemCode", "itemName",
  "sourceStatus", "plannedQuantity", "sourceQualifiedQuantity",
  "plannedStartDate", "dueDate", "createdBy"
)
SELECT
  'u8wo_' || SUBSTRING(MD5(j."companyId" || ':' || (j."customFields"->'wodiMES'->>'sourceMoDId')) FROM 1 FOR 24),
  j."companyId",
  j."id",
  j."customFields"->'wodiMES'->>'sourceMoDId',
  COALESCE(j."customFields"->'wodiMES'->>'sourceMoCode', op.payload->>'MoCode', j."jobId"),
  NULLIF(op.payload->>'SoCode', ''),
  NULLIF(op.payload->>'CustomerName', ''),
  NULLIF(op.payload->>'DeptName', ''),
  COALESCE(NULLIF(op.payload->>'Define28', ''), NULLIF(op.payload->>'Maker', '')),
  COALESCE(NULLIF(j."customFields"->'wodiMES'->>'itemCode', ''), NULLIF(op.payload->>'InvCode', '')),
  NULLIF(op.payload->>'InvName', ''),
  COALESCE(NULLIF(op.payload->>'Status', ''), j."customFields"->'wodiMES'->>'sourceStatus'),
  j."quantity",
  GREATEST(j."quantityComplete", 0),
  CASE WHEN op.payload->>'StartDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(op.payload->>'StartDate', 10)::DATE END,
  j."dueDate",
  j."createdBy"
FROM "job" j
LEFT JOIN LATERAL (
  SELECT jo."customFields"->'wodiMES' AS payload
  FROM "jobOperation" jo
  WHERE jo."jobId" = j."id"
    AND jo."companyId" = j."companyId"
  ORDER BY jo."order", jo."id"
  LIMIT 1
) op ON TRUE
WHERE j."customFields"->'wodiMES'->>'sourceMoDId' IS NOT NULL
ON CONFLICT ("sourceMoDId", "companyId") DO UPDATE SET
  "jobId" = EXCLUDED."jobId",
  "moCode" = EXCLUDED."moCode",
  "salesOrderCode" = EXCLUDED."salesOrderCode",
  "customerName" = EXCLUDED."customerName",
  "departmentName" = EXCLUDED."departmentName",
  "personInCharge" = EXCLUDED."personInCharge",
  "itemCode" = EXCLUDED."itemCode",
  "itemName" = EXCLUDED."itemName",
  "sourceStatus" = EXCLUDED."sourceStatus",
  "plannedQuantity" = EXCLUDED."plannedQuantity",
  "sourceQualifiedQuantity" = EXCLUDED."sourceQualifiedQuantity",
  "plannedStartDate" = EXCLUDED."plannedStartDate",
  "dueDate" = EXCLUDED."dueDate",
  "updatedAt" = NOW();
