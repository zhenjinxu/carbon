import { describe, expect, it } from "vitest";

type ItemRecord = {
  id: string;
  companyId: string;
  type: string;
  active?: boolean;
  createdBy?: string;
  name?: string;
  readableId?: string;
  itemTrackingType?: string;
};

type PartRecord = {
  id: string;
  companyId: string;
  createdBy?: string;
  approved?: boolean;
  customFields?: unknown;
  tags?: string[] | null;
};

type MethodMaterialRecord = {
  id: string;
  itemId: string;
  companyId: string;
  makeMethodId?: string;
  materialMakeMethodId?: string | null;
  methodType?: string;
  quantity?: number;
  unitOfMeasureCode?: string;
  createdBy?: string;
};

type MakeMethodRecord = {
  id: string;
  itemId: string;
  companyId: string;
  status?: string;
  version?: number;
  createdBy?: string;
};

type DeletionArchiveRecord = {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  reason: string;
  payload: unknown;
  restoredAt: string | null;
  restoredBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

function createArchiveDatabase({
  developer = true,
  items = [],
  parts = [],
  methodMaterials = [],
  makeMethods = [],
  archives = []
}: {
  developer?: boolean;
  items?: ItemRecord[];
  parts?: PartRecord[];
  methodMaterials?: MethodMaterialRecord[];
  makeMethods?: MakeMethodRecord[];
  archives?: DeletionArchiveRecord[];
}) {
  let storedItems = structuredClone(items);
  let storedParts = structuredClone(parts);
  let storedMethodMaterials = structuredClone(methodMaterials);
  let storedMakeMethods = structuredClone(makeMethods);
  let storedArchives = structuredClone(archives);

  const matches = (
    row: Record<string, unknown>,
    filters: [string, string, unknown][]
  ) =>
    filters.every(([column, operator, value]) => {
      if (operator === "in") return (value as unknown[]).includes(row[column]);
      if (operator === "is") return row[column] === value;
      return row[column] === value;
    });

  const activeMakeMethods = () => {
    const sorted = [...storedMakeMethods]
      .filter((row) => row.status !== "Archived")
      .sort((left, right) => {
        const leftStatusRank = left.status === "Active" ? 0 : 1;
        const rightStatusRank = right.status === "Active" ? 0 : 1;
        if (leftStatusRank !== rightStatusRank) {
          return leftStatusRank - rightStatusRank;
        }
        return Number(right.version ?? 1) - Number(left.version ?? 1);
      });
    const seen = new Set<string>();
    return sorted.filter((row) => {
      const key = `${row.companyId}:${row.itemId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const tableRows = (table: string) => {
    if (table === "item") return storedItems;
    if (table === "part") return storedParts;
    if (table === "methodMaterial") return storedMethodMaterials;
    if (table === "makeMethod") return storedMakeMethods;
    if (table === "activeMakeMethods") return activeMakeMethods();
    if (table === "deletionArchive") return storedArchives;
    return [];
  };

  const makeDb = () => ({
    selectFrom: (table: string) => {
      const filters: [string, string, unknown][] = [];
      let countMode = false;
      let rowLimit: number | undefined;
      let rowOffset = 0;
      const builder = {
        select: (selection?: unknown) => {
          countMode = typeof selection === "function";
          return builder;
        },
        selectAll: () => builder,
        where: (column: string, operator: string, value: unknown) => {
          filters.push([column, operator, value]);
          return builder;
        },
        orderBy: () => builder,
        limit: (limit: number) => {
          rowLimit = limit;
          return builder;
        },
        offset: (offset: number) => {
          rowOffset = offset;
          return builder;
        },
        forUpdate: () => builder,
        executeTakeFirst: async () => {
          if (table === "user") {
            return matches({ id: "developer-user", developer }, filters)
              ? { developer }
              : undefined;
          }
          const rows = tableRows(table).filter((row) => matches(row, filters));
          if (countMode) return { count: BigInt(rows.length) };
          return rows[0];
        },
        execute: async () => {
          const rows = tableRows(table)
            .filter((row) => matches(row, filters))
            .slice(rowOffset, rowLimit ? rowOffset + rowLimit : undefined);
          return structuredClone(rows);
        }
      };
      return builder;
    },
    insertInto: (table: string) => {
      let pendingValues: Record<string, unknown>[] = [];
      const builder = {
        values: (
          values: Record<string, unknown> | Record<string, unknown>[]
        ) => {
          pendingValues = Array.isArray(values) ? values : [values];
          return builder;
        },
        execute: async () => {
          if (table === "item") {
            for (const item of pendingValues) {
              if (storedItems.some((row) => row.id === item.id)) {
                throw new Error("duplicate item");
              }
              if (
                Object.prototype.hasOwnProperty.call(
                  item,
                  "readableIdWithRevision"
                )
              ) {
                throw new Error(
                  'cannot insert a non-DEFAULT value into column "readableIdWithRevision"'
                );
              }
            }
            storedItems.push(
              ...(structuredClone(pendingValues) as ItemRecord[])
            );
            for (const item of pendingValues) {
              if (
                (item.type === "Part" || item.type === "Tool") &&
                typeof item.id === "string" &&
                typeof item.companyId === "string" &&
                !storedMakeMethods.some(
                  (row) =>
                    row.itemId === item.id && row.companyId === item.companyId
                )
              ) {
                storedMakeMethods.push({
                  id: `generated-method-${item.id}`,
                  itemId: item.id,
                  companyId: item.companyId,
                  status: "Draft",
                  version: 1,
                  createdBy:
                    typeof item.createdBy === "string"
                      ? item.createdBy
                      : undefined
                });
              }
            }
          }
          if (table === "part") {
            for (const part of pendingValues) {
              if (
                storedParts.some(
                  (row) =>
                    row.id === part.id && row.companyId === part.companyId
                )
              ) {
                throw new Error("duplicate part");
              }
            }
            storedParts.push(
              ...(structuredClone(pendingValues) as PartRecord[])
            );
          }
          if (table === "methodMaterial") {
            for (const methodMaterial of pendingValues) {
              if (
                Object.prototype.hasOwnProperty.call(
                  methodMaterial,
                  "productionQuantity"
                )
              ) {
                throw new Error(
                  'cannot insert a non-DEFAULT value into column "productionQuantity"'
                );
              }
              if (
                typeof methodMaterial.materialMakeMethodId === "string" &&
                !storedMakeMethods.some(
                  (row) =>
                    row.id === methodMaterial.materialMakeMethodId &&
                    row.companyId === methodMaterial.companyId
                )
              ) {
                throw new Error(
                  'insert or update on table "methodMaterial" violates foreign key constraint "methodMaterial_materialMakeMethodId_fkey"'
                );
              }
            }
            storedMethodMaterials.push(
              ...(structuredClone(pendingValues) as MethodMaterialRecord[])
            );
          }
          return [];
        }
      };
      return builder;
    },
    updateTable: (table: string) => {
      const filters: [string, string, unknown][] = [];
      let update: Record<string, unknown> = {};
      const builder = {
        set: (value: Record<string, unknown>) => {
          update = value;
          return builder;
        },
        where: (column: string, operator: string, value: unknown) => {
          filters.push([column, operator, value]);
          return builder;
        },
        executeTakeFirst: async () => {
          if (table === "item") {
            const updated = storedItems.filter((row) => matches(row, filters));
            storedItems = storedItems.map((row) =>
              matches(row, filters) ? { ...row, ...update } : row
            );
            return { numUpdatedRows: BigInt(updated.length) };
          }
          if (table === "part") {
            const updated = storedParts.filter((row) => matches(row, filters));
            storedParts = storedParts.map((row) =>
              matches(row, filters) ? { ...row, ...update } : row
            );
            return { numUpdatedRows: BigInt(updated.length) };
          }
          if (table === "deletionArchive") {
            const updated = storedArchives.filter((row) =>
              matches(row, filters)
            );
            storedArchives = storedArchives.map((row) =>
              matches(row, filters) ? { ...row, ...update } : row
            );
            return { numUpdatedRows: BigInt(updated.length) };
          }
          return { numUpdatedRows: BigInt(0) };
        }
      };
      return builder;
    }
  });

  const transaction = {
    execute: async (
      callback: (trx: ReturnType<typeof makeDb>) => Promise<unknown>
    ) => {
      const snapshot = {
        items: structuredClone(storedItems),
        parts: structuredClone(storedParts),
        methodMaterials: structuredClone(storedMethodMaterials),
        makeMethods: structuredClone(storedMakeMethods),
        archives: structuredClone(storedArchives)
      };
      try {
        return await callback(makeDb());
      } catch (error) {
        storedItems = snapshot.items;
        storedParts = snapshot.parts;
        storedMethodMaterials = snapshot.methodMaterials;
        storedMakeMethods = snapshot.makeMethods;
        storedArchives = snapshot.archives;
        throw error;
      }
    }
  };

  return {
    db: { ...makeDb(), transaction: () => transaction },
    getItems: () => storedItems,
    getParts: () => storedParts,
    getMethodMaterials: () => storedMethodMaterials,
    getMakeMethods: () => storedMakeMethods,
    getArchives: () => storedArchives
  };
}

const activePartArchive = {
  id: "archive-1",
  companyId: "company-a",
  entityType: "Part",
  entityId: "part-1",
  reason: "测试清理",
  restoredAt: null,
  restoredBy: null,
  createdBy: "developer-user",
  createdAt: "2026-08-13T10:00:00.000Z",
  payload: {
    action: "deactivate",
    item: {
      id: "part-1",
      companyId: "company-a",
      type: "Part",
      active: true,
      createdBy: "developer-user",
      name: "端部护罩",
      readableId: "146001011101",
      itemTrackingType: "Inventory"
    }
  }
} satisfies DeletionArchiveRecord;

describe("normalizeDeletionArchiveIds", () => {
  it("rejects duplicate archive IDs", async () => {
    const { normalizeDeletionArchiveIds } = await import(
      "./deletion-archive.server"
    );

    expect(() =>
      normalizeDeletionArchiveIds(["archive-1", "archive-1"])
    ).toThrow(/Duplicate archive IDs are not allowed/);
  });
});

describe("getDeletionArchives", () => {
  it("lists only active archive rows scoped by company and type", async () => {
    const { getDeletionArchives } = await import("./deletion-archive.server");
    const database = createArchiveDatabase({
      archives: [
        activePartArchive,
        { ...activePartArchive, id: "archive-2", companyId: "company-b" },
        {
          ...activePartArchive,
          id: "archive-3",
          entityType: "Tool",
          entityId: "tool-1"
        },
        {
          ...activePartArchive,
          id: "archive-4",
          restoredAt: "2026-08-13T11:00:00.000Z"
        }
      ]
    });

    const result = await getDeletionArchives(database.db as never, {
      companyId: "company-a",
      entityType: "Part",
      limit: 20,
      offset: 0
    });

    expect(result.count).toBe(1);
    expect(result.data).toMatchObject([
      {
        id: "archive-1",
        entityType: "Part",
        readableId: "146001011101",
        name: "端部护罩",
        action: "deactivate"
      }
    ]);
  });

  it("classifies legacy delete archive rows without an action flag", async () => {
    const { getDeletionArchives } = await import("./deletion-archive.server");
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            item: activePartArchive.payload.item,
            methodMaterials: []
          }
        }
      ]
    });

    const result = await getDeletionArchives(database.db as never, {
      companyId: "company-a",
      entityType: "Part",
      limit: 20,
      offset: 0
    });

    expect(result.data).toMatchObject([
      {
        id: "archive-1",
        action: "delete",
        actionLabel: "删除归档"
      }
    ]);
  });
});

describe("restoreDeletionArchives", () => {
  it("restores deactivated items and marks archive rows restored atomically", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part", active: false }
      ],
      archives: [activePartArchive]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getItems()[0]).toMatchObject({
      active: true,
      updatedBy: "developer-user"
    });
    expect(database.getArchives()[0]).toMatchObject({
      restoredBy: "developer-user"
    });
    expect(database.getArchives()[0].restoredAt).toEqual(expect.any(String));
  });

  it("restores deleted item snapshots, part metadata, and archived BOM references", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            action: "delete",
            item: activePartArchive.payload.item,
            part: {
              id: "146001011101",
              companyId: "company-a",
              createdBy: "developer-user",
              approved: true,
              customFields: { restored: true },
              tags: ["cleanup"]
            },
            methodMaterials: [
              {
                id: "mm-1",
                itemId: "part-1",
                companyId: "company-a",
                makeMethodId: "method-1",
                quantity: 2,
                unitOfMeasureCode: "EA",
                createdBy: "developer-user"
              }
            ]
          }
        }
      ]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getItems()).toHaveLength(1);
    expect(database.getParts()).toMatchObject([
      {
        id: "146001011101",
        companyId: "company-a",
        approved: true,
        customFields: { restored: true },
        tags: ["cleanup"]
      }
    ]);
    expect(database.getMethodMaterials()).toMatchObject([
      { id: "mm-1", itemId: "part-1", companyId: "company-a" }
    ]);
  });

  it("does not restore generated readableIdWithRevision into item inserts", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            action: "delete",
            item: {
              ...activePartArchive.payload.item,
              readableIdWithRevision: "146001011101"
            },
            methodMaterials: []
          }
        }
      ]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getItems()).toHaveLength(1);
    expect(database.getItems()[0]).not.toHaveProperty("readableIdWithRevision");
  });
  it("does not restore generated productionQuantity into method material inserts", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            action: "delete",
            item: activePartArchive.payload.item,
            methodMaterials: [
              {
                id: "mm-generated-1",
                itemId: "part-1",
                companyId: "company-a",
                makeMethodId: "method-1",
                quantity: 2,
                scrapQuantity: 1,
                productionQuantity: 3,
                unitOfMeasureCode: "EA",
                createdBy: "developer-user"
              }
            ]
          }
        }
      ]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getMethodMaterials()).toHaveLength(1);
    expect(database.getMethodMaterials()[0]).not.toHaveProperty(
      "productionQuantity"
    );
  });
  it("remaps stale archived material make method IDs to the current item make method", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            action: "delete",
            item: activePartArchive.payload.item,
            methodMaterials: [
              {
                id: "mm-stale-method-1",
                itemId: "part-1",
                companyId: "company-a",
                makeMethodId: "parent-method-1",
                materialMakeMethodId: "deleted-child-method-1",
                methodType: "Make to Order",
                quantity: 2,
                unitOfMeasureCode: "EA",
                createdBy: "developer-user"
              }
            ]
          }
        }
      ]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getMethodMaterials()).toMatchObject([
      {
        id: "mm-stale-method-1",
        materialMakeMethodId: "generated-method-part-1"
      }
    ]);
  });

  it("restores legacy deleted item snapshots without an action flag", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      archives: [
        {
          ...activePartArchive,
          payload: {
            item: activePartArchive.payload.item,
            methodMaterials: [
              {
                id: "legacy-mm-1",
                itemId: "part-1",
                companyId: "company-a",
                makeMethodId: "method-1",
                quantity: 1,
                unitOfMeasureCode: "EA",
                createdBy: "developer-user"
              }
            ]
          }
        }
      ]
    });

    const result = await restoreDeletionArchives(database.db as never, {
      archiveIds: ["archive-1"],
      companyId: "company-a",
      sessionUserId: "developer-user"
    });

    expect(result).toEqual({ restored: 1 });
    expect(database.getItems()).toMatchObject([
      { id: "part-1", companyId: "company-a", type: "Part" }
    ]);
    expect(database.getParts()).toMatchObject([
      { id: "146001011101", companyId: "company-a" }
    ]);
    expect(database.getMethodMaterials()).toMatchObject([
      { id: "legacy-mm-1", itemId: "part-1", companyId: "company-a" }
    ]);
    expect(database.getArchives()[0].restoredBy).toBe("developer-user");
  });

  it("rolls back archive status when restore fails", async () => {
    const { restoreDeletionArchives } = await import(
      "./deletion-archive.server"
    );
    const database = createArchiveDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part", active: true }
      ],
      archives: [
        {
          ...activePartArchive,
          payload: { action: "delete", item: activePartArchive.payload.item }
        }
      ]
    });

    await expect(
      restoreDeletionArchives(database.db as never, {
        archiveIds: ["archive-1"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/already exists/i);

    expect(database.getArchives()[0].restoredAt).toBeNull();
  });
});
