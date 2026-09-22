-- Keep Carbon's text ID generator safe when it is invoked from hardened
-- SECURITY DEFINER functions that intentionally restrict search_path.

CREATE OR REPLACE FUNCTION public.id(_prefix TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  _uuid TEXT;
BEGIN
  _uuid := replace(public.uuid_to_base58(extensions.uuid_generate_v4()), '-', '');

  IF _prefix IS NOT NULL THEN
    RETURN _prefix || '_' || _uuid;
  END IF;

  RETURN _uuid;
END;
$$;

COMMENT ON FUNCTION public.id(TEXT) IS
  'Generates Carbon text IDs. Helper functions are schema-qualified so table defaults keep working inside SECURITY DEFINER functions with restricted search_path.';
