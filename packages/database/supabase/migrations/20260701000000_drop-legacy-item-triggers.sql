-- Drop legacy item triggers that conflict with the event system interceptors.
-- These were supposed to be dropped by migration 20260410031802 but were
-- inadvertently left behind, causing duplicate key errors on item insert
-- (both the legacy trigger and the event system interceptor tried to create
-- the same itemCost/itemReplenishment/itemUnitSalePrice/itemPlanning records).

DROP TRIGGER IF EXISTS create_item_related_records ON "item";
DROP TRIGGER IF EXISTS create_make_method_related_records ON "item";
