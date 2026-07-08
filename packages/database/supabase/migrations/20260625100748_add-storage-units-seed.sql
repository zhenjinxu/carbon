-- Migration: Add default storage units (bins, pallets, cages) for all existing companies
-- This adds 3 storage types and 60 storage units per company

DO $$
DECLARE
  v_company RECORD;
  v_location_id TEXT;
  v_warehouse_id TEXT;
  v_storage_type_ids TEXT[];
  v_bin_type_id TEXT;
  v_pallet_type_id TEXT;
  v_cage_type_id TEXT;
  v_user_id TEXT;
  v_i INTEGER;
BEGIN
  -- Get a system user ID (use the first admin user or create one)
  SELECT u."id" INTO v_user_id
  FROM "user" u
  JOIN "employee" e ON e."id" = u."id"
  LIMIT 1;

  -- If no user found, use 'system' as fallback
  IF v_user_id IS NULL THEN
    v_user_id := 'system';
  END IF;

  -- Loop through all companies
  FOR v_company IN SELECT "id" FROM "company"
  LOOP
    -- Create or get default location for this company
    INSERT INTO "location" ("name", "addressLine1", "city", "stateProvince", "postalCode", "countryCode", "timezone", "companyId", "createdBy")
    VALUES ('Headquarters', '123 Main Street', 'Austin', 'TX', '78701', 'US', 'America/Chicago', v_company."id", v_user_id)
    ON CONFLICT ("name", "companyId") DO UPDATE SET "name" = EXCLUDED."name"
    RETURNING "id" INTO v_location_id;

    -- Create or get default warehouse for this company
    INSERT INTO "warehouse" ("name", "locationId", "companyId", "createdBy")
    VALUES ('Main Warehouse', v_location_id, v_company."id", v_user_id)
    ON CONFLICT ("name", "companyId") DO UPDATE SET "name" = EXCLUDED."name"
    RETURNING "id" INTO v_warehouse_id;

    -- Create 3 storage types
    INSERT INTO "storageType" ("name", "companyId", "createdBy")
    VALUES
      ('料箱', v_company."id", v_user_id),
      ('托盘', v_company."id", v_user_id),
      ('笼箱', v_company."id", v_user_id)
    ON CONFLICT DO NOTHING;

    -- Get individual type IDs
    SELECT "id" INTO v_bin_type_id FROM "storageType" WHERE "companyId" = v_company."id" AND "name" = '料箱';
    SELECT "id" INTO v_pallet_type_id FROM "storageType" WHERE "companyId" = v_company."id" AND "name" = '托盘';
    SELECT "id" INTO v_cage_type_id FROM "storageType" WHERE "companyId" = v_company."id" AND "name" = '笼箱';

    -- Insert 20 bins (B0001-B0020)
    FOR v_i IN 1..20 LOOP
      INSERT INTO "storageUnit" ("name", "locationId", "warehouseId", "companyId", "createdBy", "storageTypeIds")
      VALUES (
        'B' || LPAD(v_i::TEXT, 4, '0'),
        v_location_id,
        v_warehouse_id,
        v_company."id",
        v_user_id,
        ARRAY[v_bin_type_id]
      )
      ON CONFLICT ("name", "locationId") DO NOTHING;
    END LOOP;

    -- Insert 20 pallets (P0001-P0020)
    FOR v_i IN 1..20 LOOP
      INSERT INTO "storageUnit" ("name", "locationId", "warehouseId", "companyId", "createdBy", "storageTypeIds")
      VALUES (
        'P' || LPAD(v_i::TEXT, 4, '0'),
        v_location_id,
        v_warehouse_id,
        v_company."id",
        v_user_id,
        ARRAY[v_pallet_type_id]
      )
      ON CONFLICT ("name", "locationId") DO NOTHING;
    END LOOP;

    -- Insert 20 cages (C0001-C0020)
    FOR v_i IN 1..20 LOOP
      INSERT INTO "storageUnit" ("name", "locationId", "warehouseId", "companyId", "createdBy", "storageTypeIds")
      VALUES (
        'C' || LPAD(v_i::TEXT, 4, '0'),
        v_location_id,
        v_warehouse_id,
        v_company."id",
        v_user_id,
        ARRAY[v_cage_type_id]
      )
      ON CONFLICT ("name", "locationId") DO NOTHING;
    END LOOP;

    RAISE NOTICE 'Added storage units for company %', v_company."id";
  END LOOP;
END $$;
