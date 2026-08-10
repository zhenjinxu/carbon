-- Align employee type RLS with the users module CRUD permissions used by ERP routes.

ALTER TABLE "public"."employeeType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employeeTypePermission" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees with users_update can view/modify employee types" ON "public"."employeeType";
DROP POLICY IF EXISTS "Requests with an API key can access employee types" ON "public"."employeeType";
DROP POLICY IF EXISTS "SELECT" ON "public"."employeeType";
DROP POLICY IF EXISTS "INSERT" ON "public"."employeeType";
DROP POLICY IF EXISTS "UPDATE" ON "public"."employeeType";
DROP POLICY IF EXISTS "DELETE" ON "public"."employeeType";

CREATE POLICY "SELECT" ON "public"."employeeType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_view'))::text[]
  ) OR "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_create'))::text[]
  ) OR "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."employeeType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."employeeType"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."employeeType"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_delete'))::text[]
  )
);

DROP POLICY IF EXISTS "Employees with users_update can view/modify permissions for employee type permissions" ON "public"."employeeTypePermission";
DROP POLICY IF EXISTS "Requests with an API key can access employee type permissions" ON "public"."employeeTypePermission";
DROP POLICY IF EXISTS "SELECT" ON "public"."employeeTypePermission";
DROP POLICY IF EXISTS "INSERT" ON "public"."employeeTypePermission";
DROP POLICY IF EXISTS "UPDATE" ON "public"."employeeTypePermission";
DROP POLICY IF EXISTS "DELETE" ON "public"."employeeTypePermission";

CREATE POLICY "SELECT" ON "public"."employeeTypePermission"
FOR SELECT USING (
  get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_view'))::text[]
  ) OR get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."employeeTypePermission"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_create'))::text[]
  ) OR get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."employeeTypePermission"
FOR UPDATE USING (
  get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."employeeTypePermission"
FOR DELETE USING (
  get_company_id_from_foreign_key("employeeTypeId", 'employeeType') = ANY (
    (SELECT get_companies_with_employee_permission('users_delete'))::text[]
  )
);
