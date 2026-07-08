/**
 * MES asm-top-001 demonstration seed data for Carbon
 *
 * Seeds a complete simplified MES trial-run scenario based on
 * docs/carbon_mes_001.docx:
 *
 *   Product:        asm-top-001 (Serial-tracked Part, Make)
 *   Work Order:     PRO-ASM-TOP-001-100, quantity 100, status Ready
 *   Process Route:  5 operations across 18 equipment-specific job operations
 *
 *   Operations (工艺路线):
 *     1. 零部件预装    → 1 pre-assembly station  (PRE-ASM-01)
 *     2. 自动锁附      → 4 fastening robots      (ROB01–ROB04), 25 each
 *     3. 整机通电调试  → 6 test benches           (TEST01–TEST06), ~17 each
 *     4. 高温老化      → 6 aging cabinets          (AG01–AG06), ~17 each
 *     5. 终检包装      → 1 final inspection station (FI-01)
 *
 *   Procedures:  5 × procedure (V1.0 each) with inspection/SOP steps
 *
 * Called within an existing transaction — do NOT commit or rollback.
 *
 * Usage:
 *   import { seedAsmTop001 } from "./seed-asm-top-001.ts";
 *   await seedAsmTop001(client, { companyId, userId, locationId });
 */

import type { PoolClient } from "pg";

type SeedCtx = {
  companyId: string;
  userId: string;
  locationId: string;
};

// ── Process definitions ──────────────────────────────────────────────────────

const PROCESSES = [
  { name: "零部件预装", factor: "Minutes/Piece" as const },
  { name: "自动锁附", factor: "Minutes/Piece" as const },
  { name: "整机通电调试", factor: "Minutes/Piece" as const },
  { name: "高温老化", factor: "Minutes/Piece" as const },
  { name: "终检包装", factor: "Minutes/Piece" as const }
] as const;

// ── Work center (equipment) definitions ──────────────────────────────────────
// Each work center is linked to exactly one process by index into PROCESSES.

type WorkCenterDef = {
  name: string;
  description: string;
  processIndex: number;
};

const WORK_CENTERS: WorkCenterDef[] = [
  // Op 1: 零部件预装
  { name: "PRE-ASM-01 预装工位", description: "预装工位", processIndex: 0 },

  // Op 2: 自动锁附 — 4 robots
  { name: "ROB01 锁附机器人", description: "锁附机器人 #1", processIndex: 1 },
  { name: "ROB02 锁附机器人", description: "锁附机器人 #2", processIndex: 1 },
  { name: "ROB03 锁附机器人", description: "锁附机器人 #3", processIndex: 1 },
  { name: "ROB04 锁附机器人", description: "锁附机器人 #4", processIndex: 1 },

  // Op 3: 整机通电调试 — 6 test benches
  { name: "TEST01 调试测试台", description: "调试测试台 #1", processIndex: 2 },
  { name: "TEST02 调试测试台", description: "调试测试台 #2", processIndex: 2 },
  { name: "TEST03 调试测试台", description: "调试测试台 #3", processIndex: 2 },
  { name: "TEST04 调试测试台", description: "调试测试台 #4", processIndex: 2 },
  { name: "TEST05 调试测试台", description: "调试测试台 #5", processIndex: 2 },
  { name: "TEST06 调试测试台", description: "调试测试台 #6", processIndex: 2 },

  // Op 4: 高温老化 — 6 aging cabinets
  { name: "AG01 老化柜", description: "老化柜 #1", processIndex: 3 },
  { name: "AG02 老化柜", description: "老化柜 #2", processIndex: 3 },
  { name: "AG03 老化柜", description: "老化柜 #3", processIndex: 3 },
  { name: "AG04 老化柜", description: "老化柜 #4", processIndex: 3 },
  { name: "AG05 老化柜", description: "老化柜 #5", processIndex: 3 },
  { name: "AG06 老化柜", description: "老化柜 #6", processIndex: 3 },

  // Op 5: 终检包装
  { name: "FI-01 终检工位", description: "终检工位", processIndex: 4 }
];

// ── Job operation split per process ──────────────────────────────────────────
// Defines how the 100-unit batch is distributed across equipment per process.
// workCenterOffset is the starting index into WORK_CENTERS for that process.

type OperationSplit = {
  processIndex: number;
  workCenterOffset: number;
  workCenterCount: number;
  quantities: number[]; // Must sum to 100 (or 100 for single-station ops)
  setupMinutes: number;
  laborMinutes: number;
  machineMinutes: number;
};

