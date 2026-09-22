-- Carbon MOM personal activity read projection.
--
-- The audit log remains the compliance source of truth. This table is an
-- actor-owned, company-scoped query projection with a fixed 12-month retention
-- contract. Application users can read their own rows but cannot mutate them.

CREATE TABLE "public"."workbenchActivity" (
  "id" TEXT NOT NULL DEFAULT public.id('wba'),
  "companyId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "activityType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityLabel" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "workbenchActivity_pkey"
    PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workbenchActivity_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "public"."company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workbenchActivity_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "public"."user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workbenchActivity_company_idempotency_key"
    UNIQUE ("companyId", "idempotencyKey"),
  CONSTRAINT "workbenchActivity_module_check"
    CHECK ("module" IN (
      'items',
      'inventory',
      'purchasing',
      'production',
      'quality',
      'sales',
      'accounting'
    )),
  CONSTRAINT "workbenchActivity_type_check"
    CHECK ("activityType" IN ('import', 'edit', 'configure')),
  CONSTRAINT "workbenchActivity_action_check"
    CHECK ("action" IN ('create', 'update', 'delete')),
  CONSTRAINT "workbenchActivity_source_check"
    CHECK ("source" IN ('web', 'api', 'import', 'system')),
  CONSTRAINT "workbenchActivity_source_type_check"
    CHECK ("sourceType" IN ('audit', 'request')),
  CONSTRAINT "workbenchActivity_result_check"
    CHECK ("result" IN ('success', 'failed', 'partial')),
  CONSTRAINT "workbenchActivity_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "workbenchActivity_required_text_check"
    CHECK (
      btrim("entityType") <> ''
      AND btrim("entityId") <> ''
      AND btrim("entityLabel") <> ''
      AND btrim("sourceId") <> ''
      AND btrim("idempotencyKey") <> ''
    )
);

COMMENT ON TABLE "public"."workbenchActivity" IS
  'Actor-owned MOM activity read projection. Rows are retained for 12 months from occurredAt; audit logs remain authoritative.';

COMMENT ON COLUMN "public"."workbenchActivity"."metadata" IS
  'Schema-validated activity summary only. Do not store secrets or sensitive document contents.';

-- Base cursor: occurredAt DESC, id DESC. The id tie-breaker prevents gaps or
-- duplicates when several activities share the same event timestamp.
CREATE INDEX "workbenchActivity_company_actor_cursor_idx"
  ON "public"."workbenchActivity"
  ("companyId", "actorId", "occurredAt" DESC, "id" DESC);

CREATE INDEX "workbenchActivity_company_cursor_idx"
  ON "public"."workbenchActivity"
  ("companyId", "occurredAt" DESC, "id" DESC);

CREATE INDEX "workbenchActivity_company_actor_module_type_cursor_idx"
  ON "public"."workbenchActivity"
  (
    "companyId",
    "actorId",
    "module",
    "activityType",
    "occurredAt" DESC,
    "id" DESC
  );

ALTER TABLE "public"."workbenchActivity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workbenchActivity"
FOR SELECT TO authenticated
USING (
  "actorId" = (SELECT auth.uid())::text
  AND "companyId" = ANY (
    (SELECT public.get_companies_with_employee_permission('parts_view'))::text[]
  )
);

-- RLS has no INSERT/UPDATE/DELETE policies. Object privileges reinforce that
-- boundary even if a policy is added accidentally later.
REVOKE ALL ON TABLE "public"."workbenchActivity"
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE "public"."workbenchActivity" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workbenchActivity"
  TO service_role;

