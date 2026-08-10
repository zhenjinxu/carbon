-- Database restores can preserve Storage's migration history while dropping
-- the schema ACL that makes its tables visible after the API sets the JWT role.
-- Table privileges and RLS policies continue to control object access.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT (
    has_schema_privilege('anon', 'storage', 'USAGE')
    AND has_schema_privilege('authenticated', 'storage', 'USAGE')
    AND has_schema_privilege('service_role', 'storage', 'USAGE')
  ) THEN
    RAISE EXCEPTION
      'Storage schema usage grant failed; run migrations as supabase_admin or the storage schema owner';
  END IF;
END
$$;
