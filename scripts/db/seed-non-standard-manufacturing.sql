-- ============================================================================
-- 非标设备制造商演示数据
-- 企业模型：非标自动化设备 + 测试仪器 + 工程机械配件
-- 特点：多层级BOM、选配物料、多级部装+总装流程
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_company_id TEXT := 'd8s9bh4f8gm357312pbg';
  v_user_id TEXT := 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc';
  v_location_id TEXT := 'loc_BRMACv8Z8FVDWrRWdVroxE';
  v_now TIMESTAMPTZ := now();
BEGIN
  -- ============================================================================
  -- 1. 工作中心 (Work Centers)
  -- ============================================================================
  INSERT INTO "workCenter" (id, name, description, "laborRate", "machineRate", "overheadRate",
    "defaultStandardFactor", "locationId", "companyId", "createdBy", "createdAt", active)
  VALUES
    ('wc-cnc-001', 'CNC加工中心', '五轴CNC加工设备，用于精密零件加工', 80.00, 150.00, 30.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true),
    ('wc-weld-001', '焊接工位', 'MIG/TIG焊接设备，用于结构件焊接', 60.00, 80.00, 20.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true),
    ('wc-assy-001', '装配车间A', '机械装配区，用于部装和总装', 70.00, 0.00, 25.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true),
    ('wc-assy-002', '装配车间B', '电气装配区，用于电控柜装配', 75.00, 0.00, 25.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true),
    ('wc-test-001', '测试中心', '设备调试和性能测试', 90.00, 50.00, 35.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true),
    ('wc-paint-001', '喷涂车间', '表面处理和喷涂', 50.00, 60.00, 20.00, 'Hours/Piece', v_location_id, v_company_id, v_user_id, v_now, true)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 2. 工序定义 (Processes)
  -- ============================================================================
  INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", "completeAllOnScan", active)
  VALUES
    ('proc-cnc', 'CNC加工', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-weld', '焊接', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-mech-assy', '机械装配', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-elec-assy', '电气装配', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-test', '测试调试', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-paint', '喷涂', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true),
    ('proc-inspect', '检验', 'Hours/Piece', v_company_id, v_user_id, v_now, 'Inside', false, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
  VALUES
    ('wc-cnc-001', 'proc-cnc', v_company_id, v_user_id, v_now),
    ('wc-weld-001', 'proc-weld', v_company_id, v_user_id, v_now),
    ('wc-assy-001', 'proc-mech-assy', v_company_id, v_user_id, v_now),
    ('wc-assy-002', 'proc-elec-assy', v_company_id, v_user_id, v_now),
    ('wc-test-001', 'proc-test', v_company_id, v_user_id, v_now),
    ('wc-paint-001', 'proc-paint', v_company_id, v_user_id, v_now),
    ('wc-test-001', 'proc-inspect', v_company_id, v_user_id, v_now)
  ON CONFLICT ("workCenterId", "processId") DO NOTHING;

  -- ============================================================================
  -- 3. 物料主数据 (Items)
  -- ============================================================================
  -- 3.1 原材料 (Raw Materials)
  INSERT INTO item (id, "readableId", name, description, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES
    ('item-steel-plate-10', 'RM-STL-010', '钢板10mm', 'Q235B热轧钢板，厚度10mm', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-steel-plate-20', 'RM-STL-020', '钢板20mm', 'Q235B热轧钢板，厚度20mm', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-aluminum-6061', 'RM-ALU-6061', '铝合金6061-T6', '铝合金型材6061-T6', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-steel-tube-50', 'RM-TUBE-050', '方管50x50x3', '碳钢方管50x50x3mm', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-welding-wire', 'RM-WELD-001', '焊丝ER50-6', 'CO2气体保护焊丝，直径1.2mm', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-paint-ral7035', 'RM-PNT-7035', '工业漆RAL7035', '浅灰色工业漆，RAL7035', 'EA', 'Material', 'Buy', 'Batch', v_company_id, v_user_id, v_now, true, false, 'Specified')
  ON CONFLICT (id) DO NOTHING;

  -- 3.2 标准件和外购件 (Purchased Parts) - 含选配物料
  INSERT INTO item (id, "readableId", name, description, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES
    -- 电机（选配物料：3选1）
    ('item-motor-servomax', 'PM-MOT-SM1', '伺服电机ServoMax 1kW', 'ServoMax品牌伺服电机，1kW，带编码器', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-motor-yaskawa', 'PM-MOT-YK1', '伺服电机安川 1kW', '安川品牌伺服电机，1kW，带编码器', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-motor-siemens', 'PM-MOT-SI1', '伺服电机西门子 1kW', '西门子品牌伺服电机，1kW，带编码器', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    -- 传感器（选配物料：3选1）
    ('item-sensor-keyence', 'PM-SEN-KY1', '光电传感器基恩士', '基恩士品牌光电传感器，NPN输出', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-sensor-sick', 'PM-SEN-SK1', '光电传感器SICK', 'SICK品牌光电传感器，PNP输出', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-sensor-omron', 'PM-SEN-OM1', '光电传感器欧姆龙', '欧姆龙品牌光电传感器，NPN输出', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    -- PLC（选配物料：3选1）
    ('item-plc-siemens-s7', 'PM-PLC-SI7', 'PLC西门子S7-1200', '西门子S7-1200系列PLC，CPU 1214C', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-plc-mitsubishi', 'PM-PLC-MX3', 'PLC三菱FX3U', '三菱FX3U系列PLC，32点', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-plc-ab', 'PM-PLC-AB5', 'PLC罗克韦尔CompactLogix', '罗克韦尔CompactLogix系列PLC', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    -- 机械标准件
    ('item-bearing-6205', 'PM-BRG-6205', '深沟球轴承6205', 'SKF深沟球轴承6205-2Z', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-bearing-6208', 'PM-BRG-6208', '深沟球轴承6208', 'SKF深沟球轴承6208-2Z', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-bolt-m10x30', 'PM-BLT-M10', '螺栓M10x30', '内六角螺栓M10x30，8.8级', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-bolt-m12x40', 'PM-BLT-M12', '螺栓M12x40', '内六角螺栓M12x40，8.8级', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-nut-m10', 'PM-NUT-M10', '螺母M10', '法兰螺母M10，8级', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    -- 液压元件
    ('item-hydraulic-pump', 'PM-HYD-P01', '液压泵', 'Rexroth液压泵，排量10ml/r', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-hydraulic-cylinder', 'PM-HYD-C01', '液压缸', '液压缸，缸径50mm，行程200mm', 'EA', 'Part', 'Buy', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-hydraulic-valve', 'PM-HYD-V01', '液压阀', '电磁换向阀，4/3中位机能', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    -- 电气元件
    ('item-circuit-breaker', 'PM-ELC-CB1', '断路器', '施耐德断路器，3P 32A', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-contactor', 'PM-ELC-CT1', '接触器', '施耐德接触器，3P 25A', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-power-supply', 'PM-ELC-PS1', '开关电源', '明纬开关电源，24V 10A', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified'),
    ('item-cable-2x15', 'PM-ELC-CB2', '电缆2x1.5mm2', '控制电缆，2芯1.5mm2', 'EA', 'Part', 'Buy', 'Inventory', v_company_id, v_user_id, v_now, true, false, 'Specified')
  ON CONFLICT (id) DO NOTHING;

  -- 3.3 半成品/部件 (Sub-assemblies)
  INSERT INTO item (id, "readableId", name, description, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES
    -- Level 3 组件
    ('item-shaft-assembly', 'SA-SHF-001', '主轴组件', '精密主轴组件，含轴承和密封', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-gearbox-housing', 'SA-GBX-001', '齿轮箱壳体', '铸铁齿轮箱壳体，精加工', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-control-panel', 'SA-CTL-001', '控制面板', '操作控制面板，含按钮和显示', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-wiring-harness', 'SA-WRH-001', '线束组件', '设备内部线束组件', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    -- Level 2 部装
    ('item-base-frame', 'SA-FRM-001', '底座框架', '焊接底座框架，含喷涂', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-electrical-cabinet', 'SA-ELC-001', '电控柜', '电气控制柜，含PLC和电气元件', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-hydraulic-station', 'SA-HYD-001', '液压站', '液压动力站，含泵、阀和油箱', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-drive-unit', 'SA-DRV-001', '驱动单元', '伺服驱动单元，含电机和减速机', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    -- Level 1 总成
    ('item-motion-system', 'SA-MOT-001', '运动系统', '直线运动系统，含导轨和驱动', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified')
  ON CONFLICT (id) DO NOTHING;

  -- 3.4 成品 (Finished Products)
  INSERT INTO item (id, "readableId", name, description, "unitOfMeasureCode", type, "replenishmentSystem", "itemTrackingType", "companyId", "createdBy", "createdAt", active, "requiresInspection", "sourcingType")
  VALUES
    ('item-auto-assembly-line', 'FP-AAL-001', '自动化装配线', '全自动装配线，含6工位和检测', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-auto-welding-station', 'FP-AWS-001', '自动焊接工作站', '机器人焊接工作站，含变位机', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-performance-tester', 'FP-PFT-001', '性能测试仪', '多功能性能测试仪，含数据采集', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-quality-inspector', 'FP-QIN-001', '质量检测机', '视觉质量检测机，含AI识别', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-hydraulic-power-pack', 'FP-HPP-001', '液压动力包', '工程机械液压动力包，20L/min', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified'),
    ('item-control-valve-block', 'FP-CVB-001', '控制阀组', '多路控制阀组，6联阀', 'EA', 'Part', 'Make', 'Serial', v_company_id, v_user_id, v_now, true, true, 'Specified')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 4. 客户
  -- ============================================================================
  INSERT INTO customer (id, name, "companyId", "createdBy", "createdAt", "customerStatusId")
  VALUES
    ('cust-001', '上海汽车制造有限公司', v_company_id, v_user_id, v_now, 'cs_WdFpSwWWrqHkERziKg8t2V'),
    ('cust-002', '三一重工股份有限公司', v_company_id, v_user_id, v_now, 'cs_WdFpSwWWrqHkERziKg8t2V'),
    ('cust-003', '中车株洲电力机车有限公司', v_company_id, v_user_id, v_now, 'cs_WdFpSwWWrqHkERziKg8t2V')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 5. 多层级BOM (Bill of Materials)
  -- ============================================================================

  -- 5.1 自动化装配线 BOM (Level 0 - 总装)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-auto-assembly-line', 'item-auto-assembly-line', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-aal-001', 'mm-auto-assembly-line', 'item-base-frame', 1, 'Make to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-aal-002', 'mm-auto-assembly-line', 'item-motion-system', 2, 'Make to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-aal-003', 'mm-auto-assembly-line', 'item-electrical-cabinet', 1, 'Make to Order', 'EA', 30, v_company_id, v_user_id, v_now),
    ('mml-aal-004', 'mm-auto-assembly-line', 'item-control-panel', 1, 'Make to Order', 'EA', 40, v_company_id, v_user_id, v_now),
    ('mml-aal-005', 'mm-auto-assembly-line', 'item-bolt-m12x40', 48, 'Purchase to Order', 'EA', 50, v_company_id, v_user_id, v_now),
    ('mml-aal-006', 'mm-auto-assembly-line', 'item-paint-ral7035', 5, 'Purchase to Order', 'EA', 60, v_company_id, v_user_id, v_now);

  -- 5.2 底座框架 BOM (Level 1 - 部装)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-base-frame', 'item-base-frame', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-bf-001', 'mm-base-frame', 'item-steel-plate-20', 150, 'Purchase to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-bf-002', 'mm-base-frame', 'item-steel-tube-50', 12, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-bf-003', 'mm-base-frame', 'item-welding-wire', 5, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now),
    ('mml-bf-004', 'mm-base-frame', 'item-bolt-m10x30', 24, 'Purchase to Order', 'EA', 40, v_company_id, v_user_id, v_now);

  -- 5.3 运动系统 BOM (Level 1 - 部装) - 含选配电机
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-motion-system', 'item-motion-system', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-ms-001', 'mm-motion-system', 'item-drive-unit', 1, 'Make to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-ms-002', 'mm-motion-system', 'item-shaft-assembly', 2, 'Make to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    -- 选配物料：电机（3选1，实际只选其一）
    ('mml-ms-003', 'mm-motion-system', 'item-motor-servomax', 1, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now),
    ('mml-ms-004', 'mm-motion-system', 'item-motor-yaskawa', 1, 'Purchase to Order', 'EA', 31, v_company_id, v_user_id, v_now),
    ('mml-ms-005', 'mm-motion-system', 'item-motor-siemens', 1, 'Purchase to Order', 'EA', 32, v_company_id, v_user_id, v_now),
    -- 标准件
    ('mml-ms-006', 'mm-motion-system', 'item-bearing-6208', 4, 'Purchase to Order', 'EA', 40, v_company_id, v_user_id, v_now),
    ('mml-ms-007', 'mm-motion-system', 'item-bolt-m10x30', 16, 'Purchase to Order', 'EA', 50, v_company_id, v_user_id, v_now);

  -- 5.4 驱动单元 BOM (Level 2 - 组件)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-drive-unit', 'item-drive-unit', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-du-001', 'mm-drive-unit', 'item-gearbox-housing', 1, 'Make to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-du-002', 'mm-drive-unit', 'item-bearing-6205', 2, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-du-003', 'mm-drive-unit', 'item-bolt-m10x30', 8, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now);

  -- 5.5 主轴组件 BOM (Level 2 - 组件)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-shaft-assembly', 'item-shaft-assembly', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-sa-001', 'mm-shaft-assembly', 'item-aluminum-6061', 3, 'Purchase to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-sa-002', 'mm-shaft-assembly', 'item-bearing-6205', 2, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-sa-003', 'mm-shaft-assembly', 'item-bolt-m10x30', 4, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now);

  -- 5.6 齿轮箱壳体 BOM (Level 3 - 零件)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-gearbox-housing', 'item-gearbox-housing', 1, 'Active', v_company_id, v_user_id, v_now)
  ON CONFLICT ("itemId", version) DO NOTHING;

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-gh-001', 'mm-gearbox-housing', 'item-steel-plate-20', 8, 'Purchase to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-gh-002', 'mm-gearbox-housing', 'item-welding-wire', 2, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now);

  -- 5.7 电控柜 BOM (Level 1 - 部装) - 含选配PLC和传感器
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-electrical-cabinet', 'item-electrical-cabinet', 1, 'Active', v_company_id, v_user_id, v_now);

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-ec-001', 'mm-electrical-cabinet', 'item-wiring-harness', 1, 'Make to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    -- 选配物料：PLC（3选1）
    ('mml-ec-002', 'mm-electrical-cabinet', 'item-plc-siemens-s7', 1, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-ec-003', 'mm-electrical-cabinet', 'item-plc-mitsubishi', 1, 'Purchase to Order', 'EA', 21, v_company_id, v_user_id, v_now),
    ('mml-ec-004', 'mm-electrical-cabinet', 'item-plc-ab', 1, 'Purchase to Order', 'EA', 22, v_company_id, v_user_id, v_now),
    -- 电气元件
    ('mml-ec-005', 'mm-electrical-cabinet', 'item-circuit-breaker', 3, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now),
    ('mml-ec-006', 'mm-electrical-cabinet', 'item-contactor', 4, 'Purchase to Order', 'EA', 40, v_company_id, v_user_id, v_now),
    ('mml-ec-007', 'mm-electrical-cabinet', 'item-power-supply', 1, 'Purchase to Order', 'EA', 50, v_company_id, v_user_id, v_now),
    ('mml-ec-008', 'mm-electrical-cabinet', 'item-cable-2x15', 25, 'Purchase to Order', 'EA', 60, v_company_id, v_user_id, v_now);

  -- 5.8 线束组件 BOM (Level 2 - 组件) - 含选配传感器
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-wiring-harness', 'item-wiring-harness', 1, 'Active', v_company_id, v_user_id, v_now);

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-wh-001', 'mm-wiring-harness', 'item-cable-2x15', 50, 'Purchase to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    -- 选配物料：传感器（3选1，每种需要4个）
    ('mml-wh-002', 'mm-wiring-harness', 'item-sensor-keyence', 4, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-wh-003', 'mm-wiring-harness', 'item-sensor-sick', 4, 'Purchase to Order', 'EA', 21, v_company_id, v_user_id, v_now),
    ('mml-wh-004', 'mm-wiring-harness', 'item-sensor-omron', 4, 'Purchase to Order', 'EA', 22, v_company_id, v_user_id, v_now);

  -- 5.9 控制面板 BOM (Level 1 - 部装)
  INSERT INTO "makeMethod" (id, "itemId", version, status, "companyId", "createdBy", "createdAt")
  VALUES ('mm-control-panel', 'item-control-panel', 1, 'Active', v_company_id, v_user_id, v_now);

  INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", quantity, "methodType", "unitOfMeasureCode", "order", "companyId", "createdBy", "createdAt")
  VALUES
    ('mml-cp-001', 'mm-control-panel', 'item-aluminum-6061', 3, 'Purchase to Order', 'EA', 10, v_company_id, v_user_id, v_now),
    ('mml-cp-002', 'mm-control-panel', 'item-cable-2x15', 8, 'Purchase to Order', 'EA', 20, v_company_id, v_user_id, v_now),
    ('mml-cp-003', 'mm-control-panel', 'item-bolt-m10x30', 6, 'Purchase to Order', 'EA', 30, v_company_id, v_user_id, v_now);

  -- ============================================================================
  -- 6. 工艺路线 (Routing / Method Operations)
  -- ============================================================================
  INSERT INTO "methodOperation" (id, "makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "runTime", "runUnit", "companyId", "createdBy", "createdAt")
  VALUES
    -- 自动化装配线工艺路线 (7道工序)
    ('mo-aal-010', 'mm-auto-assembly-line', 10, 'proc-mech-assy', 'wc-assy-001', '底座框架装配', 2, 'Total Hours', 8, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-020', 'mm-auto-assembly-line', 20, 'proc-mech-assy', 'wc-assy-001', '运动系统安装（2套）', 1, 'Total Hours', 12, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-030', 'mm-auto-assembly-line', 30, 'proc-elec-assy', 'wc-assy-002', '电控柜安装和接线', 1, 'Total Hours', 16, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-040', 'mm-auto-assembly-line', 40, 'proc-mech-assy', 'wc-assy-001', '控制面板安装', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-050', 'mm-auto-assembly-line', 50, 'proc-paint', 'wc-paint-001', '整体喷涂', 1, 'Total Hours', 6, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-060', 'mm-auto-assembly-line', 60, 'proc-test', 'wc-test-001', '整机调试和测试', 2, 'Total Hours', 24, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-aal-070', 'mm-auto-assembly-line', 70, 'proc-inspect', 'wc-test-001', '最终检验', 0, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 底座框架工艺路线 (5道工序)
    ('mo-bf-010', 'mm-base-frame', 10, 'proc-cnc', 'wc-cnc-001', '钢板下料和切割', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-bf-020', 'mm-base-frame', 20, 'proc-weld', 'wc-weld-001', '框架焊接', 2, 'Total Hours', 8, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-bf-030', 'mm-base-frame', 30, 'proc-cnc', 'wc-cnc-001', '焊接后加工（铣平面、钻孔）', 1, 'Total Hours', 3, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-bf-040', 'mm-base-frame', 40, 'proc-paint', 'wc-paint-001', '表面处理和喷涂', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-bf-050', 'mm-base-frame', 50, 'proc-inspect', 'wc-test-001', '尺寸检验', 0, 'Total Hours', 1, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 运动系统工艺路线 (4道工序)
    ('mo-ms-010', 'mm-motion-system', 10, 'proc-mech-assy', 'wc-assy-001', '驱动单元装配', 1, 'Total Hours', 6, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ms-020', 'mm-motion-system', 20, 'proc-mech-assy', 'wc-assy-001', '主轴组件安装', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ms-030', 'mm-motion-system', 30, 'proc-mech-assy', 'wc-assy-001', '电机安装和对中', 1, 'Total Hours', 3, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ms-040', 'mm-motion-system', 40, 'proc-test', 'wc-test-001', '运动测试和校准', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 驱动单元工艺路线 (4道工序)
    ('mo-du-010', 'mm-drive-unit', 10, 'proc-cnc', 'wc-cnc-001', '齿轮箱壳体加工', 2, 'Total Hours', 6, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-du-020', 'mm-drive-unit', 20, 'proc-mech-assy', 'wc-assy-001', '轴承压装', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-du-030', 'mm-drive-unit', 30, 'proc-mech-assy', 'wc-assy-001', '齿轮和轴装配', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-du-040', 'mm-drive-unit', 40, 'proc-inspect', 'wc-test-001', '齿轮箱检验', 0, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 主轴组件工艺路线 (3道工序)
    ('mo-sa-010', 'mm-shaft-assembly', 10, 'proc-cnc', 'wc-cnc-001', '主轴精加工', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-sa-020', 'mm-shaft-assembly', 20, 'proc-mech-assy', 'wc-assy-001', '轴承安装', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-sa-030', 'mm-shaft-assembly', 30, 'proc-inspect', 'wc-test-001', '动平衡测试', 0, 'Total Hours', 1, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 齿轮箱壳体工艺路线 (4道工序)
    ('mo-gh-010', 'mm-gearbox-housing', 10, 'proc-cnc', 'wc-cnc-001', '钢板下料', 1, 'Total Hours', 1, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-gh-020', 'mm-gearbox-housing', 20, 'proc-weld', 'wc-weld-001', '焊接成型', 1, 'Total Hours', 3, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-gh-030', 'mm-gearbox-housing', 30, 'proc-cnc', 'wc-cnc-001', '精加工（镗孔、铣面）', 2, 'Total Hours', 5, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-gh-040', 'mm-gearbox-housing', 40, 'proc-inspect', 'wc-test-001', '尺寸检验', 0, 'Total Hours', 1, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 电控柜工艺路线 (4道工序)
    ('mo-ec-010', 'mm-electrical-cabinet', 10, 'proc-elec-assy', 'wc-assy-002', '电气元件安装', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ec-020', 'mm-electrical-cabinet', 20, 'proc-elec-assy', 'wc-assy-002', 'PLC安装和配置', 2, 'Total Hours', 6, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ec-030', 'mm-electrical-cabinet', 30, 'proc-elec-assy', 'wc-assy-002', '线束布线和接线', 1, 'Total Hours', 8, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-ec-040', 'mm-electrical-cabinet', 40, 'proc-test', 'wc-test-001', '电气测试', 1, 'Total Hours', 4, 'Hours/Piece', v_company_id, v_user_id, v_now),
    -- 线束组件工艺路线 (4道工序)
    ('mo-wh-010', 'mm-wiring-harness', 10, 'proc-elec-assy', 'wc-assy-002', '电缆裁剪和剥线', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-wh-020', 'mm-wiring-harness', 20, 'proc-elec-assy', 'wc-assy-002', '端子压接', 1, 'Total Hours', 3, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-wh-030', 'mm-wiring-harness', 30, 'proc-elec-assy', 'wc-assy-002', '传感器安装和接线', 1, 'Total Hours', 2, 'Hours/Piece', v_company_id, v_user_id, v_now),
    ('mo-wh-040', 'mm-wiring-harness', 40, 'proc-inspect', 'wc-test-001', '导通测试', 0, 'Total Hours', 1, 'Hours/Piece', v_company_id, v_user_id, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 7. 生产工单 (Jobs)
  -- ============================================================================
  INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status, quantity, "scrapQuantity", "quantityComplete", "quantityShipped", "quantityReceivedToInventory", "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
  VALUES
    ('job-aal-001', 'WO-2026-0001', 'item-auto-assembly-line', 'EA', v_location_id, 'In Progress', 1, 0, 0, 0, 0, CURRENT_DATE + INTERVAL '45 days', 'Hard Deadline', v_company_id, v_user_id, v_now, 1),
    ('job-pft-001', 'WO-2026-0002', 'item-performance-tester', 'EA', v_location_id, 'Ready', 2, 0, 0, 0, 0, CURRENT_DATE + INTERVAL '30 days', 'Soft Deadline', v_company_id, v_user_id, v_now, 2),
    ('job-hpp-001', 'WO-2026-0003', 'item-hydraulic-power-pack', 'EA', v_location_id, 'Completed', 3, 0, 3, 3, 3, CURRENT_DATE - INTERVAL '10 days', 'ASAP', v_company_id, v_user_id, v_now, 1)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 8. 销售订单 (Sales Orders)
  -- ============================================================================
  INSERT INTO "salesOrder" (id, "salesOrderId", "customerId", "orderDate", "dueDate", status, "companyId", "createdBy", "createdAt")
  VALUES
    ('so-001', 'SO-2026-0001', 'cust-001', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '40 days', 'Open', v_company_id, v_user_id, v_now),
    ('so-002', 'SO-2026-0002', 'cust-002', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '25 days', 'Open', v_company_id, v_user_id, v_now),
    ('so-003', 'SO-2026-0003', 'cust-003', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '5 days', 'Completed', v_company_id, v_user_id, v_now)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "salesOrderLine" (id, "salesOrderId", "itemId", "lineNumber", quantity, "unitPrice", "companyId", "createdBy", "createdAt")
  VALUES
    ('sol-001-01', 'so-001', 'item-auto-assembly-line', 1, 1, 850000.00, v_company_id, v_user_id, v_now),
    ('sol-002-01', 'so-002', 'item-performance-tester', 1, 2, 125000.00, v_company_id, v_user_id, v_now),
    ('sol-003-01', 'so-003', 'item-hydraulic-power-pack', 1, 3, 45000.00, v_company_id, v_user_id, v_now)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 9. 库存记录 (Inventory)
  -- ============================================================================
  INSERT INTO inventory (id, "itemId", "locationId", quantity, "companyId", "createdBy", "createdAt")
  VALUES
    ('inv-001', 'item-steel-plate-10', v_location_id, 500, v_company_id, v_user_id, v_now),
    ('inv-002', 'item-steel-plate-20', v_location_id, 300, v_company_id, v_user_id, v_now),
    ('inv-003', 'item-aluminum-6061', v_location_id, 200, v_company_id, v_user_id, v_now),
    ('inv-004', 'item-steel-tube-50', v_location_id, 150, v_company_id, v_user_id, v_now),
    ('inv-005', 'item-bearing-6205', v_location_id, 100, v_company_id, v_user_id, v_now),
    ('inv-006', 'item-bearing-6208', v_location_id, 80, v_company_id, v_user_id, v_now),
    ('inv-007', 'item-bolt-m10x30', v_location_id, 500, v_company_id, v_user_id, v_now),
    ('inv-008', 'item-bolt-m12x40', v_location_id, 300, v_company_id, v_user_id, v_now)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE '非标设备制造商演示数据创建完成！';
END
$$;

COMMIT;

-- ============================================================================
-- 数据汇总
-- ============================================================================
SELECT '演示数据创建完成！' as message;
SELECT
  (SELECT count(*) FROM "workCenter") as "工作中心数量",
  (SELECT count(*) FROM process) as "工序数量",
  (SELECT count(*) FROM item) as "物料总数",
  (SELECT count(*) FROM "makeMethod") as "BOM数量",
  (SELECT count(*) FROM "methodMaterial") as "BOM行数",
  (SELECT count(*) FROM "methodOperation") as "工艺路线数",
  (SELECT count(*) FROM job) as "工单数量",
  (SELECT count(*) FROM "salesOrder") as "销售订单数";
