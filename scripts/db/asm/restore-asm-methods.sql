-- Corrected ASM-TOP-001 Recovery Script
BEGIN;

-- Disable triggers
ALTER TABLE "makeMethod" DISABLE TRIGGER ALL;
ALTER TABLE "methodMaterial" DISABLE TRIGGER ALL;
ALTER TABLE "methodOperation" DISABLE TRIGGER ALL;

-- Clean existing data
DELETE FROM "methodMaterial" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "methodOperation" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "makeMethod" WHERE id LIKE 'make-item-asm%';

-- Create Make Methods
INSERT INTO "makeMethod" (id, "itemId", "companyId", "createdBy", "createdAt", version, status)
VALUES
  ('make-item-asm-sub-a', 'item-asm-sub-a', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 1, 'Active'),
  ('make-item-asm-sub-b', 'item-asm-sub-b', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 1, 'Active'),
  ('make-item-asm-top-001', 'item-asm-top-001', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 1, 'Active');

-- Create Method Operations (Routing)
INSERT INTO "methodOperation" (id, "makeMethodId", "order", "operationOrder", description, "companyId", "createdBy", "createdAt", "processId", "workCenterId", "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit")
VALUES
  ('mo-top-001-01', 'make-item-asm-top-001', 10, 'After Previous', '齿轮箱组件装配', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-a', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-top-001-02', 'make-item-asm-top-001', 20, 'After Previous', '电路板组件装配', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-b', 0.3, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-top-001-03', 'make-item-asm-top-001', 30, 'After Previous', '总装：电机组件与齿轮箱组装', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-a', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-top-001-04', 'make-item-asm-top-001', 40, 'After Previous', '总装：电路板与机械组件集成', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-b', 0.8, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-top-001-05', 'make-item-asm-top-001', 50, 'After Previous', '性能测试与质检', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-testing', 'wc-testing', 0.2, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-sub-a-01', 'make-item-asm-sub-a', 10, 'After Previous', '箱体铸件加工', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-machining', 'wc-machining', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-sub-a-02', 'make-item-asm-sub-a', 20, 'After Previous', '轴承与齿轮装配', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-a', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-sub-a-03', 'make-item-asm-sub-a', 30, 'After Previous', '齿轮箱测试', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-testing', 'wc-testing', 0.3, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-sub-b-01', 'make-item-asm-sub-b', 10, 'After Previous', '电路板焊接与组装', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-assembly', 'wc-assembly-b', 0.5, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece'),
  ('mo-sub-b-02', 'make-item-asm-sub-b', 20, 'After Previous', '电路板功能测试', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 'proc-testing', 'wc-testing', 0.2, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece');

-- Create Method Materials (BOM)
INSERT INTO "methodMaterial" (id, "makeMethodId", "methodType", "materialMakeMethodId", "itemType", "itemId", quantity, "unitOfMeasureCode", "companyId", "createdBy", "createdAt", "order")
VALUES
  ('mm-top-001-01', 'make-item-asm-top-001', 'Make to Order', 'make-item-asm-sub-a', 'Part', 'item-asm-sub-a', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 10),
  ('mm-top-001-02', 'make-item-asm-top-001', 'Make to Order', 'make-item-asm-sub-b', 'Part', 'item-asm-sub-b', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 20),
  ('mm-top-001-03', 'make-item-asm-top-001', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-006', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 30),
  ('mm-top-001-04', 'make-item-asm-top-001', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-007', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 40),
  ('mm-sub-a-01', 'make-item-asm-sub-a', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-001', 4, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 10),
  ('mm-sub-a-02', 'make-item-asm-sub-a', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-002', 2, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 20),
  ('mm-sub-a-03', 'make-item-asm-sub-a', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-003', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 30),
  ('mm-sub-b-01', 'make-item-asm-sub-b', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-004', 1, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 10),
  ('mm-sub-b-02', 'make-item-asm-sub-b', 'Pull from Inventory', NULL, 'Part', 'item-asm-leaf-005', 6, 'PCS', 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW(), 20);

-- Re-enable triggers
ALTER TABLE "makeMethod" ENABLE TRIGGER ALL;
ALTER TABLE "methodMaterial" ENABLE TRIGGER ALL;
ALTER TABLE "methodOperation" ENABLE TRIGGER ALL;

COMMIT;
