import type { AuditLogEntry } from "@carbon/database/audit.types";

export type WorkbenchDatePreset =
  | "today"
  | "1d"
  | "2d"
  | "3d"
  | "1w"
  | "2w"
  | "custom";

export type WorkbenchModule =
  | "items"
  | "inventory"
  | "purchasing"
  | "production"
  | "quality"
  | "sales"
  | "accounting";

export type WorkbenchActivityModule = WorkbenchModule | "other";

export type WorkbenchDateRange = {
  startDate: string;
  endDate: string;
};

export const workbenchDatePresets: WorkbenchDatePreset[] = [
  "today",
  "1d",
  "2d",
  "3d",
  "1w",
  "2w",
  "custom"
];

export type WorkbenchCursor = {
  occurredAt: string;
  id: string;
};

export type WorkbenchActivity = {
  id: string;
  module: WorkbenchActivityModule;
  activityType: "import" | "edit" | "configure";
  action: "created" | "updated" | "deleted";
  entityType: string;
  entityId: string;
  entityLabel: string;
  source: "web" | "api" | "import" | "system";
  result: "success" | "failed" | "partial";
  occurredAt: string;
  tableName: string;
};

export type WorkbenchActivityProjectionRow = {
  id: string;
  module: string;
  activityType: "import" | "edit" | "configure";
  action: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  entityLabel: string;
  source: "web" | "api" | "import" | "system";
  result: "success" | "failed" | "partial";
  occurredAt: string;
  metadata?: { tableName?: string } | null;
};

export type WorkbenchActivityTypeFilter =
  | "all"
  | WorkbenchActivity["activityType"];
export type WorkbenchActivityActionFilter =
  | "all"
  | WorkbenchActivityProjectionRow["action"];

export type WorkbenchNotification = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  read: boolean;
  seen: boolean;
  documentId?: string;
  documentType?: string;
};

const WORKBENCH_CURSOR_ID = /^[A-Za-z0-9_-]{1,128}$/;
const WORKBENCH_ACTIVITY_TYPES = new Set<WorkbenchActivityTypeFilter>([
  "all",
  "import",
  "edit",
  "configure"
]);
const WORKBENCH_ACTIVITY_ACTIONS = new Set<WorkbenchActivityActionFilter>([
  "all",
  "create",
  "update",
  "delete"
]);
const WORKBENCH_MODULES = new Set<string>([
  "items",
  "inventory",
  "purchasing",
  "production",
  "quality",
  "sales",
  "accounting"
]);
const DEFAULT_WORKBENCH_LIMIT = 25;
const MAX_WORKBENCH_LIMIT = 100;

const workbenchEditTablesByModule: Record<WorkbenchModule, readonly string[]> =
  {
    items: [
      "customerPartToItem",
      "item",
      "itemCost",
      "itemPlanning",
      "itemReplenishment",
      "itemShelfLife",
      "itemUnitSalePrice",
      "makeMethod",
      "methodMaterial",
      "methodOperation",
      "part",
      "supplierPart"
    ],
    inventory: [
      "receipt",
      "receiptLine",
      "shipment",
      "shipmentLine",
      "stockTransfer",
      "stockTransferLine",
      "warehouseTransfer",
      "warehouseTransferLine"
    ],
    purchasing: [
      "address",
      "contact",
      "purchaseInvoice",
      "purchaseInvoiceLine",
      "purchaseOrder",
      "purchaseOrderDelivery",
      "purchaseOrderLine",
      "purchaseOrderPayment",
      "purchasingRfq",
      "purchasingRfqLine",
      "supplier",
      "supplierPayment",
      "supplierQuote",
      "supplierQuoteLine",
      "supplierShipping",
      "supplierTax"
    ],
    production: [
      "job",
      "jobMakeMethod",
      "jobMaterial",
      "jobOperation",
      "maintenanceDispatch",
      "maintenanceDispatchComment",
      "maintenanceDispatchEvent",
      "maintenanceSchedule",
      "maintenanceScheduleItem"
    ],
    quality: [
      "gauge",
      "gaugeCalibrationRecord",
      "inboundInspection",
      "nonConformance",
      "nonConformanceActionTask",
      "nonConformanceApprovalTask",
      "nonConformanceItem",
      "qualityDocument",
      "qualityDocumentStep",
      "riskRegister"
    ],
    sales: [
      "address",
      "contact",
      "customer",
      "customerPayment",
      "customerShipping",
      "customerTax",
      "quote",
      "quoteLine",
      "salesInvoice",
      "salesInvoiceLine",
      "salesInvoiceShipment",
      "salesOrder",
      "salesOrderLine",
      "salesOrderPayment",
      "salesOrderShipment",
      "salesRfq",
      "salesRfqLine"
    ],
    accounting: []
  };

