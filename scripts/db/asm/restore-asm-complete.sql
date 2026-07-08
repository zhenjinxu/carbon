-- Complete ASM-TOP-001 Recovery
BEGIN;

-- Disable triggers
ALTER TABLE item DISABLE TRIGGER ALL;
ALTER TABLE "makeMethod" DISABLE TRIGGER ALL;
ALTER TABLE "methodMaterial" DISABLE TRIGGER ALL;
ALTER TABLE "methodOperation" DISABLE TRIGGER ALL;
ALTER TABLE job DISABLE TRIGGER ALL;
ALTER TABLE "jobMakeMethod" DISABLE TRIGGER ALL;
ALTER TABLE "jobMaterial" DISABLE TRIGGER ALL;
ALTER TABLE "jobOperation" DISABLE TRIGGER ALL;

-- Clean existing ASM data
DELETE FROM "jobMaterial" WHERE "jobId" LIKE 'job-asm%';
DELETE FROM "jobOperation" WHERE "jobId" LIKE 'job-asm%';
DELETE FROM "jobMakeMethod" WHERE "jobId" LIKE 'job-asm%';
DELETE FROM job WHERE id LIKE 'job-asm%';
DELETE FROM "methodMaterial" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "methodOperation" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "makeMethod" WHERE id LIKE 'make-item-asm%';
DELETE FROM "itemReplenishment" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemCost" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemUnitSalePrice" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemPlanning" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "workCenterProcess" WHERE "workCenterId" LIKE 'wc-%';
DELETE FROM "workCenter" WHERE id LIKE 'wc-%';
DELETE FROM process WHERE id LIKE 'proc-%';
DELETE FROM item WHERE id LIKE 'item-asm%';

-- Work Centers
INSERT INTO "workCenter" (id, name, "companyId", "createdBy", "createdAt", active, "laborRate", "machineRate", "overheadRate")
VALUES
  ('wc-machining', '机加工中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 50.00, 80.00, 20.00),
  ('wc-assembly-a', '装配车间A', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 40.00, 30.00, 15.00),
  ('wc-assembly-b', '装配车间B', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 45.00, 35.00, 18.00),
  ('wc-testing', '测试中心', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), true, 60.00, 100.00, 25.00);

-- Processes
INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", active)
VALUES
  ('proc-machining', '机加工', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-assembly', '装配', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true),
  ('proc-testing', '测试', 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Inside', true);

-- WorkCenterProcess
INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
VALUES
  ('wc-machining', 'proc-machining', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-a', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-assembly-b', 'proc-assembly', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('wc-testing', 'proc-testing', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Items
INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-leaf-001', 'ASM-LEAF-001', '深沟球轴承', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-002', 'ASM-LEAF-002', '传动齿轮', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-003', 'ASM-LEAF-003', '箱体铸件', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-004', 'ASM-LEAF-004', '控制芯片', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-005', 'ASM-LEAF-005', '电容阵列', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-006', 'ASM-LEAF-006', '电机定子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-007', 'ASM-LEAF-007', '电机转子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-a', 'ASM-SUB-A', '齿轮箱组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-b', 'ASM-SUB-B', '电路板组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-top-001', 'ASM-TOP-001', '精密减速电机总成', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Make Methods
INSERT INTO "makeMethod" (id, "itemId", "companyId", "createdBy", "createdAt", "defaultMethodType")
VALUES
  ('make-item-asm-sub-a', 'item-asm-sub-a', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Make to Order'),
  ('make-item-asm-sub-b', 'item-asm-sub-b', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Make to Order'),
  ('make-item-asm-top-001', 'item-asm-top-001', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'Make to Order');

-- Method Operations (Routing)
INSERT INTO "methodOperation" (id, "makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
VALUES
  ('mo-top-001-01', 'make-item-asm-top-001', 10, 'proc-assembly', 'wc-assembly-a', '齿轮箱组件装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-top-001-02', 'make-item-asm-top-001', 20, 'proc-assembly', 'wc-assembly-b', '电路板组件装配', 0.3, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-top-001-03', 'make-item-asm-top-001', 30, 'proc-assembly', 'wc-assembly-a', '总装：电机组件与齿轮箱组装', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-top-001-04', 'make-item-asm-top-001', 40, 'proc-assembly', 'wc-assembly-b', '总装：电路板与机械组件集成', 0.8, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-top-001-05', 'make-item-asm-top-001', 50, 'proc-testing', 'wc-testing', '性能测试与质检', 0.2, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-sub-a-01', 'make-item-asm-sub-a', 10, 'proc-machining', 'wc-machining', '箱体铸件加工', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-sub-a-02', 'make-item-asm-sub-a', 20, 'proc-assembly', 'wc-assembly-a', '轴承与齿轮装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-sub-a-03', 'make-item-asm-sub-a', 30, 'proc-testing', 'wc-testing', '齿轮箱测试', 0.3, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-sub-b-01', 'make-item-asm-sub-b', 10, 'proc-assembly', 'wc-assembly-b', '电路板焊接与组装', 0.5, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mo-sub-b-02', 'make-item-asm-sub-b', 20, 'proc-testing', 'wc-testing', '电路板功能测试', 0.2, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Method Materials (BOM)
INSERT INTO "methodMaterial" (id, "makeMethodId", "order", "itemId", "quantity", "itemType", description, "companyId", "createdBy", "createdAt")
VALUES
  ('mm-top-001-01', 'make-item-asm-top-001', 10, 'item-asm-sub-a', 1, 'Part', '齿轮箱组件', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-top-001-02', 'make-item-asm-top-001', 20, 'item-asm-sub-b', 1, 'Part', '电路板组件', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-top-001-03', 'make-item-asm-top-001', 30, 'item-asm-leaf-006', 1, 'Part', '电机定子', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-top-001-04', 'make-item-asm-top-001', 40, 'item-asm-leaf-007', 1, 'Part', '电机转子', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-sub-a-01', 'make-item-asm-sub-a', 10, 'item-asm-leaf-001', 4, 'Part', '深沟球轴承', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-sub-a-02', 'make-item-asm-sub-a', 20, 'item-asm-leaf-002', 2, 'Part', '传动齿轮', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-sub-a-03', 'make-item-asm-sub-a', 30, 'item-asm-leaf-003', 1, 'Part', '箱体铸件', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-sub-b-01', 'make-item-asm-sub-b', 10, 'item-asm-leaf-004', 1, 'Part', '控制芯片', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('mm-sub-b-02', 'make-item-asm-sub-b', 20, 'item-asm-leaf-005', 6, 'Part', '电容阵列', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Re-enable triggers
ALTER TABLE item ENABLE TRIGGER ALL;
ALTER TABLE "makeMethod" ENABLE TRIGGER ALL;
ALTER TABLE "methodMaterial" ENABLE TRIGGER ALL;
ALTER TABLE "methodOperation" ENABLE TRIGGER ALL;
ALTER TABLE job ENABLE TRIGGER ALL;
ALTER TABLE "jobMakeMethod" ENABLE TRIGGER ALL;
ALTER TABLE "jobMaterial" ENABLE TRIGGER ALL;
ALTER TABLE "jobOperation" ENABLE TRIGGER ALL;

COMMIT;
