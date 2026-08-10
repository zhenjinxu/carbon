-- Give imported Wodi employee types an editable permission matrix without
-- granting any default business access.
WITH target_types AS (
  SELECT "id"
  FROM public."employeeType"
  WHERE "companyId" = 'd8s9bh4f8gm357312pbg'
    AND "id" IN (
      'a66284bd-fe72-41ff-8e32-16d771ea78d5',
      'eeb0943a-ee57-4e9a-a372-0b1dd4f92203',
      'c4d5726d-ca84-4b67-8729-158af125fdd1',
      '8f251a71-9d84-4366-ac13-f37189e0e205'
    )
), reference_modules AS (
  SELECT DISTINCT permission."module"
  FROM public."employeeTypePermission" AS permission
  INNER JOIN public."employeeType" AS employee_type
    ON employee_type."id" = permission."employeeTypeId"
  WHERE employee_type."companyId" = 'd8s9bh4f8gm357312pbg'
)
INSERT INTO public."employeeTypePermission" (
  "employeeTypeId",
  "module",
  "view",
  "create",
  "update",
  "delete"
)
SELECT
  target_types."id",
  reference_modules."module",
  '{}',
  '{}',
  '{}',
  '{}'
FROM target_types
CROSS JOIN reference_modules
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;