import { describe, expect, it } from "vitest";
import {
  assertPartsBulkDeleteSession,
  MAX_PARTS_BULK_DELETE,
  normalizePartIds
} from "./parts-bulk-delete.server";

async function validateBulkDeleteForm(formData: FormData) {
  process.env.INNGEST_SIGNING_KEY ??= "test-signing-key";
  process.env.INNGEST_EVENT_KEY ??= "test-event-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  process.env.SUPABASE_JWT_SECRET ??= "test-jwt-secret";
  process.env.SUPABASE_DB_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "test-session-secret";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.VERCEL_URL ??= "localhost";
  process.env.SUPABASE_URL ??= "http://localhost:54321";
  process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
  const { partsBulkDeleteValidator } = await import("./items.models");
  return partsBulkDeleteValidator.safeParse({
    operation: formData.get("operation"),
    items: formData.getAll("items"),
    archive: formData.get("archive") ?? undefined,
    reason: formData.get("reason") ?? undefined,
    cleanupAction: formData.get("cleanupAction") ?? undefined
  });
}

describe("normalizePartIds", () => {
  it("accepts and trims up to one hundred unique item revision IDs", () => {
    const itemIds = Array.from(
      { length: MAX_PARTS_BULK_DELETE },
      (_, index) => ` item-${index} `
    );

    expect(normalizePartIds(itemIds)).toEqual(
      itemIds.map((itemId) => itemId.trim())
    );
  });

  it.each([
    { name: "an empty selection", itemIds: [] },
    { name: "a blank ID", itemIds: ["item-1", " "] },
    { name: "duplicate IDs", itemIds: ["item-1", " item-1 "] },
    {
      name: "more than one hundred IDs",
      itemIds: Array.from(
        { length: MAX_PARTS_BULK_DELETE + 1 },
        (_, index) => `item-${index}`
      )
    }
  ])("rejects $name", ({ itemIds }) => {
    expect(() => normalizePartIds(itemIds)).toThrow();
  });
});

describe("partsBulkDeleteValidator", () => {
  it("allows normal deletion without an archive reason", async () => {
    const formData = new FormData();
    formData.append("operation", "delete");
    formData.append("items", "part-1");

    const result = await validateBulkDeleteForm(formData);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected validation to pass");
    expect(result.data).toEqual({
      operation: "delete",
      items: ["part-1"]
    });
  }, 15000);

  it("requires a reason when archive cleanup mode is selected", async () => {
    const formData = new FormData();
    formData.append("operation", "delete");
    formData.append("items", "part-1");
    formData.append("archive", "on");
    formData.append("reason", " ");

    const result = await validateBulkDeleteForm(formData);

    expect(result.success).toBe(false);
  }, 15000);

  it("accepts archive cleanup mode with deactivate action", async () => {
    const formData = new FormData();
    formData.append("operation", "delete");
    formData.append("items", "part-1");
    formData.append("archive", "on");
    formData.append(
      "reason",
      "Deactivate instead of deleting production references"
    );
    formData.append("cleanupAction", "deactivate");

    const result = await validateBulkDeleteForm(formData);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected validation to pass");
    expect(result.data).toEqual({
      operation: "delete",
      items: ["part-1"],
      archive: true,
      reason: "Deactivate instead of deleting production references",
      cleanupAction: "deactivate"
    });
  }, 15000);

  it("accepts archive cleanup mode with test job deletion action", async () => {
    const formData = new FormData();
    formData.append("operation", "delete");
    formData.append("items", "part-1");
    formData.append("archive", "on");
    formData.append("reason", "Delete imported test jobs");
    formData.append("cleanupAction", "deleteTestJobs");

    const result = await validateBulkDeleteForm(formData);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected validation to pass");
    expect(result.data).toEqual({
      operation: "delete",
      items: ["part-1"],
      archive: true,
      reason: "Delete imported test jobs",
      cleanupAction: "deleteTestJobs"
    });
  }, 15000);

  it("accepts archive cleanup mode with a reason", async () => {
    const formData = new FormData();
    formData.append("operation", "delete");
    formData.append("items", "part-1");
    formData.append("archive", "on");
    formData.append("reason", "Imported test data cleanup");

    const result = await validateBulkDeleteForm(formData);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected validation to pass");
    expect(result.data).toEqual({
      operation: "delete",
      items: ["part-1"],
      archive: true,
      reason: "Imported test data cleanup"
    });
  }, 15000);
});

describe("assertPartsBulkDeleteSession", () => {
  it("allows a normal user session", () => {
    expect(() => assertPartsBulkDeleteSession(new Headers())).not.toThrow();
  });

  it("rejects API keys even when their creator is a developer", () => {
    try {
      assertPartsBulkDeleteSession(new Headers({ "carbon-key": "api-key" }));
      throw new Error("Expected an API key to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(403);
    }
  });
});
