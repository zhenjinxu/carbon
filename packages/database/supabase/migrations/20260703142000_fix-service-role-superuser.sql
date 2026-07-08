-- Fix: PostgreSQL 18 requires SUPERUSER to set the 'role' GUC parameter
-- via set_config(). Supabase Storage API connects as supabase_storage_admin
-- and then uses set_config('role', ...) to switch to service_role for RLS
-- evaluation. This fails with error 42501 (insufficient_privilege) in
-- call_string_check_hook when supabase_storage_admin is not a superuser.
--
-- We grant SUPERUSER to all three roles involved in the Supabase auth chain:
-- - supabase_storage_admin (Storage API's database user)
-- - service_role (the target role for RLS operations)
-- - authenticator (PostgREST's connection role)
ALTER ROLE supabase_storage_admin SUPERUSER;
ALTER ROLE service_role SUPERUSER;
ALTER ROLE authenticator SUPERUSER;
