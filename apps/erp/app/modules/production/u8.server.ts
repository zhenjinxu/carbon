import type { ColumnType, Generated, Kysely, Selectable } from "kysely";
import { getDatabaseClient } from "~/services/database.server";
import type { U8DashboardFilters, U8ImportConfigInput } from "./u8.models";

type Timestamp = ColumnType<string, string | Date, string | Date>;
type DateValue = ColumnType<string | Date, string | Date, string | Date>;

interface U8ImportConfigTable {
  id: Generated<string>;
  companyId: string;
  enabled: boolean;
  intervalMinutes: number;
  customerNames: string[];
  moCodes: string[];
  soCodes: string[];
  startDate: DateValue | null;
  endDate: DateValue | null;
  nextRunAt: Timestamp | null;
  lastRunAt: Timestamp | null;
  configVersion: number;
  createdBy: string;
  createdAt: Generated<Timestamp>;
  updatedBy: string | null;
  updatedAt: Timestamp | null;
}

interface U8WorkOrderTable {
  id: string;
  companyId: string;
  jobId: string;
  sourceMoDId: string;
  moCode: string;
  salesOrderCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  departmentName: string | null;
  personInCharge: string | null;
  itemCode: string | null;
  itemName: string | null;
  sourceStatus: string | null;
  plannedQuantity: number;
  sourceQualifiedQuantity: number;
  plannedStartDate: DateValue | null;
  dueDate: DateValue | null;
  sourceUpdatedAt: Timestamp | null;
  payloadHash: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string | null;
  updatedAt: Timestamp | null;
}

interface JobTable {
  id: string;
  companyId: string;
  jobId: string;
  status: string;
  quantity: number;
  quantityComplete: number;
  assignee: string | null;
  startDate: string | null;
  dueDate: string | null;
}

interface JobOperationTable {
  id: string;
  companyId: string;
  jobId: string;
  description: string | null;
  order: number;
  status: string;
  operationQuantity: number | null;
  quantityComplete: number | null;
  assignee: string | null;
  workCenterId: string | null;
}

interface JobOperationDependencyTable {
  companyId: string;
  jobId: string;
  operationId: string;
  dependsOnId: string;
}

interface WorkCenterTable {
  id: string;
  name: string;
}

interface SyncRunTable {
  id: string;
  companyId: string;
  source: string;
  status: string;
  triggerType: string;
  filterSnapshot: unknown;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  message: string | null;
}

interface SyncErrorTable {
  id: string;
  syncRunId: string;
  companyId: string;
  sourceCollection: string;
  sourceId: string | null;
  errorCode: string;
  message: string;
  retryStatus: string;
  createdAt: Timestamp;
}

interface U8Database {
  u8WorkOrderImportConfig: U8ImportConfigTable;
  u8WorkOrder: U8WorkOrderTable;
  job: JobTable;
  jobOperation: JobOperationTable;
  jobOperationDependency: JobOperationDependencyTable;
  workCenter: WorkCenterTable;
  wodiMESSyncRun: SyncRunTable;
  wodiMESSyncError: SyncErrorTable;
}

const database = () => getDatabaseClient() as unknown as Kysely<U8Database>;

const emptyConfig = {
  enabled: false,
  intervalMinutes: 5,
  customerNames: [] as string[],
  moCodes: [] as string[],
  soCodes: [] as string[],
  startDate: null as string | null,
  endDate: null as string | null,
  nextRunAt: null as string | null,
  lastRunAt: null as string | null,
  configVersion: 0
};

