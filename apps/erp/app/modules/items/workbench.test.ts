import type { AuditLogEntry } from "@carbon/database/audit.types";
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchActivityCursorFilter,
  decodeWorkbenchCursor,
  encodeWorkbenchCursor,
  getWorkbenchDateRange,
  mapAuditEntryToWorkbenchActivity,
  mapNotificationToWorkbenchNotification,
  mapProjectionRowToWorkbenchActivity,
  parseWorkbenchActionFilter,
  parseWorkbenchActivityTypeFilter,
  parseWorkbenchLimit
} from "./workbench";

describe("getWorkbenchDateRange", () => {
  const now = new Date("2026-08-28T10:30:00.000Z");

  it("returns the current calendar day for today", () => {
    expect(getWorkbenchDateRange({ preset: "today", now })).toEqual({
      startDate: "2026-08-28T00:00:00.000Z",
      endDate: "2026-08-28T23:59:59.999Z"
    });
  });

  it("supports rolling day and week presets", () => {
    expect(getWorkbenchDateRange({ preset: "3d", now }).startDate).toBe(
      "2026-08-25T00:00:00.000Z"
    );
    expect(getWorkbenchDateRange({ preset: "2w", now }).startDate).toBe(
      "2026-08-15T00:00:00.000Z"
    );
  });

  it("uses an explicit custom range when both dates are valid", () => {
    expect(
      getWorkbenchDateRange({
        preset: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        now
      })
    ).toEqual({
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-05T23:59:59.999Z"
    });
  });
});

describe("workbench cursor", () => {
  it("round-trips the occurredAt and id keyset", () => {
    const cursor = {
      occurredAt: "2026-09-01T10:20:30.456Z",
      id: "wba_123"
    };

    expect(decodeWorkbenchCursor(encodeWorkbenchCursor(cursor))).toEqual(
      cursor
    );
  });

  it("rejects malformed or injectable cursor values", () => {
    expect(decodeWorkbenchCursor("not-base64")).toBeNull();
    expect(
      decodeWorkbenchCursor(
        encodeWorkbenchCursor({
          occurredAt: "2026-09-01T10:20:30.456Z",
          id: "wba_1),companyId.neq.company_1"
        })
      )
    ).toBeNull();
  });

  it("builds the keyset filter for projection pagination", () => {
    expect(
      buildWorkbenchActivityCursorFilter({
        occurredAt: "2026-09-01T10:20:30.456Z",
        id: "wba_123"
      })
    ).toBe(
      "occurredAt.lt.2026-09-01T10:20:30.456Z,and(occurredAt.eq.2026-09-01T10:20:30.456Z,id.lt.wba_123)"
    );
  });
});

describe("workbench filters", () => {
  it("parses URL filters conservatively", () => {
    expect(parseWorkbenchActivityTypeFilter("import")).toBe("import");
    expect(parseWorkbenchActivityTypeFilter("bad")).toBe("all");
    expect(parseWorkbenchActionFilter("delete")).toBe("delete");
    expect(parseWorkbenchActionFilter("deleted")).toBe("all");
  });

  it("bounds page limits", () => {
    expect(parseWorkbenchLimit("10")).toBe(10);
    expect(parseWorkbenchLimit("500")).toBe(100);
    expect(parseWorkbenchLimit("bad")).toBe(25);
  });
});