-- Upsert one projection batch atomically. The caller supplies a JSON array of
-- WorkbenchActivityProjection values. A successful return must equal the input
-- length; malformed, cross-company, duplicate, or non-employee rows fail the
-- whole call so event retries cannot leave a partially projected batch.
CREATE OR REPLACE FUNCTION "public"."upsert_workbench_activity_batch"(
  p_company_id TEXT,
  p_entries JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_input_count INTEGER;
  v_unique_count INTEGER;
  v_valid_count INTEGER;
  v_affected_count INTEGER;
BEGIN
  IF p_company_id IS NULL OR btrim(p_company_id) = '' THEN
    RAISE EXCEPTION 'companyId is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."company" AS c
    WHERE c."id" = p_company_id
  ) THEN
    RAISE EXCEPTION 'Unknown companyId: %', p_company_id
      USING ERRCODE = '23503';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_input_count
  FROM jsonb_array_elements(p_entries);

  IF v_input_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT
    count(DISTINCT e."idempotencyKey")::integer,
    count(*) FILTER (
      WHERE e."companyId" = p_company_id
        AND e."actorId" IS NOT NULL
        AND btrim(e."actorId") <> ''
        AND e."module" IS NOT NULL
        AND e."activityType" IS NOT NULL
        AND e."action" IS NOT NULL
        AND e."entityType" IS NOT NULL
        AND btrim(e."entityType") <> ''
        AND e."entityId" IS NOT NULL
        AND btrim(e."entityId") <> ''
        AND e."entityLabel" IS NOT NULL
        AND btrim(e."entityLabel") <> ''
        AND e."source" IS NOT NULL
        AND e."sourceType" IS NOT NULL
        AND e."sourceId" IS NOT NULL
        AND btrim(e."sourceId") <> ''
        AND e."result" IS NOT NULL
        AND e."occurredAt" IS NOT NULL
        AND e."idempotencyKey" IS NOT NULL
        AND btrim(e."idempotencyKey") <> ''
        AND COALESCE(jsonb_typeof(e."metadata"), 'object') = 'object'
        AND EXISTS (
          SELECT 1
          FROM "public"."userToCompany" AS utc
          INNER JOIN "public"."employee" AS employee
            ON employee."id" = utc."userId"
            AND employee."companyId" = utc."companyId"
          WHERE utc."userId" = e."actorId"
            AND utc."companyId" = p_company_id
            AND utc."role" = 'employee'
        )
    )::integer
  INTO v_unique_count, v_valid_count
  FROM jsonb_to_recordset(p_entries) AS e(
    "companyId" TEXT,
    "actorId" TEXT,
    "module" TEXT,
    "activityType" TEXT,
    "action" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "source" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "result" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP WITH TIME ZONE,
    "idempotencyKey" TEXT
  );

  IF v_unique_count <> v_input_count THEN
    RAISE EXCEPTION 'entries contain a missing or duplicate idempotencyKey'
      USING ERRCODE = '22023';
  END IF;

  IF v_valid_count <> v_input_count THEN
    RAISE EXCEPTION
      'entries must be complete, company-scoped, and owned by an employee of company %',
      p_company_id
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO "public"."workbenchActivity" AS activity (
    "companyId",
    "actorId",
    "module",
    "activityType",
    "action",
    "entityType",
    "entityId",
    "entityLabel",
    "source",
    "sourceType",
    "sourceId",
    "result",
    "metadata",
    "occurredAt",
    "idempotencyKey"
  )
  SELECT
    e."companyId",
    e."actorId",
    e."module",
    e."activityType",
    e."action",
    e."entityType",
    e."entityId",
    e."entityLabel",
    e."source",
    e."sourceType",
    e."sourceId",
    e."result",
    COALESCE(e."metadata", '{}'::jsonb),
    e."occurredAt",
    e."idempotencyKey"
  FROM jsonb_to_recordset(p_entries) AS e(
    "companyId" TEXT,
    "actorId" TEXT,
    "module" TEXT,
    "activityType" TEXT,
    "action" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "source" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "result" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP WITH TIME ZONE,
    "idempotencyKey" TEXT
  )
  ON CONFLICT ON CONSTRAINT "workbenchActivity_company_idempotency_key"
  DO UPDATE SET
    "actorId" = EXCLUDED."actorId",
    "module" = EXCLUDED."module",
    "activityType" = EXCLUDED."activityType",
    "action" = EXCLUDED."action",
    "entityType" = EXCLUDED."entityType",
    "entityId" = EXCLUDED."entityId",
    "entityLabel" = EXCLUDED."entityLabel",
    "source" = EXCLUDED."source",
    "sourceType" = EXCLUDED."sourceType",
    "sourceId" = EXCLUDED."sourceId",
    "result" = EXCLUDED."result",
    "metadata" = EXCLUDED."metadata",
    "occurredAt" = EXCLUDED."occurredAt",
    "updatedAt" = clock_timestamp();

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  RETURN v_affected_count;
END;
$$;