const OPERATION_SPLITS: OperationSplit[] = [
  {
    processIndex: 0,
    workCenterOffset: 0,
    workCenterCount: 1,
    quantities: [100],
    setupMinutes: 5,
    laborMinutes: 15,
    machineMinutes: 0
  },
  {
    processIndex: 1,
    workCenterOffset: 1,
    workCenterCount: 4,
    quantities: [25, 25, 25, 25],
    setupMinutes: 2,
    laborMinutes: 0,
    machineMinutes: 8
  },
  {
    processIndex: 2,
    workCenterOffset: 5,
    workCenterCount: 6,
    quantities: [17, 17, 17, 17, 17, 15],
    setupMinutes: 1,
    laborMinutes: 0,
    machineMinutes: 20
  },
  {
    processIndex: 3,
    workCenterOffset: 11,
    workCenterCount: 6,
    quantities: [17, 17, 17, 17, 17, 15],
    setupMinutes: 1,
    laborMinutes: 0,
    machineMinutes: 120
  },
  {
    processIndex: 4,
    workCenterOffset: 17,
    workCenterCount: 1,
    quantities: [100],
    setupMinutes: 0,
    laborMinutes: 10,
    machineMinutes: 0
  }
];

// ── Procedure (工艺规程) definitions ─────────────────────────────────────────

type StepDef = {
  name: string;
  type: "Value" | "Measurement" | "Checkbox" | "Timestamp" | "Person" | "List" | "File";
  description?: string;
  required?: boolean;
  sortOrder: number;
};

type ProcedureDef = {
  name: string;
  processIndex: number;
  description: string;
  steps: StepDef[];
};

const PROCEDURES: ProcedureDef[] = [
  {
    name: "零部件预装工艺规程",
    processIndex: 0,
    description: "零部件预装工序标准操作规程 V1.0",
    steps: [
      {
        name: "确认物料清单",
        type: "Checkbox",
        description: "确认所有零部件已齐备",
        required: true,
        sortOrder: 1
      },
      {
        name: "预装扭矩值",
        type: "Value",
        description: "记录预装紧固件扭矩值 (标准: 2.0~3.0 N·m)",
        required: true,
        sortOrder: 2
      },
      {
        name: "外观检查",
        type: "Checkbox",
        description: "预装后外观无损伤",
        required: true,
        sortOrder: 3
      }
    ]
  },
  {
    name: "自动锁附工艺规程",
    processIndex: 1,
    description: "自动锁附工序标准操作规程 V1.0",
    steps: [
      {
        name: "程序号确认",
        type: "Value",
        description: "确认并记录机器人程序号",
        required: true,
        sortOrder: 1
      },
      {
        name: "锁附扭矩检测",
        type: "Value",
        description: "记录锁附扭矩检测值 (标准: 4.5~5.5 N·m)",
        required: true,
        sortOrder: 2
      },
      {
        name: "锁附完成确认",
        type: "Checkbox",
        description: "所有螺丝锁附完成，无浮锁",
        required: true,
        sortOrder: 3
      }
    ]
  },
  {
    name: "整机通电调试工艺规程",
    processIndex: 2,
    description: "整机通电调试工序标准操作规程 V1.0",
    steps: [
      {
        name: "上电检查",
        type: "Checkbox",
        description: "确认整机上电正常，无报警",
        required: true,
        sortOrder: 1
      },
      {
        name: "运行电流值",
        type: "Value",
        description: "记录空载运行电流值 (标准: 0.5~2.0 A)",
        required: true,
        sortOrder: 2
      },
      {
        name: "功能测试",
        type: "Checkbox",
        description: "所有功能测试通过",
        required: true,
        sortOrder: 3
      }
    ]
  },
  {
    name: "高温老化工艺规程",
    processIndex: 3,
    description: "高温老化工序标准操作规程 V1.0",
    steps: [
      {
        name: "老化温度设定",
        type: "Value",
        description: "记录老化柜温度设定值 (标准: 60±5 °C)",
        required: true,
        sortOrder: 1
      },
      {
        name: "老化时长",
        type: "Value",
        description: "记录老化持续时间 (标准: 4±0.5 h)",
        required: true,
        sortOrder: 2
      },
      {
        name: "老化后复检",
        type: "Checkbox",
        description: "老化后功能复检通过",
        required: true,
        sortOrder: 3
      }
    ]
  },
  {
    name: "终检包装工艺规程",
    processIndex: 4,
    description: "终检包装工序标准操作规程 V1.0",
    steps: [
      {
        name: "最终检验",
        type: "Checkbox",
        description: "最终成品检验全部通过",
        required: true,
        sortOrder: 1
      },
      {
        name: "贴标确认",
        type: "Checkbox",
        description: "产品标签、序列号标签已粘贴",
        required: true,
        sortOrder: 2
      },
      {
        name: "包装完成",
        type: "Checkbox",
        description: "产品已包装入库",
        required: true,
        sortOrder: 3
      }
    ]
  }
];