describe("mapAuditEntryToWorkbenchActivity", () => {
  it("maps item audit entries to an item activity with a stable label", () => {
    const entry: AuditLogEntry = {
      id: "aud_1",
      companyId: "company_1",
      tableName: "item",
      entityType: "item",
      entityId: "item_1",
      recordId: "item_1",
      operation: "UPDATE",
      actorId: "user_1",
      diff: null,
      metadata: { origin: "import" },
      createdAt: "2026-08-28T10:30:00.000Z"
    };

    expect(mapAuditEntryToWorkbenchActivity(entry)).toMatchObject({
      id: "aud_1",
      module: "items",
      action: "updated",
      entityType: "item",
      entityId: "item_1",
      source: "import",
      occurredAt: entry.createdAt
    });
  });

  it.each([
    ["shipment", "shipment", "inventory"],
    ["purchaseOrder", "purchaseOrder", "purchasing"],
    ["job", "productionJob", "production"],
    ["nonConformance", "nonConformance", "quality"],
    ["salesOrder", "salesOrder", "sales"]
  ] as const)("maps %s audit entries to the %s workbench", (tableName, entityType, module) => {
    const entry: AuditLogEntry = {
      id: `aud_${tableName}`,
      companyId: "company_1",
      tableName,
      entityType,
      entityId: `${tableName}_1`,
      recordId: `${tableName}_1`,
      operation: "UPDATE",
      actorId: "user_1",
      diff: null,
      metadata: { origin: "web" },
      createdAt: "2026-08-28T10:30:00.000Z"
    };

    expect(mapAuditEntryToWorkbenchActivity(entry)).toMatchObject({
      module,
      activityType: "edit",
      action: "updated",
      tableName,
      entityType
    });
  });

  it("maps sales configuration audit entries to configuration activity", () => {
    const entry: AuditLogEntry = {
      id: "aud_pricing_rule",
      companyId: "company_1",
      tableName: "pricingRule",
      entityType: "pricingRule",
      entityId: "rule_1",
      recordId: "rule_1",
      operation: "INSERT",
      actorId: "user_1",
      diff: null,
      metadata: { origin: "web" },
      createdAt: "2026-08-28T10:30:00.000Z"
    };

    expect(mapAuditEntryToWorkbenchActivity(entry)).toMatchObject({
      module: "sales",
      activityType: "configure",
      action: "created"
    });
  });
});

describe("mapProjectionRowToWorkbenchActivity", () => {
  it("preserves projection category, label, and keyset fields", () => {
    expect(
      mapProjectionRowToWorkbenchActivity({
        id: "wba_1",
        module: "items",
        activityType: "configure",
        action: "create",
        entityType: "itemsConfiguration",
        entityId: "finish_1",
        entityLabel: "拉丝",
        source: "web",
        result: "success",
        occurredAt: "2026-09-01T10:20:30.456Z",
        metadata: { tableName: "materialFinish" }
      })
    ).toMatchObject({
      id: "wba_1",
      module: "items",
      activityType: "configure",
      action: "created",
      entityLabel: "拉丝",
      tableName: "materialFinish"
    });
  });

  it("preserves supported non-items projection modules", () => {
    expect(
      mapProjectionRowToWorkbenchActivity({
        id: "wba_inventory_1",
        module: "inventory",
        activityType: "edit",
        action: "update",
        entityType: "shipment",
        entityId: "shipment_1",
        entityLabel: "S-001",
        source: "web",
        result: "success",
        occurredAt: "2026-09-01T10:20:30.456Z",
        metadata: { tableName: "shipment" }
      })
    ).toMatchObject({
      id: "wba_inventory_1",
      module: "inventory",
      activityType: "edit",
      action: "updated",
      entityType: "shipment",
      tableName: "shipment"
    });
  });
});

describe("mapNotificationToWorkbenchNotification", () => {
  it("prefers explicit notification fields and falls back to payload", () => {
    expect(
      mapNotificationToWorkbenchNotification({
        id: "notification_1",
        title: "  Approval needed ",
        description: null,
        createdAt: "2026-08-28T10:30:00.000Z",
        readAt: null,
        seenAt: "2026-08-28T10:31:00.000Z",
        documentId: null,
        documentType: null,
        payload: {
          description: "Review the item",
          documentId: "item_1",
          documentType: "item"
        }
      })
    ).toEqual({
      id: "notification_1",
      title: "Approval needed",
      description: "Review the item",
      createdAt: "2026-08-28T10:30:00.000Z",
      read: false,
      seen: true,
      documentId: "item_1",
      documentType: "item"
    });
  });
});
