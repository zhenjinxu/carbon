-- Fix: Remove interceptor functions that reference dropped posting group tables.
-- These were missed by 20260501191500_drop_type_posting_group_interceptors.sql.
-- The postingGroupInventory, postingGroupSales, and postingGroupPurchasing tables
-- were dropped in 20260229000000_drop-posting-groups.sql, but these interceptor
-- functions still try to INSERT into them, causing failures when creating
-- locations or item posting groups.

-- =============================================================================
-- 1. Fix location interceptor: keep itemPlanning creation, remove postingGroupInventory inserts
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_create_location_related_records(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Create itemPlanning records for the new location
  INSERT INTO "itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT
    i.id AS "itemId",
    p_new->>'id' AS "locationId",
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM "item" i
  WHERE i."companyId" = p_new->>'companyId';
END;
$$;

-- =============================================================================
-- 2. Drop itemPostingGroup interceptor entirely (all it does is insert into dropped tables)
-- =============================================================================

DROP FUNCTION IF EXISTS sync_create_posting_groups_for_item_posting_group(TEXT, TEXT, JSONB, JSONB) CASCADE;

-- Detach the event trigger from itemPostingGroup table
SELECT attach_event_trigger(
  'itemPostingGroup',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);
