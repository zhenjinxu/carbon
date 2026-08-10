-- WodiMES compatibility and migration tables.
-- Raw records are retained for audit/reconciliation; production execution uses Carbon entities.

CREATE TABLE IF NOT EXISTS "wodiMESSyncRun" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL DEFAULT 'WodiMES',
  "status" TEXT NOT NULL DEFAULT 'Running' CHECK ("status" IN ('Running', 'Completed', 'Failed')),
  "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "finishedAt" TIMESTAMP WITH TIME ZONE,
  "sourceCounts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "targetCounts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "wodiMESLegacyRecord" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceCollection" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP WITH TIME ZONE,
  "payload" JSONB NOT NULL,
  "syncRunId" TEXT REFERENCES "wodiMESSyncRun"("id") ON DELETE SET NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceCollection", "sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESExternalEntity" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceCollection" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "carbonEntityId" TEXT,
  "payloadHash" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "wodiMESExternalEntity_source_entity_company_key" UNIQUE ("sourceCollection", "sourceId", "entityType", "companyId"),
  UNIQUE ("entityType", "externalKey", "companyId")
);

ALTER TABLE "wodiMESExternalEntity"
  DROP CONSTRAINT IF EXISTS "wodiMESExternalEntity_sourceCollection_sourceId_companyId_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wodiMESExternalEntity_source_entity_company_key'
      AND conrelid = '"wodiMESExternalEntity"'::regclass
  ) THEN
    ALTER TABLE "wodiMESExternalEntity"
      ADD CONSTRAINT "wodiMESExternalEntity_source_entity_company_key"
      UNIQUE ("sourceCollection", "sourceId", "entityType", "companyId");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wodiMESSyncError" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "syncRunId" TEXT NOT NULL REFERENCES "wodiMESSyncRun"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceCollection" TEXT NOT NULL,
  "sourceId" TEXT,
  "errorCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "retryStatus" TEXT NOT NULL DEFAULT 'Pending' CHECK ("retryStatus" IN ('Pending', 'Retried', 'Ignored', 'Resolved')),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "wodiMESWorker" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "phone" TEXT,
  "employeeId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId"),
  UNIQUE ("username", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESResource" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceCollection" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL CHECK ("resourceType" IN ('Machine', 'Equipment', 'Workshop', 'Other')),
  "model" TEXT,
  "status" TEXT,
  "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE SET NULL,
  "locationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL,
  "ipAddress" TEXT,
  "macAddress" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceCollection", "sourceId", "companyId"),
  UNIQUE ("code", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESResourcePresence" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "resourceId" TEXT NOT NULL REFERENCES "wodiMESResource"("id") ON DELETE CASCADE,
  "deviceId" TEXT,
  "ipAddress" TEXT,
  "macAddress" TEXT,
  "hostname" TEXT,
  "lastSeenAt" TIMESTAMP WITH TIME ZONE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("resourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESProcHour" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "moCode" TEXT,
  "moDId" TEXT,
  "opSeq" TEXT,
  "operationId" TEXT,
  "workHour" NUMERIC,
  "prepHour" NUMERIC,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESAssignment" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "employeeId" TEXT,
  "resourceId" TEXT REFERENCES "wodiMESResource"("id") ON DELETE SET NULL,
  "assignedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "completedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "priority" TEXT NOT NULL DEFAULT 'Normal',
  "status" TEXT NOT NULL DEFAULT 'Assigned',
  "isRework" BOOLEAN NOT NULL DEFAULT FALSE,
  "originalSourceId" TEXT,
  "assignedAt" TIMESTAMP WITH TIME ZONE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESReport" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "assignmentId" TEXT REFERENCES "wodiMESAssignment"("id") ON DELETE SET NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "employeeId" TEXT,
  "reportedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "acceptedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "rejectedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PendingInspection',
  "actualHours" NUMERIC,
  "inspectorId" TEXT,
  "qcReason" TEXT,
  "reportedAt" TIMESTAMP WITH TIME ZONE,
  "inspectedAt" TIMESTAMP WITH TIME ZONE,
  "cancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  "cancelledAt" TIMESTAMP WITH TIME ZONE,
  "cancelReason" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESInspection" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "reportId" TEXT REFERENCES "wodiMESReport"("id") ON DELETE SET NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "inspectorId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "submittedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "sampledQuantity" NUMERIC,
  "acceptedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "rejectedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "result" TEXT,
  "reason" TEXT,
  "criteriaSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "inspectedAt" TIMESTAMP WITH TIME ZONE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESFeedback" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "assignmentId" TEXT REFERENCES "wodiMESAssignment"("id") ON DELETE SET NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL DEFAULT 'General',
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "reportedBy" TEXT,
  "assignee" TEXT,
  "resolution" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESMaterialSupplement" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE SET NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "unitOfMeasureCode" TEXT,
  "reason" TEXT,
  "requester" TEXT,
  "approver" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

CREATE TABLE IF NOT EXISTS "wodiMESInventorySnapshot" (
  "id" TEXT PRIMARY KEY DEFAULT id(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE SET NULL,
  "locationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 0,
  "sourceLocation" TEXT,
  "capturedAt" TIMESTAMP WITH TIME ZONE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  UNIQUE ("sourceId", "companyId")
);

ALTER TABLE "wodiMESProcHour" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "wodiMESInventorySnapshot" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS "wodiMESLegacyRecord_collection_idx" ON "wodiMESLegacyRecord" ("companyId", "sourceCollection");
CREATE INDEX IF NOT EXISTS "wodiMESExternalEntity_type_idx" ON "wodiMESExternalEntity" ("companyId", "entityType");
CREATE INDEX IF NOT EXISTS "wodiMESAssignment_operation_idx" ON "wodiMESAssignment" ("companyId", "jobOperationId", "status");
CREATE INDEX IF NOT EXISTS "wodiMESReport_operation_idx" ON "wodiMESReport" ("companyId", "jobOperationId", "status");
CREATE INDEX IF NOT EXISTS "wodiMESInspection_pending_idx" ON "wodiMESInspection" ("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "wodiMESResource_workcenter_idx" ON "wodiMESResource" ("companyId", "workCenterId");

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'wodiMESSyncRun', 'wodiMESLegacyRecord', 'wodiMESExternalEntity', 'wodiMESSyncError',
    'wodiMESWorker', 'wodiMESResource', 'wodiMESResourcePresence', 'wodiMESProcHour',
    'wodiMESAssignment', 'wodiMESReport', 'wodiMESInspection', 'wodiMESFeedback',
    'wodiMESMaterialSupplement', 'wodiMESInventorySnapshot'
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I ("companyId")', table_name || '_companyId_idx', 'public', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I ("createdBy")', table_name || '_createdBy_idx', 'public', table_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON %I.%I', 'public', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "INSERT" ON %I.%I', 'public', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "UPDATE" ON %I.%I', 'public', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "DELETE" ON %I.%I', 'public', table_name);
    EXECUTE format('CREATE POLICY "SELECT" ON %I.%I FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''production_view''))::text[]))', 'public', table_name);
    EXECUTE format('CREATE POLICY "INSERT" ON %I.%I FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''production_create''))::text[]))', 'public', table_name);
    EXECUTE format('CREATE POLICY "UPDATE" ON %I.%I FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''production_update''))::text[]))', 'public', table_name);
    EXECUTE format('CREATE POLICY "DELETE" ON %I.%I FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''production_delete''))::text[]))', 'public', table_name);
  END LOOP;
END $$;
