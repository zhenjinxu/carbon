-- MES Demo Data - Simplified version
-- Creates foundational MES data for demo
-- Run: psql -U postgres -p 56251 -f scripts/seed-mes-demo.sql

BEGIN;

DO $$
DECLARE
  v_company_id TEXT := 'd8s8fccf8gm9pa312p7g';
  v_user_id TEXT := 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc';
  v_location_id TEXT := 'loc_94nmM3ErMMNhHmBaqHLeyg';
  v_now TIMESTAMPTZ := now();
  v_user2_id TEXT;
  v_user3_id TEXT;
  v_wc_cnc_id TEXT;
  v_wc_assembly_id TEXT;
  v_wc_qc_id TEXT;
  v_process_cnc_id TEXT;
  v_process_assembly_id TEXT;
  v_process_inspect_id TEXT;
  v_process_pack_id TEXT;
  v_item_raw_id TEXT;
  v_item_sub_id TEXT;
  v_item_finished_id TEXT;
BEGIN
  -- ============================================================
  -- 1. Additional Employees
  -- ============================================================
  v_user2_id := 'mes_emp_zhang_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO "user" (id, email, "firstName", "lastName", active)
  VALUES (v_user2_id, 'zhang@carbon.local', 'Wei', 'Zhang', true)
  ON CONFLICT (id) DO NOTHING;

  v_user3_id := 'mes_emp_li_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO "user" (id, email, "firstName", "lastName", active)
  VALUES (v_user3_id, 'li@carbon.local', 'Na', 'Li', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "userToCompany" ("userId", "companyId", role)
  VALUES
    (v_user2_id, v_company_id, 'employee'),
    (v_user3_id, v_company_id, 'employee')
  ON CONFLICT ("userId", "companyId") DO NOTHING;

  INSERT INTO "userPermission" (id, permissions)
  VALUES
    (v_user2_id, '{"role": "employee"}'::jsonb),
    (v_user3_id, '{"role": "employee"}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ============================================================
  -- 2. Work Centers
  -- ============================================================
  v_wc_cnc_id := 'mes_wc_cnc_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO "workCenter" (id, name, description, "laborRate", "machineRate", "overheadRate",
    "defaultStandardFactor", "locationId", "companyId", "createdBy", "createdAt", active)
  VALUES (v_wc_cnc_id, 'CNC Center A', 'HAAS VF-2 CNC Milling Machine',
    45.00, 85.00, 0, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true);

  v_wc_assembly_id := 'mes_wc_asm_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO "workCenter" (id, name, description, "laborRate", "machineRate", "overheadRate",
    "defaultStandardFactor", "locationId", "companyId", "createdBy", "createdAt", active)
  VALUES (v_wc_assembly_id, 'Assembly Station B', 'Manual assembly with pneumatic tools',
    35.00, 0, 0, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true);

  v_wc_qc_id := 'mes_wc_qc_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO "workCenter" (id, name, description, "laborRate", "machineRate", "overheadRate",
    "defaultStandardFactor", "locationId", "companyId", "createdBy", "createdAt", active)
  VALUES (v_wc_qc_id, 'Quality Inspection', 'CMM and visual inspection station',
    50.00, 20.00, 0, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true);

  -- ============================================================
  -- 3. Processes
  -- ============================================================
  v_process_cnc_id := 'mes_proc_cnc_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", "completeAllOnScan", active)
  VALUES (v_process_cnc_id, 'CNC Machining', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true);

  v_process_assembly_id := 'mes_proc_asm_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", "completeAllOnScan", active)
  VALUES (v_process_assembly_id, 'Assembly', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true);

  v_process_inspect_id := 'mes_proc_insp_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", "completeAllOnScan", active)
  VALUES (v_process_inspect_id, 'Inspection', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true);

  v_process_pack_id := 'mes_proc_pack_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", "completeAllOnScan", active)
  VALUES (v_process_pack_id, 'Packaging', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true);

  INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
  VALUES
    (v_wc_cnc_id, v_process_cnc_id, v_company_id, v_user_id, v_now),
    (v_wc_assembly_id, v_process_assembly_id, v_company_id, v_user_id, v_now),
    (v_wc_qc_id, v_process_inspect_id, v_company_id, v_user_id, v_now);

  -- ============================================================
  -- 4. Items
  -- ============================================================
  v_item_raw_id := 'mes_item_raw_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO item (id, "readableId", name, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES (v_item_raw_id, 'RM-STEEL-10', 'Steel Plate 10mm', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified');

  v_item_sub_id := 'mes_item_sub_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO item (id, "readableId", name, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES (v_item_sub_id, 'SA-MOTOR-001', 'Drive Motor Assembly', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified');

  v_item_finished_id := 'mes_item_fg_' || REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO item (id, "readableId", name, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES (v_item_finished_id, 'FG-ROLLER-CR200', 'Conveyor Roller Unit CR-200', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified');

  -- ============================================================
  -- 5. Jobs (without BOM/operations - let triggers handle it)
  -- ============================================================
  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId",
    status, quantity, "scrapQuantity", "quantityComplete", "quantityShipped", "quantityReceivedToInventory",
    "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES ('mes_job_001_' || REPLACE(gen_random_uuid()::TEXT, '-', ''), 'WO-2026-0001', v_item_finished_id, 'EA', v_location_id,
    'In Progress', 50, 2, 15, 0, 0,
    CURRENT_DATE + INTERVAL '14 days', 'Hard Deadline', v_company_id, v_user_id, v_now, 1);

  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId",
    status, quantity, "scrapQuantity", "quantityComplete", "quantityShipped", "quantityReceivedToInventory",
    "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES ('mes_job_002_' || REPLACE(gen_random_uuid()::TEXT, '-', ''), 'WO-2026-0002', v_item_sub_id, 'EA', v_location_id,
    'Ready', 20, 1, 0, 0, 0,
    CURRENT_DATE + INTERVAL '7 days', 'Soft Deadline', v_company_id, v_user_id, v_now, 2);

  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId",
    status, quantity, "scrapQuantity", "quantityComplete", "quantityShipped", "quantityReceivedToInventory",
    "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES ('mes_job_003_' || REPLACE(gen_random_uuid()::TEXT, '-', ''), 'WO-2026-0003', v_item_finished_id, 'EA', v_location_id,
    'Completed', 10, 0, 10, 10, 10,
    CURRENT_DATE - INTERVAL '3 days', 'ASAP', v_company_id, v_user_id, v_now, 1);

  -- ============================================================
  -- 6. Quality Document
  -- ============================================================
  INSERT INTO "qualityDocument" (id, name, version, status, "companyId", "createdBy", "createdAt")
  VALUES ('qdoc_' || REPLACE(gen_random_uuid()::TEXT, '-', ''), 'Roller Dimensional Inspection', 1, 'Active', v_company_id, v_user_id, v_now);

  -- ============================================================
  -- 7. Maintenance
  -- ============================================================
  INSERT INTO "maintenanceFailureMode" (id, name, "companyId", "createdBy", "createdAt", type)
  VALUES ('mes_mfm_' || REPLACE(gen_random_uuid()::TEXT, '-', ''), 'Spindle Bearing Wear', v_company_id, v_user_id, v_now, 'Maintenance');

  RAISE NOTICE 'MES demo data created successfully!';
END
$$;

COMMIT;
