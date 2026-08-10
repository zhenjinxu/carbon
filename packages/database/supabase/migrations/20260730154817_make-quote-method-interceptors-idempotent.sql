-- Quote method rows may be created transactionally by get-method before the
-- asynchronous event interceptor runs. Preserve one root/child method per source.

CREATE OR REPLACE FUNCTION sync_insert_quote_line_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM "quoteMakeMethod"
    WHERE "quoteLineId" = p_new->>'id'
      AND "parentMaterialId" IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT version INTO v_version
  FROM "activeMakeMethods"
  WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", version
  ) VALUES (
    p_new->>'quoteId', p_new->>'id', p_new->>'itemId',
    p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION sync_insert_quote_material_make_method(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_version NUMERIC;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM "quoteMakeMethod"
    WHERE "quoteLineId" = p_new->>'quoteLineId'
      AND "parentMaterialId" = p_new->>'id'
  ) THEN
    RETURN;
  END IF;

  SELECT version INTO v_version
  FROM "activeMakeMethods"
  WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "parentMaterialId", "itemId",
    "companyId", "createdAt", "createdBy", version
  ) VALUES (
    p_new->>'quoteId', p_new->>'quoteLineId', p_new->>'id',
    p_new->>'itemId', p_new->>'companyId', NOW(),
    p_new->>'createdBy', v_version
  );
END;
$$;
