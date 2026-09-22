import type { requirePermissions } from "@carbon/auth/auth.server";
import type {
  WorkbenchActivity,
  WorkbenchActivityModule,
  WorkbenchModule,
  WorkbenchNotification
} from "~/modules/items/workbench";
import { path } from "~/utils/path";

type PermissionRequirement = Parameters<typeof requirePermissions>[1];
type EntityPathMap = Record<string, (id: string) => string>;

export type WorkbenchRouteConfig = {
  module: WorkbenchModule;
  moduleLabel: string;
  activityNoun: string;
  permission: PermissionRequirement;
  to: string;
  auditDisabledDescription: string;
  getActivityPath: (activity: WorkbenchActivity) => string | null;
  getNotificationPath: (notification: WorkbenchNotification) => string | null;
};

export const workbenchModuleLabels: Record<WorkbenchActivityModule, string> = {
  items: "物品",
  inventory: "库存",
  purchasing: "采购",
  production: "生产",
  quality: "质量",
  sales: "销售",
  accounting: "会计",
  other: "其他"
};

function pathFromEntityPathMap(
  entityPathMap: EntityPathMap,
  entityType: string | undefined,
  entityId: string | undefined
) {
  if (!entityType || !entityId) return null;
  return entityPathMap[entityType]?.(entityId) ?? null;
}

function activityPath(entityPathMap: EntityPathMap) {
  return (activity: WorkbenchActivity) =>
    pathFromEntityPathMap(
      entityPathMap,
      entityPathMap[activity.entityType]
        ? activity.entityType
        : activity.tableName,
      activity.entityId
    );
}

function notificationPath(entityPathMap: EntityPathMap) {
  return (notification: WorkbenchNotification) =>
    pathFromEntityPathMap(
      entityPathMap,
      notification.documentType,
      notification.documentId
    );
}

const itemEntityPaths: EntityPathMap = {
  item: path.to.part,
  itemCost: path.to.part,
  part: path.to.part
};

const inventoryEntityPaths: EntityPathMap = {
  receipt: path.to.receipt,
  receiptLine: path.to.receipt,
  shipment: path.to.shipment,
  shipmentLine: path.to.shipment,
  shippingMethod: path.to.shippingMethod,
  stockTransfer: path.to.stockTransfer,
  stockTransferLine: path.to.stockTransfer,
  storageRule: path.to.storageRule,
  storageType: path.to.storageType,
  storageUnit: path.to.storageUnit,
  warehouseTransfer: path.to.warehouseTransfer,
  warehouseTransferLine: path.to.warehouseTransfer
};

const purchasingEntityPaths: EntityPathMap = {
  purchaseInvoice: path.to.purchaseInvoice,
  purchaseInvoiceLine: path.to.purchaseInvoice,
  purchaseOrder: path.to.purchaseOrder,
  purchaseOrderLine: path.to.purchaseOrder,
  purchasingRfq: path.to.purchasingRfq,
  purchasingRfqLine: path.to.purchasingRfq,
  supplier: path.to.supplier,
  supplierQuote: path.to.supplierQuote,
  supplierQuoteLine: path.to.supplierQuote,
  supplierType: path.to.supplierType
};

const productionEntityPaths: EntityPathMap = {
  job: path.to.job,
  jobMakeMethod: path.to.job,
  jobMaterial: path.to.job,
  jobOperation: path.to.job,
  maintenanceDispatch: path.to.maintenanceDispatch,
  maintenanceSchedule: path.to.maintenanceSchedule,
  productionJob: path.to.job,
  scrapReason: path.to.scrapReason
};

const qualityEntityPaths: EntityPathMap = {
  gauge: path.to.gauge,
  gaugeCalibrationRecord: path.to.gaugeCalibrationRecord,
  gaugeType: path.to.gaugeType,
  inboundInspection: path.to.inboundInspection,
  investigationType: path.to.investigationType,
  issueType: path.to.issueType,
  issueWorkflow: path.to.issueWorkflow,
  nonConformance: path.to.issue,
  qualityDocument: path.to.qualityDocument,
  riskRegister: path.to.risk
};

const salesEntityPaths: EntityPathMap = {
  customer: path.to.customer,
  customerItemPriceOverride: path.to.priceOverride,
  customerItemPriceOverrideBreak: path.to.priceOverride,
  customerStatus: path.to.customerStatus,
  customerType: path.to.customerType,
  noQuoteReason: path.to.noQuoteReason,
  priceOverride: path.to.priceOverride,
  priceOverrideBreak: path.to.priceOverride,
  pricingRule: path.to.pricingRule,
  quote: path.to.quote,
  salesInvoice: path.to.salesInvoice,
  salesInvoiceLine: path.to.salesInvoice,
  salesOrder: path.to.salesOrder,
  salesOrderLine: path.to.salesOrder,
  salesQuote: path.to.quote,
  salesRfq: path.to.salesRfq,
  salesRfqLine: path.to.salesRfq
};

export const itemWorkbenchConfig: WorkbenchRouteConfig = {
  module: "items",
  moduleLabel: "物品",
  activityNoun: "物品活动",
  permission: { view: "parts", role: "employee" },
  to: path.to.itemsWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人物品活动。",
  getActivityPath: activityPath(itemEntityPaths),
  getNotificationPath: notificationPath(itemEntityPaths)
};

export const inventoryWorkbenchConfig: WorkbenchRouteConfig = {
  module: "inventory",
  moduleLabel: "库存",
  activityNoun: "库存活动",
  permission: { view: "inventory", role: "employee" },
  to: path.to.inventoryWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人库存活动。",
  getActivityPath: activityPath(inventoryEntityPaths),
  getNotificationPath: notificationPath(inventoryEntityPaths)
};

export const purchasingWorkbenchConfig: WorkbenchRouteConfig = {
  module: "purchasing",
  moduleLabel: "采购",
  activityNoun: "采购活动",
  permission: { view: "purchasing", role: "employee" },
  to: path.to.purchasingWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人采购活动。",
  getActivityPath: activityPath(purchasingEntityPaths),
  getNotificationPath: notificationPath(purchasingEntityPaths)
};

export const productionWorkbenchConfig: WorkbenchRouteConfig = {
  module: "production",
  moduleLabel: "生产",
  activityNoun: "生产活动",
  permission: { view: "production", role: "employee" },
  to: path.to.productionWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人生产活动。",
  getActivityPath: activityPath(productionEntityPaths),
  getNotificationPath: notificationPath(productionEntityPaths)
};

export const qualityWorkbenchConfig: WorkbenchRouteConfig = {
  module: "quality",
  moduleLabel: "质量",
  activityNoun: "质量活动",
  permission: { view: "quality", role: "employee" },
  to: path.to.qualityWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人质量活动。",
  getActivityPath: activityPath(qualityEntityPaths),
  getNotificationPath: notificationPath(qualityEntityPaths)
};

export const salesWorkbenchConfig: WorkbenchRouteConfig = {
  module: "sales",
  moduleLabel: "销售",
  activityNoun: "销售活动",
  permission: { view: "sales", role: "employee" },
  to: path.to.salesWorkbench,
  auditDisabledDescription:
    "此公司已禁用审计日志。请在设置中启用，以记录个人销售活动。",
  getActivityPath: activityPath(salesEntityPaths),
  getNotificationPath: notificationPath(salesEntityPaths)
};