const workbenchConfigurationTablesByModule: Record<
  WorkbenchModule,
  readonly string[]
> = {
  items: [
    "itemPostingGroup",
    "materialDimension",
    "materialFinish",
    "materialForm",
    "materialGrade",
    "materialSubstance",
    "materialType",
    "unitOfMeasure"
  ],
  inventory: ["shippingMethod", "storageRule", "storageType", "storageUnit"],
  purchasing: ["supplierType"],
  production: ["scrapReason"],
  quality: [
    "gaugeType",
    "investigationType",
    "issueType",
    "issueWorkflow",
    "requiredAction"
  ],
  sales: [
    "customerItemPriceOverride",
    "customerItemPriceOverrideBreak",
    "customerStatus",
    "customerType",
    "noQuoteReason",
    "pricingRule"
  ],
  accounting: []
};

const workbenchModuleByTable = new Map<string, WorkbenchModule>(
  [workbenchEditTablesByModule, workbenchConfigurationTablesByModule].flatMap(
    (tablesByModule) =>
      Object.entries(tablesByModule).flatMap(([module, tables]) =>
        tables.map((table) => [table, module as WorkbenchModule])
      )
  )
);

const workbenchConfigurationTables = new Set(
  Object.values(workbenchConfigurationTablesByModule).flat()
);

const workbenchModuleByEntityType = new Map<string, WorkbenchModule>([
  ["item", "items"],
  ["itemCost", "items"],
  ["itemsConfiguration", "items"],
  ["part", "items"],
  ["receipt", "inventory"],
  ["shipment", "inventory"],
  ["stockTransfer", "inventory"],
  ["warehouseTransfer", "inventory"],
  ["purchaseInvoice", "purchasing"],
  ["purchaseOrder", "purchasing"],
  ["purchasingRfq", "purchasing"],
  ["supplier", "purchasing"],
  ["supplierQuote", "purchasing"],
  ["maintenanceDispatch", "production"],
  ["maintenanceSchedule", "production"],
  ["productionJob", "production"],
  ["gauge", "quality"],
  ["inboundInspection", "quality"],
  ["nonConformance", "quality"],
  ["qualityDocument", "quality"],
  ["riskRegister", "quality"],
  ["customer", "sales"],
  ["priceOverride", "sales"],
  ["priceOverrideBreak", "sales"],
  ["pricingRule", "sales"],
  ["quote", "sales"],
  ["salesInvoice", "sales"],
  ["salesOrder", "sales"],
  ["salesQuote", "sales"],
  ["salesRfq", "sales"]
]);

export function parseWorkbenchModule(
  value: string | null | undefined
): WorkbenchActivityModule {
  return value && WORKBENCH_MODULES.has(value)
    ? (value as WorkbenchModule)
    : "other";
}

function getWorkbenchModuleForAuditEntry(
  entry: AuditLogEntry
): WorkbenchActivityModule {
  return (
    workbenchModuleByEntityType.get(String(entry.entityType)) ??
    workbenchModuleByTable.get(entry.tableName) ??
    "other"
  );
}

function getWorkbenchActivityTypeForAuditEntry(
  entry: AuditLogEntry,
  module: WorkbenchActivityModule,
  source: WorkbenchActivity["source"]
): WorkbenchActivity["activityType"] {
  if (source === "import") return "import";
  if (module !== "other" && workbenchConfigurationTables.has(entry.tableName)) {
    return "configure";
  }
  return "edit";
}

export function parseWorkbenchActivityTypeFilter(
  value: string | null | undefined
): WorkbenchActivityTypeFilter {
  return value &&
    WORKBENCH_ACTIVITY_TYPES.has(value as WorkbenchActivityTypeFilter)
    ? (value as WorkbenchActivityTypeFilter)
    : "all";
}

export function parseWorkbenchDatePreset(
  value: string | null | undefined
): WorkbenchDatePreset {
  return value && workbenchDatePresets.includes(value as WorkbenchDatePreset)
    ? (value as WorkbenchDatePreset)
    : "today";
}

export function parseWorkbenchActionFilter(
  value: string | null | undefined
): WorkbenchActivityActionFilter {
  return value &&
    WORKBENCH_ACTIVITY_ACTIONS.has(value as WorkbenchActivityActionFilter)
    ? (value as WorkbenchActivityActionFilter)
    : "all";
}

