import type { AuditLogEntry, AuditMetadata } from "./audit.types";

export type WorkbenchModule =
  | "items"
  | "inventory"
  | "purchasing"
  | "production"
  | "quality"
  | "sales"
  | "accounting";

export type WorkbenchActivityType = "import" | "edit" | "configure";
export type WorkbenchActivityAction = "create" | "update" | "delete";
export type WorkbenchActivityResult = "success" | "failed" | "partial";
export type WorkbenchActivitySource = NonNullable<AuditMetadata["origin"]>;
export type WorkbenchActivitySourceType = "audit" | "request";

export type WorkbenchActivityProjection = {
  companyId: string;
  actorId: string;
  module: WorkbenchModule;
  activityType: WorkbenchActivityType;
  action: WorkbenchActivityAction;
  entityType: string;
  entityId: string;
  entityLabel: string;
  source: WorkbenchActivitySource;
  sourceType: WorkbenchActivitySourceType;
  sourceId: string;
  result: WorkbenchActivityResult;
  metadata: {
    auditId: string;
    tableName: string;
    recordId: string | null;
  };
  occurredAt: string;
  idempotencyKey: string;
};

export type WorkbenchActivityRpcClient = {
  rpc(
    fn: "upsert_workbench_activity_batch",
    params: {
      p_company_id: string;
      p_entries: WorkbenchActivityProjection[];
    }
  ): Promise<{
    data: number | null;
    error: { message?: string } | null;
  }>;
};

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

function auditOperationToAction(
  operation: AuditLogEntry["operation"]
): WorkbenchActivityAction {
  if (operation === "INSERT") return "create";
  if (operation === "DELETE") return "delete";
  return "update";
}

export function classifyAuditEntryForWorkbench(
  entry: AuditLogEntry
): { module: WorkbenchModule; activityType: WorkbenchActivityType } | null {
  const module =
    workbenchModuleByEntityType.get(String(entry.entityType)) ??
    workbenchModuleByTable.get(entry.tableName);
  if (!module) return null;

  const source = entry.metadata?.origin ?? "web";
  return {
    module,
    activityType:
      source === "import"
        ? "import"
        : workbenchConfigurationTables.has(entry.tableName)
          ? "configure"
          : "edit"
  };
}

function stableKeyPart(value: string | null | undefined) {
  return encodeURIComponent(value ?? "");
}

export function buildWorkbenchActivityIdempotencyKey(
  entry: AuditLogEntry
): string {
  return [
    "audit",
    entry.entityType,
    entry.tableName,
    entry.recordId ?? entry.entityId,
    entry.operation,
    entry.createdAt
  ]
    .map(stableKeyPart)
    .join(":");
}

export function projectAuditEntryToWorkbenchActivity(
  entry: AuditLogEntry,
  options?: { entityLabel?: string }
): WorkbenchActivityProjection | null {
  if (!entry.actorId) return null;

  const classification = classifyAuditEntryForWorkbench(entry);
  if (!classification) return null;

  const source = entry.metadata?.origin ?? "web";
  const requestId = entry.metadata?.requestId?.trim();

  return {
    companyId: entry.companyId,
    actorId: entry.actorId,
    module: classification.module,
    activityType: classification.activityType,
    action: auditOperationToAction(entry.operation),
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: options?.entityLabel?.trim() || entry.entityId,
    source,
    sourceType: requestId ? "request" : "audit",
    sourceId: requestId || buildWorkbenchActivityIdempotencyKey(entry),
    result: "success",
    metadata: {
      auditId: entry.id ?? buildWorkbenchActivityIdempotencyKey(entry),
      tableName: entry.tableName,
      recordId: entry.recordId
    },
    occurredAt: entry.createdAt,
    idempotencyKey: buildWorkbenchActivityIdempotencyKey(entry)
  };
}

export async function upsertWorkbenchActivityProjections(
  client: WorkbenchActivityRpcClient,
  companyId: string,
  entries: WorkbenchActivityProjection[]
): Promise<number> {
  if (entries.length === 0) return 0;

  const { data, error } = await client.rpc("upsert_workbench_activity_batch", {
    p_company_id: companyId,
    p_entries: entries
  });

  if (error) {
    throw new Error(
      `Failed to project workbench activities: ${
        error.message ?? "unknown RPC error"
      }`
    );
  }

  return data ?? entries.length;
}
