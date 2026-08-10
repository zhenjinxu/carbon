-- Restored databases can retain migration history while missing derived views.
-- Recreate the tenant-aware custom-field table projection used by Settings.
CREATE OR REPLACE VIEW "public"."customFieldTables"
WITH (security_invoker = true) AS
SELECT
  cft.*,
  company.id AS "companyId",
  COALESCE(fields.fields, '[]'::json) AS fields
FROM "public"."customFieldTable" AS cft
CROSS JOIN "public"."company" AS company
LEFT JOIN (
  SELECT
    cf."table",
    cf."companyId",
    json_agg(
      json_build_object(
        'id', cf.id,
        'name', cf.name,
        'sortOrder', cf."sortOrder",
        'dataTypeId', cf."dataTypeId",
        'listOptions', cf."listOptions",
        'active', cf.active,
        'tags', cf.tags,
        'required', cf."required"
      )
      ORDER BY cf."sortOrder", cf.id
    ) AS fields
  FROM "public"."customField" AS cf
  GROUP BY cf."table", cf."companyId"
) AS fields
  ON fields."table" = cft."table"
  AND fields."companyId" = company.id;

GRANT SELECT ON TABLE "public"."customFieldTables" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
