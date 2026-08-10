-- Preserve global employee permissions while keeping access limited to companies
-- where the authenticated user is an employee.

CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
  api_key_scopes jsonb;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    api_key_scopes := get_api_key_scopes();

    IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
      RETURN '{}';
    END IF;

    IF (api_key_scopes ? permission)
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    END IF;

    RETURN '{}';
  END IF;

  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text
    AND "role" = 'employee';

  IF employee_companies IS NULL THEN
    RETURN '{}';
  END IF;

  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
  INTO permission_companies
  FROM public."userPermission"
  WHERE id::text = auth.uid()::text;

  IF permission_companies IS NULL THEN
    RETURN '{}';
  END IF;

  -- A global permission grants access only within the employee's memberships.
  IF '0'::text = ANY(permission_companies) THEN
    RETURN employee_companies;
  END IF;

  SELECT array_agg(company)
  INTO permission_companies
  FROM unnest(permission_companies) AS company
  WHERE company = ANY(employee_companies);

  RETURN COALESCE(permission_companies, '{}');
END;
$$;