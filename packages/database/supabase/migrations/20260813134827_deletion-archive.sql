CREATE TABLE "deletionArchive" (
  "id" TEXT NOT NULL DEFAULT id('darc'),
  "companyId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "restoredAt" TIMESTAMP WITH TIME ZONE,
  "restoredBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "deletionArchive_companyId_idx" ON "deletionArchive" ("companyId");
CREATE INDEX "deletionArchive_entity_idx" ON "deletionArchive" ("entityType", "entityId");
CREATE INDEX "deletionArchive_createdAt_idx" ON "deletionArchive" ("createdAt");

ALTER TABLE "public"."deletionArchive" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."deletionArchive"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."deletionArchive"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."deletionArchive"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."deletionArchive"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);