function normalizeDate(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export async function getU8ImportConfig(companyId: string) {
  const result = await database()
    .selectFrom("u8WorkOrderImportConfig")
    .select([
      "enabled",
      "intervalMinutes",
      "customerNames",
      "moCodes",
      "soCodes",
      "startDate",
      "endDate",
      "nextRunAt",
      "lastRunAt",
      "configVersion"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  if (!result) return emptyConfig;
  return {
    ...result,
    startDate: normalizeDate(result.startDate),
    endDate: normalizeDate(result.endDate)
  };
}

export async function saveU8ImportConfig({
  companyId,
  userId,
  enabled,
  input
}: {
  companyId: string;
  userId: string;
  enabled: boolean;
  input: U8ImportConfigInput;
}) {
  const current = await getU8ImportConfig(companyId);
  const now = new Date();
  const nextRunAt = enabled ? now : null;

  return database()
    .insertInto("u8WorkOrderImportConfig")
    .values({
      companyId,
      enabled,
      intervalMinutes: input.intervalMinutes,
      customerNames: input.customerNames,
      moCodes: input.moCodes,
      soCodes: input.soCodes,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      nextRunAt,
      lastRunAt: null,
      configVersion: current.configVersion + 1,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: now
    })
    .onConflict((conflict) =>
      conflict.column("companyId").doUpdateSet({
        enabled,
        intervalMinutes: input.intervalMinutes,
        customerNames: input.customerNames,
        moCodes: input.moCodes,
        soCodes: input.soCodes,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        nextRunAt,
        configVersion: current.configVersion + 1,
        updatedBy: userId,
        updatedAt: now
      })
    )
    .executeTakeFirst();
}

export async function getU8ImportHistory(companyId: string) {
  return database()
    .selectFrom("wodiMESSyncRun")
    .select([
      "id",
      "status",
      "triggerType",
      "filterSnapshot",
      "startedAt",
      "finishedAt",
      "scannedCount",
      "insertedCount",
      "updatedCount",
      "skippedCount",
      "errorCount",
      "message"
    ])
    .where("companyId", "=", companyId)
    .where("source", "=", "U8")
    .orderBy("startedAt", "desc")
    .limit(25)
    .execute();
}

export async function getU8ImportErrors(companyId: string, syncRunId?: string) {
  let query = database()
    .selectFrom("wodiMESSyncError")
    .select([
      "id",
      "syncRunId",
      "sourceId",
      "errorCode",
      "message",
      "retryStatus",
      "createdAt"
    ])
    .where("companyId", "=", companyId)
    .orderBy("createdAt", "desc")
    .limit(25);

  if (syncRunId) query = query.where("syncRunId", "=", syncRunId);
  return query.execute();
}

export type U8DashboardSummary = {
  total: number;
  released: number;
  inProgress: number;
  completed: number;
  overdue: number;
};

export async function getU8ProductionDashboard(
  companyId: string,
  filters: U8DashboardFilters
) {
  const db = database();
  const base = () => {
    let query = db
      .selectFrom("u8WorkOrder as w")
      .innerJoin("job as j", (join) =>
        join
          .onRef("j.id", "=", "w.jobId")
          .onRef("j.companyId", "=", "w.companyId")
      )
      .where("w.companyId", "=", companyId);
    if (filters.search) {
      const pattern = "%" + filters.search + "%";
      query = query.where((expression) =>
        expression.or([
          expression("w.moCode", "ilike", pattern),
          expression("w.salesOrderCode", "ilike", pattern),
          expression("w.customerName", "ilike", pattern),
          expression("w.itemCode", "ilike", pattern),
          expression("w.itemName", "ilike", pattern)
        ])
      );
    }
    if (filters.customer) {
      query = query.where(
        "w.customerName",
        "ilike",
        "%" + filters.customer + "%"
      );
    }
    if (filters.status) {
      query = query.where("j.status", "=", filters.status);
    }
    if (filters.startDate) {
      query = query.where("w.plannedStartDate", ">=", filters.startDate);
    }
    if (filters.endDate) {
      query = query.where("w.plannedStartDate", "<=", filters.endDate);
    }
    return query;
  };

  const statusQuery = base()
    .select((expression) => [
      "j.status",
      expression.fn.countAll<number>().as("count")
    ])
    .groupBy("j.status");

  const overdueQuery = base()
    .select((expression) => expression.fn.countAll<number>().as("count"))
    .where("w.dueDate", "<", new Date().toISOString().slice(0, 10))
    .where("j.status", "not in", ["Completed", "Closed", "Cancelled"]);

  const countQuery = base().select((expression) =>
    expression.fn.countAll<number>().as("count")
  );

  const customerQuery = base()
    .select((expression) => [
      "w.customerName",
      expression.fn.countAll<number>().as("count"),
      expression.fn.sum<number>("w.plannedQuantity").as("plannedQuantity")
    ])
    .groupBy("w.customerName")
    .orderBy("count", "desc")
    .limit(8);

  let operationQuery = db
    .selectFrom("jobOperation as o")
    .innerJoin("u8WorkOrder as w", (join) =>
      join
        .onRef("w.jobId", "=", "o.jobId")
        .onRef("w.companyId", "=", "o.companyId")
    )
    .innerJoin("job as j", (join) =>
      join
        .onRef("j.id", "=", "w.jobId")
        .onRef("j.companyId", "=", "w.companyId")
    )
    .select((expression) => [
      "o.description",
      expression.fn.countAll<number>().as("count")
    ])
    .where("w.companyId", "=", companyId)
    .where("o.status", "not in", ["Done", "Canceled"])
    .groupBy("o.description")
    .orderBy("count", "desc")
    .limit(8);
  if (filters.search) {
    const pattern = "%" + filters.search + "%";
    operationQuery = operationQuery.where((expression) =>
      expression.or([
        expression("w.moCode", "ilike", pattern),
        expression("w.salesOrderCode", "ilike", pattern),
        expression("w.customerName", "ilike", pattern),
        expression("w.itemCode", "ilike", pattern),
        expression("w.itemName", "ilike", pattern)
      ])
    );
  }
  if (filters.customer) {
    operationQuery = operationQuery.where(
      "w.customerName",
      "ilike",
      "%" + filters.customer + "%"
    );
  }
  if (filters.status) {
    operationQuery = operationQuery.where("j.status", "=", filters.status);
  }
  if (filters.startDate) {
    operationQuery = operationQuery.where(
      "w.plannedStartDate",
      ">=",
      filters.startDate
    );
  }
  if (filters.endDate) {
    operationQuery = operationQuery.where(
      "w.plannedStartDate",
      "<=",
      filters.endDate
    );
  }

  const listQuery = base()
    .select([
      "w.id",
      "w.jobId",
      "w.sourceMoDId",
      "w.moCode",
      "w.salesOrderCode",
      "w.customerName",
      "w.departmentName",
      "w.personInCharge",
      "w.itemCode",
      "w.itemName",
      "w.sourceStatus",
      "w.plannedQuantity",
      "w.sourceQualifiedQuantity",
      "w.plannedStartDate",
      "w.dueDate",
      "j.status",
      "j.quantityComplete",
      "j.assignee"
    ])
    .orderBy("w.dueDate", "asc")
    .orderBy("w.moCode", "asc")
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const [statusRows, overdue, total, customers, operations, workOrders] =
    await Promise.all([
      statusQuery.execute(),
      overdueQuery.executeTakeFirst(),
      countQuery.executeTakeFirst(),
      customerQuery.execute(),
      operationQuery.execute(),
      listQuery.execute()
    ]);

  const byStatus = new Map(
    statusRows.map((row) => [row.status, Number(row.count)])
  );
  const summary: U8DashboardSummary = {
    total: Number(total?.count ?? 0),
    released: (byStatus.get("Ready") ?? 0) + (byStatus.get("Planned") ?? 0),
    inProgress:
      (byStatus.get("In Progress") ?? 0) + (byStatus.get("Paused") ?? 0),
    completed: (byStatus.get("Completed") ?? 0) + (byStatus.get("Closed") ?? 0),
    overdue: Number(overdue?.count ?? 0)
  };

  const detail = filters.selectedJobId
    ? await getU8WorkOrderDetail(companyId, filters.selectedJobId)
    : null;

  return {
    summary,
    customers: customers.map((row) => ({
      name: row.customerName ?? "Unassigned",
      count: Number(row.count),
      plannedQuantity: Number(row.plannedQuantity ?? 0)
    })),
    operations: operations.map((row) => ({
      name: row.description ?? "Unspecified operation",
      count: Number(row.count)
    })),
    workOrders: workOrders.map((workOrder) => ({
      ...workOrder,
      plannedStartDate: normalizeDate(workOrder.plannedStartDate),
      dueDate: normalizeDate(workOrder.dueDate)
    })),
    total: summary.total,
    detail
  };
}

export async function getU8WorkOrderDetail(companyId: string, jobId: string) {
  const db = database();
  const [workOrder, operations, dependencies] = await Promise.all([
    db
      .selectFrom("u8WorkOrder as w")
      .innerJoin("job as j", (join) =>
        join
          .onRef("j.id", "=", "w.jobId")
          .onRef("j.companyId", "=", "w.companyId")
      )
      .select([
        "w.jobId",
        "w.moCode",
        "w.customerName",
        "w.itemCode",
        "w.itemName",
        "w.salesOrderCode",
        "j.status"
      ])
      .where("w.companyId", "=", companyId)
      .where("w.jobId", "=", jobId)
      .executeTakeFirst(),
    db
      .selectFrom("jobOperation as o")
      .leftJoin("workCenter as wc", "wc.id", "o.workCenterId")
      .select([
        "o.id",
        "o.description",
        "o.order",
        "o.status",
        "o.operationQuantity",
        "o.quantityComplete",
        "o.assignee",
        "wc.name as workCenterName"
      ])
      .where("o.companyId", "=", companyId)
      .where("o.jobId", "=", jobId)
      .orderBy("o.order")
      .orderBy("o.id")
      .execute(),
    db
      .selectFrom("jobOperationDependency")
      .select(["operationId", "dependsOnId"])
      .where("companyId", "=", companyId)
      .where("jobId", "=", jobId)
      .execute()
  ]);

  if (!workOrder) return null;

  const dependencyMap = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = dependencyMap.get(dependency.operationId) ?? [];
    list.push(dependency.dependsOnId);
    dependencyMap.set(dependency.operationId, list);
  }
  const statusById = new Map(
    operations.map((operation) => [operation.id, operation.status])
  );
  const isDone = (id: string) =>
    ["Done", "Canceled"].includes(statusById.get(id) ?? "");
  const readyOperations = operations.filter((operation) => {
    if (!["Ready", "Todo", "Waiting"].includes(operation.status)) return false;
    return (dependencyMap.get(operation.id) ?? []).every(isDone);
  });
  const current =
    operations.find((operation) =>
      ["In Progress", "Paused"].includes(operation.status)
    ) ??
    readyOperations[0] ??
    operations.find((operation) => !isDone(operation.id)) ??
    null;
  const next = current
    ? operations.filter((operation) =>
        (dependencyMap.get(operation.id) ?? []).includes(current.id)
      )
    : [];

  return {
    workOrder,
    operations: operations.map((operation) => ({
      ...operation,
      dependsOnIds: dependencyMap.get(operation.id) ?? []
    })),
    currentOperationId: current?.id ?? null,
    nextOperationIds: next.map((operation) => operation.id)
  };
}

export type U8ImportConfig = Awaited<ReturnType<typeof getU8ImportConfig>>;
export type U8SyncRun = Selectable<SyncRunTable>;
