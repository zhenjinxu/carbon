import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

let isCompatibleExistingItem:
  | ((
      existing: Record<string, unknown>,
      source: Record<string, unknown>,
      rootItemIds: Set<string>
    ) => boolean)
  | undefined;

let insertBatch: ((...args: unknown[]) => Promise<void>) | undefined;
let ensureItemRelatedRecords:
  | ((...args: unknown[]) => Promise<unknown>)
  | undefined;
try {
  ({ ensureItemRelatedRecords, insertBatch, isCompatibleExistingItem } = require(
    "../../../scripts/lib/u8-bom-carbon.cjs"
  ));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "MODULE_NOT_FOUND"
  ) {
    throw error;
  }
}

describe("U8 BOM Carbon item identity", () => {
  it("reuses an exact-name WodiMES item but rejects a different item name", () => {
    expect(isCompatibleExistingItem).toBeTypeOf("function");
    if (!isCompatibleExistingItem) return;

    const existing = {
      id: "item-1",
      name: "Pressure transmitter fitting",
      notes: {
        wodiMES: {
          sourceId: "source-1",
          sourceCollection: "mes_proc_order_details"
        }
      }
    };
    const roots = new Set<string>();

    expect(
      isCompatibleExistingItem(
        existing,
        { name: "Pressure transmitter fitting" },
        roots
      )
    ).toBe(true);
    expect(
      isCompatibleExistingItem(existing, { name: "Different part" }, roots)
    ).toBe(false);
  });
  it("adds a conflict-update WHERE clause to suppress no-op writes", async () => {
    expect(insertBatch).toBeTypeOf("function");
    if (!insertBatch) return;

    let capturedSql = "";
    await insertBatch(
      {
        query: async (sql: string) => {
          capturedSql = sql;
        }
      },
      "item",
      ["id", "name"],
      [["item-1", "Part"]],
      '("id")',
      ["name = EXCLUDED.name"],
      "item.name IS DISTINCT FROM EXCLUDED.name"
    );

    expect(capturedSql).toContain(
      "DO UPDATE SET name = EXCLUDED.name " +
        "WHERE item.name IS DISTINCT FROM EXCLUDED.name"
    );
  });

  it("reconciles every standard item baseline idempotently", async () => {
    expect(ensureItemRelatedRecords).toBeTypeOf("function");
    if (!ensureItemRelatedRecords) return;

    const queries: { sql: string; values: unknown[] }[] = [];
    await ensureItemRelatedRecords(
      {
        query: async (sql: string, values: unknown[]) => {
          queries.push({ sql, values });
          return { rowCount: 0 };
        }
      },
      ["item-1", "item-2"],
      "company-1",
      "user-1"
    );

    expect(queries).toHaveLength(4);
    const sql = queries.map((query) => query.sql).join("\n");
    expect(sql).toContain('INSERT INTO "itemCost"');
    expect(sql).toContain('INSERT INTO "itemReplenishment"');
    expect(sql).toContain('INSERT INTO "itemUnitSalePrice"');
    expect(sql).toContain('INSERT INTO "itemPlanning"');
    expect(
      queries.every((query) => query.sql.includes("NOT EXISTS"))
    ).toBe(true);
    expect(
      queries.every((query) =>
        query.values.every((value, index) =>
          index === 0
            ? value === "company-1"
            : index === 1
              ? value === queries[0].values[1]
              : value === "user-1"
        )
      )
    ).toBe(true);
  });
});
