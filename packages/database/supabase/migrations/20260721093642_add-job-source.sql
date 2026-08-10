CREATE TYPE "public"."jobSource" AS ENUM ('Carbon MRP', 'U8 ERP');

DROP VIEW IF EXISTS "public"."jobs";

ALTER TABLE "public"."job"
  ADD COLUMN "source" "public"."jobSource" NOT NULL DEFAULT 'Carbon MRP';

UPDATE "public"."job" j
SET "source" = 'U8 ERP'
WHERE j."customFields" ? 'wodiMES'
   OR EXISTS (
     SELECT 1
     FROM "public"."u8WorkOrder" u8
     WHERE u8."jobId" = j."id"
       AND u8."companyId" = j."companyId"
   );

CREATE INDEX "job_companyId_source_idx"
  ON "public"."job" ("companyId", "source");

CREATE VIEW "public"."jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "public"."job" j
  INNER JOIN "public"."item" i
    ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "public"."job" j
LEFT JOIN "public"."jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "public"."item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "public"."modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "public"."salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "public"."quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";

GRANT SELECT ON TABLE "public"."jobs" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