COMMENT ON FUNCTION "public"."upsert_workbench_activity_batch"(TEXT, JSONB) IS
  'Service-role-only atomic and idempotent upsert for WorkbenchActivityProjection JSON arrays.';

REVOKE ALL ON FUNCTION
  "public"."upsert_workbench_activity_batch"(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  "public"."upsert_workbench_activity_batch"(TEXT, JSONB)
  TO service_role;

-- Fixed retention contract: activities expire 12 months after occurredAt.
-- A NULL company cleans all tenants; a companyId limits the cleanup batch to
-- one tenant. Only the service role can execute this function.
CREATE OR REPLACE FUNCTION "public"."cleanup_workbench_activity_retention"(
  p_company_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."workbenchActivity"
    WHERE "occurredAt" < clock_timestamp() - INTERVAL '12 months'
      AND (
        p_company_id IS NULL
        OR "companyId" = p_company_id
      )
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_deleted_count
  FROM deleted;

  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION "public"."cleanup_workbench_activity_retention"(TEXT) IS
  'Service-role-only cleanup for the fixed 12-month workbench activity retention contract.';

REVOKE ALL ON FUNCTION
  "public"."cleanup_workbench_activity_retention"(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  "public"."cleanup_workbench_activity_retention"(TEXT)
  TO service_role;

-- Ensure all Items sources used by the projection emit async events. Rebuild
-- only the three standard async triggers; do not call attach_event_trigger()
-- because doing so without the full interceptor arrays could remove existing
-- synchronous business invariants.
DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'item',
    'itemShelfLife',
    'itemCost',
    'itemPlanning',
    'itemReplenishment',
    'itemUnitSalePrice',
    'supplierPart',
    'customerPartToItem',
    'makeMethod',
    'methodOperation',
    'methodMaterial',
    'itemPostingGroup',
    'materialDimension',
    'materialFinish',
    'materialForm',
    'materialGrade',
    'materialSubstance',
    'materialType',
    'unitOfMeasure'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'Auditable Items table does not exist: %', v_table_name;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_event_async_ins_' || v_table_name,
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON public.%I '
      || 'REFERENCING NEW TABLE AS batched_new FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION public.dispatch_event_batch()',
      'trg_event_async_ins_' || v_table_name,
      v_table_name
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_event_async_del_' || v_table_name,
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON public.%I '
      || 'REFERENCING OLD TABLE AS batched_old FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION public.dispatch_event_batch()',
      'trg_event_async_del_' || v_table_name,
      v_table_name
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_event_async_upd_' || v_table_name,
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON public.%I '
      || 'REFERENCING NEW TABLE AS batched_new OLD TABLE AS batched_old '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_event_batch()',
      'trg_event_async_upd_' || v_table_name,
      v_table_name
    );
  END LOOP;
END;
$$;

-- Existing audit-enabled tenants may predate the expanded Items dictionary.
-- Backfill (and reactivate) the same subscriptions that syncAuditSubscriptions
-- creates for newly enabled tenants.
INSERT INTO "public"."eventSystemSubscription" (
  "name",
  "table",
  "companyId",
  "operations",
  "handlerType",
  "config",
  "filter",
  "active"
)
SELECT
  'audit-' || source."table",
  source."table",
  company."id",
  ARRAY['INSERT', 'UPDATE', 'DELETE']::text[],
  'AUDIT',
  '{}'::jsonb,
  '{}'::jsonb,
  TRUE
FROM "public"."company" AS company
CROSS JOIN unnest(ARRAY[
  'item',
  'itemShelfLife',
  'itemCost',
  'itemPlanning',
  'itemReplenishment',
  'itemUnitSalePrice',
  'supplierPart',
  'customerPartToItem',
  'makeMethod',
  'methodOperation',
  'methodMaterial',
  'itemPostingGroup',
  'materialDimension',
  'materialFinish',
  'materialForm',
  'materialGrade',
  'materialSubstance',
  'materialType',
  'unitOfMeasure'
]::text[]) AS source("table")
WHERE company."auditLogEnabled" = TRUE
ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company"
DO UPDATE SET
  "operations" = EXCLUDED."operations",
  "handlerType" = EXCLUDED."handlerType",
  "config" = EXCLUDED."config",
  "filter" = EXCLUDED."filter",
  "active" = EXCLUDED."active";