// ── Main seed function ───────────────────────────────────────────────────────

export async function seedAsmTop001(client: PoolClient, ctx: SeedCtx) {
  const { companyId, userId, locationId } = ctx;
  console.log("  Seeding asm-top-001 MES demonstration data...");

  // ── 1. Create the product item ──────────────────────────────────────────
  console.log("  → Creating product asm-top-001...");

  const itemResult = await client.query(
    `INSERT INTO item (
      "readableId", name, type, "replenishmentSystem", "defaultMethodType",
      "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy"
    ) VALUES ($1, $2, 'Part', 'Make', 'Make to Order', 'Serial', 'EA', true, $3, $4)
    RETURNING id`,
    ["asm-top-001", "asm-top-001 总成", companyId, userId]
  );
  const itemId = itemResult.rows[0].id as string;

  // The item-interceptors trigger auto-creates a makeMethod for this Part.
  const mmResult = await client.query(
    `SELECT id FROM "makeMethod" WHERE "itemId" = $1 AND "companyId" = $2 ORDER BY version DESC LIMIT 1`,
    [itemId, companyId]
  );
  if (mmResult.rows.length === 0) {
    throw new Error("seedAsmTop001: no makeMethod auto-created for asm-top-001");
  }
  const makeMethodId = mmResult.rows[0].id as string;

  // Activate the make method and set version label
  await client.query(
    `UPDATE "makeMethod" SET status = 'Active', "updatedAt" = NOW(), "updatedBy" = $1 WHERE id = $2`,
    [userId, makeMethodId]
  );

  // ── 2. Create processes ─────────────────────────────────────────────────
  console.log("  → Creating 5 processes...");
  const processIds: string[] = [];

  for (const proc of PROCESSES) {
    const result = await client.query(
      `INSERT INTO process (name, "defaultStandardFactor", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [proc.name, proc.factor, companyId, userId]
    );
    processIds.push(result.rows[0].id as string);
  }

  // ── 3. Create work centers (equipment) ──────────────────────────────────
  console.log("  → Creating 18 work centers...");
  const workCenterIds: string[] = [];

  for (const wc of WORK_CENTERS) {
    const result = await client.query(
      `INSERT INTO "workCenter" (name, description, "locationId", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [wc.name, wc.description, locationId, companyId, userId]
    );
    workCenterIds.push(result.rows[0].id as string);
  }

  // ── 4. Link work centers to processes via workCenterProcess ─────────────
  console.log("  → Linking work centers to processes...");

  for (let i = 0; i < WORK_CENTERS.length; i++) {
    const wc = WORK_CENTERS[i];
    const processId = processIds[wc.processIndex];
    await client.query(
      `INSERT INTO "workCenterProcess" ("workCenterId", "processId", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4)`,
      [workCenterIds[i], processId, companyId, userId]
    );
  }

  // ── 5. Create procedures (工艺规程 V1.0) with steps ─────────────────────
  console.log("  → Creating procedures with SOP steps...");
  const procedureIds: string[] = [];

  for (const proc of PROCEDURES) {
    const procResult = await client.query(
      `INSERT INTO "procedure" (
        name, "processId", description, version, status, "companyId", "createdBy"
      ) VALUES ($1, $2, $3, 1, 'Active', $4, $5) RETURNING id`,
      [
        `${proc.name} V1.0`,
        processIds[proc.processIndex],
        proc.description,
        companyId,
        userId
      ]
    );
    const procedureId = procResult.rows[0].id as string;
    procedureIds.push(procedureId);

    // Insert procedure steps
    for (const step of proc.steps) {
      await client.query(
        `INSERT INTO "procedureStep" (
          "procedureId", name, description, required, "sortOrder", type,
          "companyId", "createdBy"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          procedureId,
          step.name,
          step.description ? JSON.stringify({ text: step.description }) : null,
          step.required ?? false,
          step.sortOrder,
          step.type,
          companyId,
          userId
        ]
      );
    }
  }

  // ── 6. Create method operations (工艺路线) ──────────────────────────────
  console.log("  → Creating method operations (process route)...");

  for (const split of OPERATION_SPLITS) {
    const firstWcIndex = split.workCenterOffset;
    await client.query(
      `INSERT INTO "methodOperation" (
        "makeMethodId", "order", "operationOrder", "processId", "workCenterId",
        "procedureId",
        description, "setupTime", "setupUnit", "laborTime", "laborUnit",
        "machineTime", "machineUnit", "companyId", "createdBy"
      ) VALUES ($1, $2, 'After Previous', $3, $4, $5, $6, $7, 'Total Minutes', $8, 'Minutes/Piece', $9, 'Minutes/Piece', $10, $11)`,
      [
        makeMethodId,
        split.processIndex + 1,
        processIds[split.processIndex],
        workCenterIds[firstWcIndex],
        procedureIds[split.processIndex],
        PROCESSES[split.processIndex].name,
        split.setupMinutes,
        split.laborMinutes,
        split.machineMinutes,
        companyId,
        userId
      ]
    );
  }

  // ── 7. Create the work order (job) ──────────────────────────────────────
  console.log("  → Creating work order PRO-ASM-TOP-001-100...");

  const jobResult = await client.query(
    `INSERT INTO job (
      "jobId", "itemId", quantity, "locationId", status,
      "unitOfMeasureCode", "companyId", "createdBy"
    ) VALUES ($1, $2, 100, $3, 'Ready', 'EA', $4, $5) RETURNING id`,
    ["PRO-ASM-TOP-001-100", itemId, locationId, companyId, userId]
  );
  const jobId = jobResult.rows[0].id as string;

  // The job interceptors trigger auto-creates a jobMakeMethod.
  const jmmResult = await client.query(
    `SELECT id FROM "jobMakeMethod" WHERE "jobId" = $1 LIMIT 1`,
    [jobId]
  );
  if (jmmResult.rows.length === 0) {
    throw new Error("seedAsmTop001: no jobMakeMethod auto-created for job");
  }
  const jobMakeMethodId = jmmResult.rows[0].id as string;

  // ── 8. Create job operations (split by equipment) ───────────────────────
  console.log("  → Creating 18 job operations (split by equipment)...");

  for (const split of OPERATION_SPLITS) {
    const proc = PROCESSES[split.processIndex];
    const procedureId = procedureIds[split.processIndex];

    for (let j = 0; j < split.workCenterCount; j++) {
      const wcIndex = split.workCenterOffset + j;
      const qty = split.quantities[j];

      await client.query(
        `INSERT INTO "jobOperation" (
          "jobId", "jobMakeMethodId", "order", "processId", "workCenterId",
          description, "setupTime", "setupUnit", "laborTime", "laborUnit",
          "machineTime", "machineUnit", "operationOrder", status,
          "operationQuantity", "targetQuantity", "procedureId",
          "companyId", "createdBy"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Total Minutes', $8, 'Minutes/Piece', $9, 'Minutes/Piece', 'After Previous', 'Ready', $10, $11, $12, $13, $14)`,
        [
          jobId,
          jobMakeMethodId,
          (split.processIndex + 1) * 100 + j + 1, // order: 101, 201-204, 301-306, etc.
          processIds[split.processIndex],
          workCenterIds[wcIndex],
          `${proc.name} (${WORK_CENTERS[wcIndex].name})`,
          split.setupMinutes,
          split.laborMinutes,
          split.machineMinutes,
          qty,
          qty,
          procedureId,
          companyId,
          userId
        ]
      );
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`
  ✓ asm-top-001 MES demo data seeded successfully!

  Product:        asm-top-001 (Serial-tracked)
  Work Order:     PRO-ASM-TOP-001-100 (100 units, Ready)
  Processes:      ${processIds.length} (零部件预装 → 自动锁附 → 调试 → 老化 → 终检包装)
  Work Centers:   ${workCenterIds.length} (1+4+6+6+1 equipment)
  Procedures:     ${procedureIds.length} (V1.0 each with SOP steps)
  Job Operations: 18 (split by equipment, Ready for MES execution)

  Next: Open MES Kanban to see operations by work center.
  `);
}