export function parseWorkbenchLimit(
  value: string | null | undefined,
  options?: { defaultLimit?: number; maxLimit?: number }
): number {
  const defaultLimit = options?.defaultLimit ?? DEFAULT_WORKBENCH_LIMIT;
  const maxLimit = options?.maxLimit ?? MAX_WORKBENCH_LIMIT;
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

export function encodeWorkbenchCursor(cursor: WorkbenchCursor): string {
  return btoa(JSON.stringify(cursor))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeWorkbenchCursor(
  value: string | null | undefined
): WorkbenchCursor | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const parsed = JSON.parse(atob(padded)) as Partial<WorkbenchCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      Number.isNaN(new Date(parsed.occurredAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !WORKBENCH_CURSOR_ID.test(parsed.id)
    ) {
      return null;
    }

    return {
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      id: parsed.id
    };
  } catch {
    return null;
  }
}

export function buildWorkbenchActivityCursorFilter(
  cursor: WorkbenchCursor | null | undefined
): string | null {
  if (!cursor) return null;

  return [
    `occurredAt.lt.${cursor.occurredAt}`,
    `and(occurredAt.eq.${cursor.occurredAt},id.lt.${cursor.id})`
  ].join(",");
}

export function mapNotificationToWorkbenchNotification(row: {
  id: string;
  title?: string | null;
  description?: string | null;
  createdAt: string;
  readAt?: string | null;
  seenAt?: string | null;
  documentId?: string | null;
  documentType?: string | null;
  payload?: {
    description?: string;
    documentId?: string;
    documentType?: string;
  } | null;
}): WorkbenchNotification {
  return {
    id: row.id,
    title: row.title?.trim() || "Notification",
    description:
      row.description?.trim() || row.payload?.description?.trim() || "",
    createdAt: row.createdAt,
    read: row.readAt !== null && row.readAt !== undefined,
    seen: row.seenAt !== null && row.seenAt !== undefined,
    documentId: row.documentId ?? row.payload?.documentId ?? undefined,
    documentType: row.documentType ?? row.payload?.documentType ?? undefined
  };
}
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function endOfUtcDay(date: Date) {
  const result = startOfUtcDay(date);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function parseDate(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? null
    : end
      ? endOfUtcDay(parsed)
      : startOfUtcDay(parsed);
}

export function getWorkbenchDateRange({
  preset,
  startDate,
  endDate,
  now = new Date()
}: {
  preset?: WorkbenchDatePreset;
  startDate?: string;
  endDate?: string;
  now?: Date;
}): WorkbenchDateRange {
  const current = startOfUtcDay(now);
  const customStart = parseDate(startDate);
  const customEnd = parseDate(endDate, true);

  if (
    preset === "custom" &&
    customStart &&
    customEnd &&
    customStart <= customEnd
  ) {
    return {
      startDate: customStart.toISOString(),
      endDate: customEnd.toISOString()
    };
  }

  const days =
    preset === "1d"
      ? 1
      : preset === "2d"
        ? 2
        : preset === "3d"
          ? 3
          : preset === "1w"
            ? 7
            : preset === "2w"
              ? 13
              : 0;
  const start =
    days > 0 ? new Date(current.getTime() - days * DAY_MS) : current;

  return {
    startDate: start.toISOString(),
    endDate: endOfUtcDay(now).toISOString()
  };
}

export function mapAuditEntryToWorkbenchActivity(
  entry: AuditLogEntry
): WorkbenchActivity {
  const source = entry.metadata?.origin ?? "system";
  const module = getWorkbenchModuleForAuditEntry(entry);

  return {
    id: entry.id,
    module,
    activityType: getWorkbenchActivityTypeForAuditEntry(entry, module, source),
    action:
      entry.operation === "INSERT"
        ? "created"
        : entry.operation === "DELETE"
          ? "deleted"
          : "updated",
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityId,
    source,
    result: "success",
    occurredAt: entry.createdAt,
    tableName: entry.tableName
  };
}

export function mapProjectionRowToWorkbenchActivity(
  row: WorkbenchActivityProjectionRow
): WorkbenchActivity {
  return {
    id: row.id,
    module: parseWorkbenchModule(row.module),
    activityType: row.activityType,
    action:
      row.action === "create"
        ? "created"
        : row.action === "delete"
          ? "deleted"
          : "updated",
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    source: row.source,
    result: row.result,
    occurredAt: row.occurredAt,
    tableName: row.metadata?.tableName ?? row.entityType
  };
}
