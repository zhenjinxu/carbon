-- ============================================================================
-- ASM-TOP-001 简化恢复脚本
-- 只恢复核心物品数据，让触发器自动创建关联记录
-- ============================================================================

-- 先清理可能存在的旧数据
DELETE FROM job WHERE id LIKE 'job-asm%';
DELETE FROM itemLedger WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "workCenter" WHERE id LIKE 'wc-%';
DELETE FROM process WHERE id LIKE 'proc-%';
DELETE FROM "workCenterProcess" WHERE "workCenterId" LIKE 'wc-%';
DELETE FROM item WHERE id LIKE 'item-asm%';

BEGIN;

-- ============================================================================
-- 1. 创建基础物料 (Leaf Items) - 让触发器自动创建关联记录
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
  ('item-asm-leaf-007', 'ASM-LEAF-007', '电机转子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- ============================================================================
-- 2. 创建子装配体 (Sub-Assemblies)
-- ============================================================================

INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-sub-a', 'ASM-SUB-A', '齿轮箱组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-b', 'ASM-SUB-B', '电路板组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- ============================================================================
-- 3. 创建顶层装配体 (Top Assembly)
-- ============================================================================

INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-top-001', 'ASM-TOP-001', '精密减速电机总成', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

COMMIT;

-- ============================================================================
-- 4. 创建工作中心和工艺
-- ============================================================================

BEGIN;

INSERT INTO "workCenter" (id, name, "companyId", "createdBy", "createdAt", active, "laborRate", "machineRate", "overheadRate")
VALUES
  ('wc-machining', '机加工中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 50.00, 80.00, 20.00),
  ('wc-assembly-a', '装配车间A', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 40.00, 30.00, 15.00),
  ('wc-assembly-b', '装配车间B', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 45.00, 35.00, 18.00),
  ('wc-testing', '测试中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 60.00, 100.00, 25.00);

INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", active)
VALUES
  ('proc-machining', '机加工', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-assembly', '装配', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-testing', '测试', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true);

INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
VALUES
  ('wc-machining', 'proc-machining', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-a', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-b', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-testing', 'proc-testing', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

COMMIT;
