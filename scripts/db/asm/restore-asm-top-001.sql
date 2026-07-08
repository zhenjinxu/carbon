-- ============================================================================
-- ASM-TOP-001 完整数据恢复脚本
-- 使用当前数据库 ID：co-dev (公司), a0000000-0000-0000-0000-000000000001 (用户)
-- 计量单位：PCS (件)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. 创建基础物料 (Leaf Items)
-- ============================================================================

INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-leaf-001', 'ASM-LEAF-001', '深沟球轴承', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-002', 'ASM-LEAF-002', '传动齿轮', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-003', 'ASM-LEAF-003', '箱体铸件', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-004', 'ASM-LEAF-004', '控制芯片', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-005', 'ASM-LEAF-005', '电容阵列', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-006', 'ASM-LEAF-006', '电机定子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-007', 'ASM-LEAF-007', '电机转子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. 创建子装配体 (Sub-Assemblies)
-- ============================================================================

INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-sub-a', 'ASM-SUB-A', '齿轮箱组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-b', 'ASM-SUB-B', '电路板组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. 创建顶层装配体 (Top Assembly)
-- ============================================================================

INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-top-001', 'ASM-TOP-001', '精密减速电机总成', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. 创建工作中心 (Work Centers)
-- ============================================================================

INSERT INTO "workCenter" (id, name, "companyId", "createdBy", "createdAt", active, "laborRate", "machineRate", "overheadRate")
VALUES
  ('wc-machining', '机加工中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 50.00, 80.00, 20.00),
  ('wc-assembly-a', '装配车间A', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 40.00, 30.00, 15.00),
  ('wc-assembly-b', '装配车间B', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 45.00, 35.00, 18.00),
  ('wc-testing', '测试中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 60.00, 100.00, 25.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. 创建工艺 (Processes)
-- ============================================================================

INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", active)
VALUES
  ('proc-machining', '机加工', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-assembly', '装配', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-testing', '测试', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 6. 创建工作中心与工艺关联
-- ============================================================================

INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
VALUES
  ('wc-machining', 'proc-machining', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-a', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-b', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-testing', 'proc-testing', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT ("workCenterId", "processId") DO NOTHING;

-- ============================================================================
-- 7. 创建生产工单 (Jobs)
-- ============================================================================

-- 获取 location ID
DO $$
DECLARE
  v_location_id TEXT;
BEGIN
  SELECT id INTO v_location_id FROM location WHERE "companyId" = 'co-dev' LIMIT 1;

  -- 主工单：ASM-TOP-001
  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status,
                   "productionQuantity", "scrapQuantity", "quantityReceivedToInventory",
                   "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES
    ('job-asm-top-001', 'WO-2026-0010', 'item-asm-top-001', 'PCS', v_location_id, 'Ready',
     10, 0, 0, CURRENT_DATE + INTERVAL '30 days', 'Hard Deadline', 'co-dev',
     'a0000000-0000-0000-0000-000000000001', NOW(), 1)
  ON CONFLICT (id) DO NOTHING;

  -- 子工单：ASM-SUB-A
  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status,
                   "productionQuantity", "scrapQuantity", "quantityReceivedToInventory",
                   "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES
    ('job-asm-sub-a', 'WO-2026-0011', 'item-asm-sub-a', 'PCS', v_location_id, 'Ready',
     10, 0, 0, CURRENT_DATE + INTERVAL '20 days', 'Hard Deadline', 'co-dev',
     'a0000000-0000-0000-0000-000000000001', NOW(), 2)
  ON CONFLICT (id) DO NOTHING;

  -- 子工单：ASM-SUB-B
  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status,
                   "productionQuantity", "scrapQuantity", "quantityReceivedToInventory",
                   "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES
    ('job-asm-sub-b', 'WO-2026-0012', 'item-asm-sub-b', 'PCS', v_location_id, 'Ready',
     10, 0, 0, CURRENT_DATE + INTERVAL '20 days', 'Hard Deadline', 'co-dev',
     'a0000000-0000-0000-0000-000000000001', NOW(), 2)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ============================================================================
-- 8. 创建库存记录 (Item Ledger)
-- ============================================================================

-- 为基础物料创建初始库存
DO $$
DECLARE
  v_location_id TEXT;
BEGIN
  SELECT id INTO v_location_id FROM location WHERE "companyId" = 'co-dev' LIMIT 1;

  INSERT INTO "itemLedger" (id, "itemId", "locationId", "entryType", quantity, "companyId", "createdAt")
  VALUES
    (gen_random_uuid()::text, 'item-asm-leaf-001', v_location_id, 'Positive Adjmt.', 100, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-002', v_location_id, 'Positive Adjmt.', 50, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-003', v_location_id, 'Positive Adjmt.', 30, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-004', v_location_id, 'Positive Adjmt.', 40, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-005', v_location_id, 'Positive Adjmt.', 200, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-006', v_location_id, 'Positive Adjmt.', 25, 'co-dev', NOW()),
    (gen_random_uuid()::text, 'item-asm-leaf-007', v_location_id, 'Positive Adjmt.', 25, 'co-dev', NOW())
  ON CONFLICT DO NOTHING;
END $$;

COMMIT;
