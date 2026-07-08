-- Fix: service_role must bypass RLS for the Supabase service layer to work.
-- Without this, queries through PostgREST using the service_role key are
-- filtered by RLS policies that check auth.uid() (which is NULL for
-- service_role requests), causing data to be invisible in the ERP/MES apps.

ALTER ROLE service_role BYPASSRLS;
