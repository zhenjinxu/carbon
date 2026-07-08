-- ============================================================================
-- ASM-TOP-001 生产执行数据种子脚本
-- 生产数量：10套精密减速电机总成
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. 创建工作中心 (Work Centers)
-- ============================================================================
INSERT INTO "workCenter" (id, name, "companyId", "createdBy", "createdAt", active, "laborRate", "machineRate", "overheadRate")
VALUES
  ('wc-machining', '机加工中心', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), true, 50.00, 80.00, 20.00),
  ('wc-assembly-a', '装配车间A', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), true, 40.00, 30.00, 15.00),
  ('wc-assembly-b', '装配车间B', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), true, 45.00, 35.00, 18.00),
  ('wc-testing', '测试中心', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), true, 60.00, 100.00, 25.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. 创建工序 (Processes)
-- ============================================================================
INSERT INTO process (id, name, "defaultStandardFactor", "companyId", "createdBy", "createdAt", "processType", active)
VALUES
  ('proc-machining', '机加工', 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 'Inside', true),
  ('proc-assembly', '装配', 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 'Inside', true),
  ('proc-testing', '测试', 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 'Inside', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. 创建工作中心与工序关联
-- ============================================================================
INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy", "createdAt")
VALUES
  ('wc-machining', 'proc-machining', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('wc-assembly-a', 'proc-assembly', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('wc-assembly-b', 'proc-assembly', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('wc-testing', 'proc-testing', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT ("workCenterId", "processId") DO NOTHING;

-- ============================================================================
-- 4. 创建工艺路线 (Method Operations)
-- ============================================================================

-- ASM-TOP-001 工艺路线
INSERT INTO "methodOperation" (id, "makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
VALUES
  ('mo-top-001-01', 'make_3xyNWozcLpEG3ARx7CQEUD', 10, 'proc-assembly', 'wc-assembly-a', '齿轮箱组件装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-top-001-02', 'make_3xyNWozcLpEG3ARx7CQEUD', 20, 'proc-assembly', 'wc-assembly-b', '电路板组件装配', 0.3, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-top-001-03', 'make_3xyNWozcLpEG3ARx7CQEUD', 30, 'proc-assembly', 'wc-assembly-a', '总装：电机组件与齿轮箱组装', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-top-001-04', 'make_3xyNWozcLpEG3ARx7CQEUD', 40, 'proc-assembly', 'wc-assembly-b', '总装：电路板与机械组件集成', 0.8, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-top-001-05', 'make_3xyNWozcLpEG3ARx7CQEUD', 50, 'proc-testing', 'wc-testing', '性能测试与质检', 0.2, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- ASM-SUB-A 工艺路线
INSERT INTO "methodOperation" (id, "makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
VALUES
  ('mo-sub-a-01', 'make_6GkY1j4mnxUTxji9xknVg1', 10, 'proc-machining', 'wc-machining', '箱体铸件加工', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-sub-a-02', 'make_6GkY1j4mnxUTxji9xknVg1', 20, 'proc-assembly', 'wc-assembly-a', '轴承与齿轮装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-sub-a-03', 'make_6GkY1j4mnxUTxji9xknVg1', 30, 'proc-testing', 'wc-testing', '齿轮箱测试', 0.3, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- ASM-SUB-B 工艺路线
INSERT INTO "methodOperation" (id, "makeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "companyId", "createdBy", "createdAt")
VALUES
  ('mo-sub-b-01', 'make_HJxntUXayK6QwUbfNXkxZH', 10, 'proc-assembly', 'wc-assembly-b', '电路板焊接与组装', 0.5, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('mo-sub-b-02', 'make_HJxntUXayK6QwUbfNXkxZH', 20, 'proc-testing', 'wc-testing', '电路板功能测试', 0.2, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. 创建生产工单 (Jobs) - 生产 10 套 ASM-TOP-001
-- ============================================================================

-- 主工单：ASM-TOP-001
INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status, quantity, "scrapQuantity", "quantityComplete", "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
VALUES
  ('job-asm-top-001', 'WO-2026-0010', 'item_8BxuUHr5h2Xtzah2MyTEUv', 'EA', 'loc_BRMACv8Z8FVDWrRWdVroxE', 'Ready', 10, 0, 0, CURRENT_DATE + INTERVAL '30 days', 'Hard Deadline', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- 子工单：ASM-SUB-A (齿轮箱组件) - 需要 10 套
INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status, quantity, "scrapQuantity", "quantityComplete", "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
VALUES
  ('job-asm-sub-a', 'WO-2026-0011', 'item_DLVeTheo2MmZPFdtUi3xwj', 'EA', 'loc_BRMACv8Z8FVDWrRWdVroxE', 'Ready', 10, 0, 0, CURRENT_DATE + INTERVAL '20 days', 'Hard Deadline', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 2)
ON CONFLICT (id) DO NOTHING;

-- 子工单：ASM-SUB-B (电路板组件) - 需要 10 套
INSERT INTO job (id, "jobId", "itemId", "unitOfMeasureCode", "locationId", status, quantity, "scrapQuantity", "quantityComplete", "dueDate", "deadlineType", "companyId", "createdBy", "createdAt", priority)
VALUES
  ('job-asm-sub-b', 'WO-2026-0012', 'item_XLFUVBzfNMwyRi9V3hP7sV', 'EA', 'loc_BRMACv8Z8FVDWrRWdVroxE', 'Ready', 10, 0, 0, CURRENT_DATE + INTERVAL '20 days', 'Hard Deadline', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 2)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 6. 创建工单工艺路线 (Job Make Methods)
-- ============================================================================

-- 主工单的工艺路线
INSERT INTO "jobMakeMethod" (id, "jobId", "itemId", "quantityPerParent", "companyId", "createdBy", "createdAt", version)
VALUES
  ('jmm-asm-top-001', 'job-asm-top-001', 'item_8BxuUHr5h2Xtzah2MyTEUv', 1, 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-A 的工艺路线
INSERT INTO "jobMakeMethod" (id, "jobId", "itemId", "quantityPerParent", "companyId", "createdBy", "createdAt", version)
VALUES
  ('jmm-asm-sub-a', 'job-asm-sub-a', 'item_DLVeTheo2MmZPFdtUi3xwj', 1, 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-B 的工艺路线
INSERT INTO "jobMakeMethod" (id, "jobId", "itemId", "quantityPerParent", "companyId", "createdBy", "createdAt", version)
VALUES
  ('jmm-asm-sub-b', 'job-asm-sub-b', 'item_XLFUVBzfNMwyRi9V3hP7sV', 1, 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 7. 创建工单物料清单 (Job Materials)
-- ============================================================================

-- 主工单 ASM-TOP-001 的物料清单
INSERT INTO "jobMaterial" (id, "jobId", "jobMakeMethodId", "itemId", "itemType", quantity, "unitOfMeasureCode", "methodType", "order", description, "companyId", "createdBy", "createdAt")
VALUES
  ('jm-top-001-01', 'job-asm-top-001', 'jmm-asm-top-001', 'item_DLVeTheo2MmZPFdtUi3xwj', 'Part', 10, 'EA', 'Make to Order', 10, '齿轮箱组件', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-top-001-02', 'job-asm-top-001', 'jmm-asm-top-001', 'item_XLFUVBzfNMwyRi9V3hP7sV', 'Part', 10, 'EA', 'Make to Order', 20, '电路板组件', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-top-001-03', 'job-asm-top-001', 'jmm-asm-top-001', 'item_MJaLAZ85iNz2gNbPr3an1n', 'Part', 10, 'EA', 'Make to Order', 30, '电机定子', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-top-001-04', 'job-asm-top-001', 'jmm-asm-top-001', 'item_2E6mMuEo1uNaphNpmA2G39', 'Part', 10, 'EA', 'Make to Order', 40, '电机转子', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-A 的物料清单
INSERT INTO "jobMaterial" (id, "jobId", "jobMakeMethodId", "itemId", "itemType", quantity, "unitOfMeasureCode", "methodType", "order", description, "companyId", "createdBy", "createdAt")
VALUES
  ('jm-sub-a-01', 'job-asm-sub-a', 'jmm-asm-sub-a', 'item_51WgNyHZZzmCFepJRhsLCh', 'Part', 40, 'EA', 'Make to Order', 10, '深沟球轴承', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-sub-a-02', 'job-asm-sub-a', 'jmm-asm-sub-a', 'item_2A39jLAzrHyqrDSbXJrq78', 'Part', 20, 'EA', 'Make to Order', 20, '传动齿轮', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-sub-a-03', 'job-asm-sub-a', 'jmm-asm-sub-a', 'item_4sXc4Auh9guoq84pb4maxb', 'Part', 10, 'EA', 'Make to Order', 30, '箱体铸件', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-B 的物料清单
INSERT INTO "jobMaterial" (id, "jobId", "jobMakeMethodId", "itemId", "itemType", quantity, "unitOfMeasureCode", "methodType", "order", description, "companyId", "createdBy", "createdAt")
VALUES
  ('jm-sub-b-01', 'job-asm-sub-b', 'jmm-asm-sub-b', 'item_Pd2G5L4oJXAHzzXJ6Z75aN', 'Part', 10, 'EA', 'Make to Order', 10, '控制芯片', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jm-sub-b-02', 'job-asm-sub-b', 'jmm-asm-sub-b', 'item_UsDsxgH9ztzSuM7ZFmQA33', 'Part', 60, 'EA', 'Make to Order', 20, '电容阵列', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. 创建工单工序 (Job Operations)
-- ============================================================================

-- 主工单 ASM-TOP-001 的工序
INSERT INTO "jobOperation" (id, "jobId", "jobMakeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", status, "companyId", "createdBy", "createdAt")
VALUES
  ('jo-top-001-01', 'job-asm-top-001', 'jmm-asm-top-001', 10, 'proc-assembly', 'wc-assembly-a', '齿轮箱组件装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-top-001-02', 'job-asm-top-001', 'jmm-asm-top-001', 20, 'proc-assembly', 'wc-assembly-b', '电路板组件装配', 0.3, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-top-001-03', 'job-asm-top-001', 'jmm-asm-top-001', 30, 'proc-assembly', 'wc-assembly-a', '总装：电机组件与齿轮箱组装', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-top-001-04', 'job-asm-top-001', 'jmm-asm-top-001', 40, 'proc-assembly', 'wc-assembly-b', '总装：电路板与机械组件集成', 0.8, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-top-001-05', 'job-asm-top-001', 'jmm-asm-top-001', 50, 'proc-testing', 'wc-testing', '性能测试与质检', 0.2, 'Total Hours', 1.5, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-A 的工序
INSERT INTO "jobOperation" (id, "jobId", "jobMakeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", status, "companyId", "createdBy", "createdAt")
VALUES
  ('jo-sub-a-01', 'job-asm-sub-a', 'jmm-asm-sub-a', 10, 'proc-machining', 'wc-machining', '箱体铸件加工', 1.0, 'Total Hours', 3.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-sub-a-02', 'job-asm-sub-a', 'jmm-asm-sub-a', 20, 'proc-assembly', 'wc-assembly-a', '轴承与齿轮装配', 0.5, 'Total Hours', 2.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-sub-a-03', 'job-asm-sub-a', 'jmm-asm-sub-a', 30, 'proc-testing', 'wc-testing', '齿轮箱测试', 0.3, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- 子工单 ASM-SUB-B 的工序
INSERT INTO "jobOperation" (id, "jobId", "jobMakeMethodId", "order", "processId", "workCenterId", description, "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", status, "companyId", "createdBy", "createdAt")
VALUES
  ('jo-sub-b-01', 'job-asm-sub-b', 'jmm-asm-sub-b', 10, 'proc-assembly', 'wc-assembly-b', '电路板焊接与组装', 0.5, 'Total Hours', 2.5, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW()),
  ('jo-sub-b-02', 'job-asm-sub-b', 'jmm-asm-sub-b', 20, 'proc-testing', 'wc-testing', '电路板功能测试', 0.2, 'Total Hours', 1.0, 'Hours/Piece', 0, 'Hours/Piece', 'Ready', 'd8s9bh4f8gm357312pbg', 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. 创建工序依赖关系
-- ============================================================================

-- 主工单工序依赖
INSERT INTO "jobOperationDependency" ("operationId", "dependsOnId", "jobId", "companyId", "createdAt")
VALUES
  ('jo-top-001-02', 'jo-top-001-01', 'job-asm-top-001', 'd8s9bh4f8gm357312pbg', NOW()),
  ('jo-top-001-03', 'jo-top-001-01', 'job-asm-top-001', 'd8s9bh4f8gm357312pbg', NOW()),
  ('jo-top-001-03', 'jo-top-001-02', 'job-asm-top-001', 'd8s9bh4f8gm357312pbg', NOW()),
  ('jo-top-001-04', 'jo-top-001-03', 'job-asm-top-001', 'd8s9bh4f8gm357312pbg', NOW()),
  ('jo-top-001-05', 'jo-top-001-04', 'job-asm-top-001', 'd8s9bh4f8gm357312pbg', NOW())
ON CONFLICT ("operationId", "dependsOnId") DO NOTHING;

-- 子工单 ASM-SUB-A 工序依赖
INSERT INTO "jobOperationDependency" ("operationId", "dependsOnId", "jobId", "companyId", "createdAt")
VALUES
  ('jo-sub-a-02', 'jo-sub-a-01', 'job-asm-sub-a', 'd8s9bh4f8gm357312pbg', NOW()),
  ('jo-sub-a-03', 'jo-sub-a-02', 'job-asm-sub-a', 'd8s9bh4f8gm357312pbg', NOW())
ON CONFLICT ("operationId", "dependsOnId") DO NOTHING;

-- 子工单 ASM-SUB-B 工序依赖
INSERT INTO "jobOperationDependency" ("operationId", "dependsOnId", "jobId", "companyId", "createdAt")
VALUES
  ('jo-sub-b-02', 'jo-sub-b-01', 'job-asm-sub-b', 'd8s9bh4f8gm357312pbg', NOW())
ON CONFLICT ("operationId", "dependsOnId") DO NOTHING;

COMMIT;

-- ============================================================================
-- 数据汇总
-- ============================================================================
SELECT '生产执行数据创建完成！' as message;
SELECT
  (SELECT count(*) FROM "workCenter" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工作中心数量",
  (SELECT count(*) FROM process WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工序数量",
  (SELECT count(*) FROM "methodOperation" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工艺路线数",
  (SELECT count(*) FROM job WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工单数量",
  (SELECT count(*) FROM "jobMakeMethod" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工单工艺路线数",
  (SELECT count(*) FROM "jobMaterial" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工单物料数",
  (SELECT count(*) FROM "jobOperation" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工单工序数",
  (SELECT count(*) FROM "jobOperationDependency" WHERE "companyId" = 'd8s9bh4f8gm357312pbg') as "工序依赖数";
