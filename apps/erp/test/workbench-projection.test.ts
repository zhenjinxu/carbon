import { getEntityConfigsForTable } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchActivityIdempotencyKey,
  projectAuditEntryToWorkbenchActivity,
  upsertWorkbenchActivityProjections
} from "@carbon/database/workbench";

function auditEntry(
  overrides: Partial<AuditLogEntry> = {}
): AuditLogEntry {
  return {
    id: "aud_1",
    companyId: "company_1",
    tableName: "item",
    entityType: "item",
    entityId: "item_1",
    recordId: "item_1",
    operation: "UPDATE",
    actorId: "user_1",
    diff: null,
    metadata: null,
    createdAt: "2026-09-01T01:02:03.456Z",
    ...overrides
  };
}

describe("projectAuditEntryToWorkbenchActivity", () => {
  it("classifies request-scoped Excel changes as imports", () => {
    expect(
      projectAuditEntryToWorkbenchActivity(
        auditEntry({
          metadata: { origin: "import", requestId: "import_batch_1" }
        }),
        { entityLabel: "P-001 Pump body" }
      )
    ).toMatchObject({
      companyId: "company_1",
      actorId: "user_1",
      module: "items",
      activityType: "import",
      action: "update",
      entityType: "item",
      entityId: "item_1",
      entityLabel: "P-001 Pump body",
      sourceType: "request",
      sourceId: "import_batch_1",
      result: "success",
      occurredAt: "2026-09-01T01:02:03.456Z"
    });
  });

  it("classifies item setup tables as configuration", () => {
    expect(
      projectAuditEntryToWorkbenchActivity(
        auditEntry({
          tableName: "materialFinish",
          entityId: "finish_1",
          recordId: "finish_1",
          operation: "INSERT",
          metadata: { origin: "web" }
        })
      )
    ).toMatchObject({
      activityType: "configure",
      action: "create",
      entityId: "finish_1",
      sourceType: "audit"
    });
  });

  it.each([
    ["shipment", "shipment", "inventory"],
    ["purchaseOrder", "purchaseOrder", "purchasing"],
    ["job", "productionJob", "production"],
    ["nonConformance", "nonConformance", "quality"],
    ["salesOrder", "salesOrder", "sales"]
  ] as const)(
    "projects %s audit entries to the %s workbench",
    (tableName, entityType, module) => {
      expect(
        projectAuditEntryToWorkbenchActivity(
          auditEntry({
            tableName,
            entityType,
            entityId: `${tableName}_1`,
            recordId: `${tableName}_1`,
            metadata: { origin: "web" }
          })
        )
      ).toMatchObject({
        module,
        activityType: "edit",
        action: "update",
        entityType,
        entityId: `${tableName}_1`
      });
    }
  );

  it("projects sales setup tables as sales configuration activity", () => {
    expect(
      projectAuditEntryToWorkbenchActivity(
        auditEntry({
          tableName: "pricingRule",
          entityType: "pricingRule",
          entityId: "pricing_rule_1",
          recordId: "pricing_rule_1",
          operation: "INSERT",
          metadata: { origin: "web" }
        })
      )
    ).toMatchObject({
      module: "sales",
      activityType: "configure",
      action: "create",
      entityType: "pricingRule"
    });
  });

  it("defaults actor-owned item changes to web edits", () => {
    expect(
      projectAuditEntryToWorkbenchActivity(auditEntry({ metadata: null }))
    ).toMatchObject({
      activityType: "edit",
      action: "update",
      source: "web"
    });
  });

  it("does not create personal activities without an actor", () => {
    expect(
      projectAuditEntryToWorkbenchActivity(
        auditEntry({ actorId: null, metadata: { origin: "system" } })
      )
    ).toBeNull();
  });

  it("builds a stable key that changes for distinct source events", () => {
    const entry = auditEntry();
    expect(buildWorkbenchActivityIdempotencyKey(entry)).toBe(
      buildWorkbenchActivityIdempotencyKey({ ...entry })
    );
    expect(
      buildWorkbenchActivityIdempotencyKey({
        ...entry,
        createdAt: "2026-09-01T01:02:03.457Z"
      })
    ).not.toBe(buildWorkbenchActivityIdempotencyKey(entry));
  });
});
describe("Items audit coverage", () => {
  it("tracks item setup tables as configuration entities", () => {
    const configs = getEntityConfigsForTable("materialFinish");
    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: "itemsConfiguration" })
      ])
    );
  });

  it("resolves method children through makeMethod to the item", () => {
    const configs = getEntityConfigsForTable("methodOperation");
    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "item",
          tableConfig: {
            resolveFromRecord: {
              table: "makeMethod",
              sourceColumn: "makeMethodId",
              targetColumn: "id",
              entityIdColumn: "itemId"
            }
          }
        })
      ])
    );
  });
});

describe("upsertWorkbenchActivityProjections", () => {
  it("throws when the projection RPC fails so the event can retry", async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: { message: "projection unavailable" }
      })
    };
    const projection = projectAuditEntryToWorkbenchActivity(auditEntry());

    await expect(
      upsertWorkbenchActivityProjections(
        client,
        "company_1",
        projection ? [projection] : []
      )
    ).rejects.toThrow("Failed to project workbench activities");
  });
});
