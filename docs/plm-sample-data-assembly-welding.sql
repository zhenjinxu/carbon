-- ============================================================================
-- PLM 集成 API - 装配与焊接场景范例数据
-- ============================================================================
-- 场景描述：自动焊接工作站（含底座框架、焊接臂、控制系统）
-- 创建时间：2026-07-04
-- 用途：演示 PLM API 的物品组、物品、BOM、工艺路线的完整数据结构
-- ============================================================================

-- 公司 ID（使用现有公司）
-- Carbon Development: d8s9bh4f8gm357312pbg
-- 用户 ID（使用现有用户）
-- dev@carbon.com: 6e1a3028-ec10-4db1-8db4-1db918ac44af

-- ============================================================================
-- 1. 工序定义（Process）
-- ============================================================================
-- 检查是否已存在，不存在则创建

INSERT INTO process (id, name, "defaultStandardFactor", "processType", "companyId", "createdBy", "createdAt", active)
VALUES
  ('proc-welding', '焊接', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('proc-assembly', '装配', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('proc-cutting', '切割下料', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('proc-machining', '机加工', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('proc-painting', '喷涂', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('proc-inspection', '检验', 'Hours/Piece', 'Inside', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. 工作中心定义（Work Center）
-- ============================================================================

INSERT INTO "workCenter" (id, name, description, "laborRate", "machineRate", "defaultStandardFactor", "companyId", "createdBy", "createdAt", active)
VALUES
  ('wc-welding-01', '焊接工位 #1', 'MIG/MAG 焊接工位，配焊接机器人', 80.00, 120.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('wc-assembly-01', '装配工位 #1', '机械装配工位，配电动工具', 60.00, 0.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('wc-cutting-01', '切割工位', '激光切割+等离子切割', 50.00, 150.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('wc-machining-01', '机加工工位', 'CNC 加工中心', 70.00, 180.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('wc-painting-01', '喷涂工位', '自动喷涂线', 40.00, 100.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true),
  ('wc-inspection-01', '检验工位', '三坐标测量+视觉检测', 90.00, 200.00, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. 工作中心-工序关联
-- ============================================================================

INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
VALUES
  ('wc-welding-01', 'proc-welding', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('wc-assembly-01', 'proc-assembly', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('wc-cutting-01', 'proc-cutting', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('wc-machining-01', 'proc-machining', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('wc-painting-01', 'proc-painting', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('wc-inspection-01', 'proc-inspection', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. 原材料（Material）- 采购类
-- ============================================================================

-- 4.1 钢材类
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-steel-plate-10', 'MAT-STL-010', '钢板 10mm', 'Q235B 热轧钢板，厚度 10mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-steel-plate-20', 'MAT-STL-020', '钢板 20mm', 'Q235B 热轧钢板，厚度 20mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-steel-tube-50', 'MAT-STL-030', '方管 50x50x3', 'Q235B 方管，50x50x3mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-steel-tube-80', 'MAT-STL-040', '方管 80x80x4', 'Q235B 方管，80x80x4mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-steel-angle', 'MAT-STL-050', '角钢 50x50x5', 'Q235B 等边角钢，50x50x5mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- 4.2 铝材类
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-alu-plate-5', 'MAT-ALU-010', '铝板 5mm', '6061-T6 铝板，厚度 5mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-alu-plate-10', 'MAT-ALU-020', '铝板 10mm', '6061-T6 铝板，厚度 10mm', 'Material', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- 4.3 焊接材料（消耗品）
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-welding-wire', 'CON-WELD-001', '焊丝 ER50-6', 'CO2 气体保护焊丝，直径 1.2mm，15kg/盘', 'Consumable', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-welding-gas', 'CON-WELD-002', '保护气体 CO2', '工业级 CO2 气体，99.9% 纯度，40L/瓶', 'Consumable', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-welding-nozzle', 'CON-WELD-003', '焊接喷嘴', 'MIG 焊接喷嘴，标准型', 'Consumable', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-welding-tip', 'CON-WELD-004', '导电嘴', 'MIG 焊接导电嘴，1.2mm 孔径', 'Consumable', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- 4.4 涂料类
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-paint-ral7035', 'CON-PNT-001', '工业漆 RAL7035', '环氧底漆，浅灰色，20L/桶', 'Consumable', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-paint-thinner', 'CON-PNT-002', '稀释剂', '工业稀释剂，5L/瓶', 'Consumable', 'Buy', 'Pull from Inventory', 'Batch', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. 标准件（Part）- 采购类
-- ============================================================================

INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-bolt-m10x30', 'STD-BLT-001', '螺栓 M10x30', '8.8 级六角螺栓，M10x30mm', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-bolt-m12x40', 'STD-BLT-002', '螺栓 M12x40', '8.8 级六角螺栓，M12x40mm', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-nut-m10', 'STD-NUT-001', '螺母 M10', '8 级六角螺母，M10', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-nut-m12', 'STD-NUT-002', '螺母 M12', '8 级六角螺母，M12', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-washer-m10', 'STD-WAS-001', '垫圈 M10', '平垫圈，M10', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-bearing-6205', 'STD-BRG-001', '深沟球轴承 6205', 'SKF 6205-2Z，双面密封', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('item-bearing-6208', 'STD-BRG-002', '深沟球轴承 6208', 'SKF 6208-2Z，双面密封', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 6. 工具（Tool）
-- ============================================================================

INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('tool-wrench-m10', 'TOL-WRN-001', '扭力扳手 M10', '数显扭力扳手，范围 10-100 Nm', 'Tool', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('tool-wrench-m12', 'TOL-WRN-002', '扭力扳手 M12', '数显扭力扳手，范围 20-200 Nm', 'Tool', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('tool-drill-bit-5', 'TOL-DRL-001', '钻头 5mm', 'HSS 高速钢钻头，5mm', 'Tool', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('tool-drill-bit-8', 'TOL-DRL-002', '钻头 8mm', 'HSS 高速钢钻头，8mm', 'Tool', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified'),
  ('tool-grinding-disc', 'TOL-GRD-001', '砂轮片', '角磨机砂轮片，125mm', 'Tool', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), false, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 7. 子装配（Part - Make）
-- ============================================================================

-- 7.1 底座框架（焊接件）
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-base-frame', 'SUB-FRM-001', '底座框架', '焊接底座框架，含喷涂', 'Part', 'Make', 'Make to Order', 'Serial', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- 7.2 焊接臂组件
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-welding-arm', 'SUB-ARM-001', '焊接臂组件', '三轴焊接臂，含电机和导轨', 'Part', 'Make', 'Make to Order', 'Serial', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- 7.3 控制系统
INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-control-system', 'SUB-CTL-001', '控制系统', 'PLC 控制系统，含 HMI 触摸屏', 'Part', 'Make', 'Make to Order', 'Serial', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. 成品（Part - Make）
-- ============================================================================

INSERT INTO item (id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "requiresInspection", "sourcingType")
VALUES
  ('item-welding-station', 'FIN-AWS-001', '自动焊接工作站', '六轴自动焊接工作站，含底座、焊接臂、控制系统', 'Part', 'Make', 'Make to Order', 'Serial', 'EA', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW(), true, 'Specified')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. 制造方法（Make Method）
-- ============================================================================

-- 9.1 底座框架的制造方法
INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
VALUES
  ('mm-base-frame', 'item-base-frame', 1, 'Active', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT DO NOTHING;

-- 9.2 焊接臂的制造方法
INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
VALUES
  ('mm-welding-arm', 'item-welding-arm', 1, 'Active', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT DO NOTHING;

-- 9.3 控制系统的制造方法
INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
VALUES
  ('mm-control-system', 'item-control-system', 1, 'Active', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT DO NOTHING;

-- 9.4 成品的制造方法
INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
VALUES
  ('mm-welding-station', 'item-welding-station', 1, 'Active', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10. BOM 物料清单（Method Material）
-- ============================================================================

-- 注意：makeMethod 的 id 列有默认值 id('make')，会自动生成带前缀的 ID
-- 我们需要先查出实际生成的 ID
DO $$
DECLARE
  mm_base_frame TEXT;
  mm_welding_arm TEXT;
  mm_control_system TEXT;
  mm_welding_station TEXT;
BEGIN
  SELECT id INTO mm_base_frame FROM "makeMethod" WHERE "itemId" = 'item-base-frame';
  SELECT id INTO mm_welding_arm FROM "makeMethod" WHERE "itemId" = 'item-welding-arm';
  SELECT id INTO mm_control_system FROM "makeMethod" WHERE "itemId" = 'item-control-system';
  SELECT id INTO mm_welding_station FROM "makeMethod" WHERE "itemId" = 'item-welding-station';

  -- 10.1 底座框架的 BOM
  INSERT INTO "methodMaterial" ("makeMethodId", "methodType", "itemType", "itemId", quantity, "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_base_frame, 'Pull from Inventory', 'Material', 'item-steel-plate-20', 4, 'EA', 10, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Material', 'item-steel-tube-80', 8, 'EA', 20, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Material', 'item-steel-angle', 12, 'EA', 30, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Consumable', 'item-welding-wire', 2, 'EA', 40, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Consumable', 'item-welding-gas', 1, 'EA', 50, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Consumable', 'item-paint-ral7035', 1, 'EA', 60, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Part', 'item-bolt-m12x40', 24, 'EA', 70, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 'Pull from Inventory', 'Part', 'item-nut-m12', 24, 'EA', 80, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 10.2 焊接臂的 BOM
  INSERT INTO "methodMaterial" ("makeMethodId", "methodType", "itemType", "itemId", quantity, "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_welding_arm, 'Pull from Inventory', 'Material', 'item-alu-plate-10', 6, 'EA', 10, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 'Pull from Inventory', 'Material', 'item-steel-tube-50', 4, 'EA', 20, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 'Pull from Inventory', 'Part', 'item-bearing-6208', 4, 'EA', 30, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 'Pull from Inventory', 'Part', 'item-bolt-m10x30', 32, 'EA', 40, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 'Pull from Inventory', 'Part', 'item-nut-m10', 32, 'EA', 50, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 'Pull from Inventory', 'Consumable', 'item-welding-wire', 1, 'EA', 60, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 10.3 控制系统的 BOM（简化）
  INSERT INTO "methodMaterial" ("makeMethodId", "methodType", "itemType", "itemId", quantity, "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_control_system, 'Pull from Inventory', 'Part', 'item-bolt-m10x30', 16, 'EA', 10, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_control_system, 'Pull from Inventory', 'Part', 'item-nut-m10', 16, 'EA', 20, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 10.4 成品的 BOM（顶层装配）
  INSERT INTO "methodMaterial" ("makeMethodId", "methodType", "materialMakeMethodId", "itemType", "itemId", quantity, "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_welding_station, 'Make to Order', mm_base_frame, 'Part', 'item-base-frame', 1, 'EA', 10, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 'Make to Order', mm_welding_arm, 'Part', 'item-welding-arm', 1, 'EA', 20, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 'Make to Order', mm_control_system, 'Part', 'item-control-system', 1, 'EA', 30, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 'Pull from Inventory', NULL, 'Part', 'item-bolt-m12x40', 16, 'EA', 40, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 'Pull from Inventory', NULL, 'Part', 'item-nut-m12', 16, 'EA', 50, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 'Pull from Inventory', NULL, 'Tool', 'tool-wrench-m12', 1, 'EA', 60, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 11.1 底座框架的工艺路线
  INSERT INTO "methodOperation" ("makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_base_frame, 10, 'proc-cutting', 'wc-cutting-01', '钢板切割下料', 1.0, 'Total Hours', 0.5, 'Hours/Piece', 2.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 20, 'proc-welding', 'wc-welding-01', '框架焊接', 2.0, 'Total Hours', 1.0, 'Hours/Piece', 8.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 30, 'proc-machining', 'wc-machining-01', '焊接后加工', 1.0, 'Total Hours', 0.5, 'Hours/Piece', 3.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 40, 'proc-painting', 'wc-painting-01', '喷涂底漆', 1.0, 'Total Hours', 0.5, 'Hours/Piece', 2.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_base_frame, 50, 'proc-inspection', 'wc-inspection-01', '尺寸检验', 0.5, 'Total Hours', 1.0, 'Hours/Piece', 0.5, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 11.2 焊接臂的工艺路线
  INSERT INTO "methodOperation" ("makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_welding_arm, 10, 'proc-cutting', 'wc-cutting-01', '铝板切割', 0.5, 'Total Hours', 0.3, 'Hours/Piece', 1.5, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 20, 'proc-machining', 'wc-machining-01', '精密加工', 1.0, 'Total Hours', 0.5, 'Hours/Piece', 4.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 30, 'proc-assembly', 'wc-assembly-01', '轴承装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_arm, 40, 'proc-inspection', 'wc-inspection-01', '装配检验', 0.5, 'Total Hours', 1.5, 'Hours/Piece', 0.5, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 11.3 控制系统的工艺路线
  INSERT INTO "methodOperation" ("makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_control_system, 10, 'proc-assembly', 'wc-assembly-01', '电气装配', 1.0, 'Total Hours', 4.0, 'Hours/Piece', 0.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_control_system, 20, 'proc-inspection', 'wc-inspection-01', '电气测试', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 1.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());

  -- 11.4 成品的工艺路线（总装）
  INSERT INTO "methodOperation" ("makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
  VALUES
    (mm_welding_station, 10, 'proc-assembly', 'wc-assembly-01', '底座安装', 1.0, 'Total Hours', 2.0, 'Hours/Piece', 0.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 20, 'proc-assembly', 'wc-assembly-01', '焊接臂安装', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 30, 'proc-assembly', 'wc-assembly-01', '控制系统安装', 1.0, 'Total Hours', 2.0, 'Hours/Piece', 0.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 40, 'proc-inspection', 'wc-inspection-01', '整机调试', 2.0, 'Total Hours', 4.0, 'Hours/Piece', 2.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
    (mm_welding_station, 50, 'proc-inspection', 'wc-inspection-01', '最终检验', 1.0, 'Total Hours', 2.0, 'Hours/Piece', 1.0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW());
END $$;

-- ============================================================================
-- 13. 物品组（Item Posting Groups）
-- ============================================================================
-- 物品组用于物料分类和财务核算，是 Carbon ERP 的核心概念
-- 借鉴了 Microsoft Dynamics 365 Business Central 等成熟 ERP 系统的最佳实践

INSERT INTO "itemPostingGroup" (id, name, description, active, "companyId", "createdBy", "createdAt")
VALUES
  ('grp-raw-steel', '原材料-钢材', 'Q235B 钢板、方管、角钢等结构钢材', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-raw-alu', '原材料-铝材', '6061-T6 铝板等铝合金材料', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-std-fastener', '标准件-紧固件', '螺栓、螺母、垫圈等标准紧固件', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-std-bearing', '标准件-轴承', '深沟球轴承等标准轴承', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-consumable-weld', '消耗品-焊接材料', '焊丝、保护气体、喷嘴等焊接耗材', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-consumable-paint', '消耗品-涂料', '工业漆、稀释剂等涂料', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-tool', '工具', '扭力扳手、钻头、砂轮片等工具', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-subassembly', '子装配', '底座框架、焊接臂、控制系统等子装配件', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW()),
  ('grp-finished', '成品', '自动焊接工作站等成品', true, 'd8s9bh4f8gm357312pbg', '6e1a3028-ec10-4db1-8db4-1db918ac44af', NOW())
ON CONFLICT (id) DO NOTHING;

-- 关联物品到物品组（通过更新 itemCost 表的 itemPostingGroupId）
UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-raw-steel' WHERE "itemId" IN (
  'item-steel-plate-10', 'item-steel-plate-20', 'item-steel-tube-50', 'item-steel-tube-80', 'item-steel-angle'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-raw-alu' WHERE "itemId" IN (
  'item-alu-plate-5', 'item-alu-plate-10'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-std-fastener' WHERE "itemId" IN (
  'item-bolt-m10x30', 'item-bolt-m12x40', 'item-nut-m10', 'item-nut-m12', 'item-washer-m10'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-std-bearing' WHERE "itemId" IN (
  'item-bearing-6205', 'item-bearing-6208'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-consumable-weld' WHERE "itemId" IN (
  'item-welding-wire', 'item-welding-gas', 'item-welding-nozzle', 'item-welding-tip'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-consumable-paint' WHERE "itemId" IN (
  'item-paint-ral7035', 'item-paint-thinner'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-tool' WHERE "itemId" IN (
  'tool-wrench-m10', 'tool-wrench-m12', 'tool-drill-bit-5', 'tool-drill-bit-8', 'tool-grinding-disc'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-subassembly' WHERE "itemId" IN (
  'item-base-frame', 'item-welding-arm', 'item-control-system'
);

UPDATE "itemCost" SET "itemPostingGroupId" = 'grp-finished' WHERE "itemId" = 'item-welding-station';

-- ============================================================================
-- 14. 验证查询
-- ============================================================================

-- 验证物品组分配
SELECT
  pg.name as "物品组",
  COUNT(ic."itemId") as "物品数量"
FROM "itemPostingGroup" pg
LEFT JOIN "itemCost" ic ON ic."itemPostingGroupId" = pg.id
WHERE pg."companyId" = 'd8s9bh4f8gm357312pbg'
GROUP BY pg.name
ORDER BY pg.name;

-- 查询所有创建的物品
SELECT
  type,
  COUNT(*) as count,
  array_agg("readableId" ORDER BY "readableId") as items
FROM item
WHERE id LIKE 'item-%' OR id LIKE 'tool-%'
GROUP BY type
ORDER BY type;

-- 查询 BOM 结构
SELECT
  mm."itemId" as parent_item_id,
  i."readableId" as parent_readable_id,
  i.name as parent_name,
  COUNT(mml.id) as bom_lines
FROM "makeMethod" mm
JOIN item i ON i.id = mm."itemId"
LEFT JOIN "methodMaterial" mml ON mml."makeMethodId" = mm.id
WHERE mm."itemId" IN ('item-base-frame', 'item-welding-arm', 'item-control-system', 'item-welding-station')
GROUP BY mm."itemId", i."readableId", i.name
ORDER BY i."readableId";

-- 查询工艺路线
SELECT
  mm."itemId" as item_id,
  i."readableId",
  i.name,
  COUNT(mo.id) as operations
FROM "makeMethod" mm
JOIN item i ON i.id = mm."itemId"
LEFT JOIN "methodOperation" mo ON mo."makeMethodId" = mm.id
WHERE mm."itemId" IN ('item-base-frame', 'item-welding-arm', 'item-control-system', 'item-welding-station')
GROUP BY mm."itemId", i."readableId", i.name
ORDER BY i."readableId";

-- ============================================================================
-- 完成
-- ============================================================================
