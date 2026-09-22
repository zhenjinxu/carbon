import { describe, expect, it } from "vitest";

type ItemRecord = {
  id: string;
  companyId: string;
  type: string;
  active?: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
  readableId?: string;
};
type PartRecord = {
  id: string;
  companyId: string;
  createdBy?: string;
  approved?: boolean;
  customFields?: unknown;
};
type MethodMaterialRecord = { id: string; itemId: string; companyId: string };
type JobReferenceRecord = {
  id: string;
  itemId: string;
  companyId: string;
  jobId?: string;
  status?: string;
  quantityComplete?: number;
  quantityShipped?: number;
  quantityReceivedToInventory?: number;
};
type JobMaterialRecord = {
  id: string;
  jobId: string;
  itemId: string;
  companyId: string;
};
type DeletionArchiveRecord = {
  companyId: string;
  entityType: string;
  entityId: string;
  reason: string;
  payload: unknown;
  createdBy: string;
};

function createDatabase({
  developer = true,
  items,
  parts = [],
  methodMaterials = [],
  jobs = [],
  jobMakeMethods = [],
  jobMaterials = [],
  reportedDeletedRows
}: {
  developer?: boolean;
  items: ItemRecord[];
  parts?: PartRecord[];
  methodMaterials?: MethodMaterialRecord[];
  jobs?: JobReferenceRecord[];
  jobMakeMethods?: JobReferenceRecord[];
  jobMaterials?: JobMaterialRecord[];
  reportedDeletedRows?: bigint;
}) {
  let storedItems = structuredClone(items);
  let storedParts = structuredClone(parts);
  let storedMethodMaterials = structuredClone(methodMaterials);
  let storedJobs = structuredClone(jobs);
  let storedJobMakeMethods = structuredClone(jobMakeMethods);
  let storedJobMaterials = structuredClone(jobMaterials);
  let storedDeletionArchives: DeletionArchiveRecord[] = [];
  const matches = (
    row: Record<string, unknown>,
    filters: [string, string, unknown][]
  ) =>
    filters.every(([column, operator, value]) =>
      operator === "in"
        ? (value as unknown[]).includes(row[column])
        : row[column] === value
    );

  const transaction = {
    execute: async (callback: (trx: any) => Promise<unknown>) => {
      const snapshot = {
        items: structuredClone(storedItems),
        parts: structuredClone(storedParts),
        methodMaterials: structuredClone(storedMethodMaterials),
        jobs: structuredClone(storedJobs),
        jobMakeMethods: structuredClone(storedJobMakeMethods),
        jobMaterials: structuredClone(storedJobMaterials),
        deletionArchives: structuredClone(storedDeletionArchives)
      };
      const trx = {
        selectFrom: (table: string) => {
          const filters: [string, string, unknown][] = [];
          let selectAllRequested = false;
          const builder = {
            select: () => builder,
            selectAll: () => {
              selectAllRequested = true;
              return builder;
            },
            where: (column: string, operator: string, value: unknown) => {
              filters.push([column, operator, value]);
              return builder;
            },
            forUpdate: () => builder,
            executeTakeFirst: async () =>
              table === "user" &&
              matches({ id: "developer-user", developer }, filters)
                ? { developer }
                : undefined,
            execute: async () => {
              if (table === "item") {
                const rows = storedItems.filter((row) => matches(row, filters));
                return selectAllRequested
                  ? rows
                  : rows.map(({ id }) => ({ id }));
              }
              if (table === "part") {
                return storedParts.filter((row) => matches(row, filters));
              }
              if (table === "methodMaterial") {
                const rows = storedMethodMaterials.filter((row) =>
                  matches(row, filters)
                );
                return selectAllRequested
                  ? rows
                  : rows.map(({ itemId }) => ({ itemId }));
              }
              if (table === "job") {
                return storedJobs.filter((row) => matches(row, filters));
              }
              if (table === "jobMakeMethod") {
                return storedJobMakeMethods.filter((row) =>
                  matches(row, filters)
                );
              }
              if (table === "jobMaterial") {
                return storedJobMaterials.filter((row) =>
                  matches(row, filters)
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
              if (table !== "item") return { numUpdatedRows: BigInt(0) };
              const updated = storedItems.filter((row) =>
                matches(row, filters)
              );
              storedItems = storedItems.map((row) =>
                matches(row, filters) ? { ...row, ...update } : row
              );
              return { numUpdatedRows: BigInt(updated.length) };
            }
          };
          return builder;
        },
        insertInto: (table: string) => {
          const builder = {
            values: (values: DeletionArchiveRecord[]) => {
              if (table === "deletionArchive") {
                storedDeletionArchives.push(...structuredClone(values));
              }
              return builder;
            },
            execute: async () => []
          };
          return builder;
        },
        deleteFrom: (table: string) => {
          const filters: [string, string, unknown][] = [];
          const builder = {
            where: (column: string, operator: string, value: unknown) => {
              filters.push([column, operator, value]);
              return builder;
            },
            executeTakeFirst: async () => {
              const source =
                table === "methodMaterial"
                  ? storedMethodMaterials
                  : table === "job"
                    ? storedJobs
                    : table === "jobMakeMethod"
                      ? storedJobMakeMethods
                      : table === "jobMaterial"
                        ? storedJobMaterials
                        : storedItems;
              const deleted = source.filter((row) => matches(row, filters));
              if (table === "part") {
                return storedParts.filter((row) => matches(row, filters));
              }
              if (table === "methodMaterial") {
                storedMethodMaterials = storedMethodMaterials.filter(
                  (row) => !matches(row, filters)
                );
              } else if (table === "job") {
                const deletedJobIds = new Set(deleted.map((job) => job.id));
                storedJobs = storedJobs.filter((row) => !matches(row, filters));
                storedJobMakeMethods = storedJobMakeMethods.filter(
                  (row) => !deletedJobIds.has(row.jobId ?? "")
                );
                storedJobMaterials = storedJobMaterials.filter(
                  (row) => !deletedJobIds.has(row.jobId)
                );
              } else if (table === "jobMakeMethod") {
                storedJobMakeMethods = storedJobMakeMethods.filter(
                  (row) => !matches(row, filters)
                );
              } else if (table === "jobMaterial") {
                storedJobMaterials = storedJobMaterials.filter(
                  (row) => !matches(row, filters)
                );
              } else {
                storedItems = storedItems.filter(
                  (row) => !matches(row, filters)
                );
              }
              return {
                numDeletedRows: reportedDeletedRows ?? BigInt(deleted.length)
              };
            }
          };
          return builder;
        }
      };

      try {
        return await callback(trx);
      } catch (error) {
        storedItems = snapshot.items;
        storedParts = snapshot.parts;
        storedMethodMaterials = snapshot.methodMaterials;
        storedJobs = snapshot.jobs;
        storedJobMakeMethods = snapshot.jobMakeMethods;
        storedJobMaterials = snapshot.jobMaterials;
        storedDeletionArchives = snapshot.deletionArchives;
        throw error;
      }
    }
  };

  return {
    db: { transaction: () => transaction },
    getItems: () => storedItems,
    getParts: () => storedParts,
    getMethodMaterials: () => storedMethodMaterials,
    getJobs: () => storedJobs,
    getJobMakeMethods: () => storedJobMakeMethods,
    getJobMaterials: () => storedJobMaterials,
    getDeletionArchives: () => storedDeletionArchives
  };
}

describe("bulkDeleteParts transaction", () => {
  it("requires the live session user to be a developer", async () => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      developer: false,
      items: [{ id: "part-1", companyId: "company-a", type: "Part" }]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/developer/i);
    expect(database.getItems()).toHaveLength(1);
  });

  it.each([
    ["another company", { id: "part-2", companyId: "company-b", type: "Part" }],
    [
      "another item type",
      { id: "part-2", companyId: "company-a", type: "Tool" }
    ]
  ])("rolls back when a selected item belongs to %s", async (_case, invalid) => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      items: [{ id: "part-1", companyId: "company-a", type: "Part" }, invalid]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1", "part-2"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/selected parts/i);
    expect(database.getItems()).toHaveLength(2);
  });

  it("deletes every selected part in one transaction", async () => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" },
        { id: "part-3", companyId: "company-a", type: "Part" }
      ]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1", "part-2"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).resolves.toEqual({ deleted: 2 });
    expect(database.getItems()).toEqual([
      { id: "part-3", companyId: "company-a", type: "Part" }
    ]);
  });

  it("rejects selected parts that are still used in production jobs", async () => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      jobs: [{ id: "job-1", itemId: "part-1", companyId: "company-a" }],
      jobMakeMethods: [
        { id: "job-method-1", itemId: "part-1", companyId: "company-a" }
      ]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1", "part-2"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/production jobs/i);
    expect(database.getItems()).toHaveLength(2);
  });
  it("rejects selected parts that are still used in method materials", async () => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      methodMaterials: [
        { id: "method-material-1", itemId: "part-1", companyId: "company-a" }
      ]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1", "part-2"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/used in a bill of material/i);
    expect(database.getItems()).toHaveLength(2);
    expect(database.getMethodMaterials()).toHaveLength(1);
  });

  it("rolls back when the database reports a partial delete", async () => {
    const { bulkDeleteParts } = await import("./parts-bulk-delete.server");
    const database = createDatabase({
      reportedDeletedRows: BigInt(1),
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ]
    });

    await expect(
      bulkDeleteParts(database.db as never, {
        itemIds: ["part-1", "part-2"],
        companyId: "company-a",
        sessionUserId: "developer-user"
      })
    ).rejects.toThrow(/deleted rows/i);
    expect(database.getItems()).toHaveLength(2);
  });

  it("archives and deletes BOM material references during test cleanup", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      methodMaterials: [
        { id: "method-material-1", itemId: "part-1", companyId: "company-a" }
      ]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Imported test BOM with wrong component"
      })
    ).resolves.toEqual({ archived: 1, deleted: 1 });
    expect(database.getItems()).toEqual([
      { id: "part-2", companyId: "company-a", type: "Part" }
    ]);
    expect(database.getMethodMaterials()).toEqual([]);
    expect(database.getDeletionArchives()).toEqual([
      expect.objectContaining({
        companyId: "company-a",
        entityType: "Part",
        entityId: "part-1",
        reason: "Imported test BOM with wrong component",
        createdBy: "developer-user",
        payload: expect.objectContaining({
          action: "delete",
          item: { id: "part-1", companyId: "company-a", type: "Part" },
          methodMaterials: [
            {
              id: "method-material-1",
              itemId: "part-1",
              companyId: "company-a"
            }
          ]
        })
      })
    ]);
  });

  it("does not archive or delete selected parts that have production job references", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      methodMaterials: [
        { id: "method-material-1", itemId: "part-1", companyId: "company-a" }
      ],
      jobs: [{ id: "job-1", itemId: "part-1", companyId: "company-a" }]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Imported test job with wrong item"
      })
    ).rejects.toThrow(/production jobs/i);
    expect(database.getItems()).toHaveLength(2);
    expect(database.getMethodMaterials()).toHaveLength(1);
    expect(database.getDeletionArchives()).toHaveLength(0);
  });
  it("archives and deactivates selected parts while preserving references", async () => {
    const { archiveAndDeactivatePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [
        {
          id: "part-1",
          companyId: "company-a",
          type: "Part",
          active: true,
          readableId: "146001011101"
        },
        { id: "part-2", companyId: "company-a", type: "Part", active: true }
      ],
      parts: [
        {
          id: "146001011101",
          companyId: "company-a",
          createdBy: "developer-user",
          approved: true,
          customFields: { source: "archive-test" }
        }
      ],
      methodMaterials: [
        { id: "method-material-1", itemId: "part-1", companyId: "company-a" }
      ],
      jobs: [
        {
          id: "job-1",
          itemId: "part-1",
          companyId: "company-a",
          status: "Ready",
          quantityComplete: 0,
          quantityShipped: 0,
          quantityReceivedToInventory: 0
        }
      ]
    });

    await expect(
      archiveAndDeactivatePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Keep production references during cleanup"
      })
    ).resolves.toEqual({ archived: 1, deactivated: 1 });
    expect(database.getItems()).toEqual([
      expect.objectContaining({
        id: "part-1",
        active: false,
        updatedBy: "developer-user"
      }),
      { id: "part-2", companyId: "company-a", type: "Part", active: true }
    ]);
    expect(database.getMethodMaterials()).toHaveLength(1);
    expect(database.getJobs()).toHaveLength(1);
    expect(database.getDeletionArchives()[0]).toEqual(
      expect.objectContaining({
        entityType: "Part",
        entityId: "part-1",
        payload: expect.objectContaining({
          action: "deactivate",
          item: expect.objectContaining({ id: "part-1", active: true }),
          part: expect.objectContaining({
            id: "146001011101",
            customFields: { source: "archive-test" }
          })
        })
      })
    );
  });

  it("archives and deletes unexecuted test jobs before deleting selected parts", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      methodMaterials: [
        { id: "method-material-1", itemId: "part-1", companyId: "company-a" }
      ],
      jobs: [
        {
          id: "job-1",
          itemId: "part-1",
          companyId: "company-a",
          status: "Draft",
          quantityComplete: 0,
          quantityShipped: 0,
          quantityReceivedToInventory: 0
        }
      ],
      jobMakeMethods: [
        {
          id: "job-method-1",
          jobId: "job-1",
          itemId: "part-1",
          companyId: "company-a"
        }
      ]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Delete imported test job",
        deleteTestJobs: true
      })
    ).resolves.toEqual({
      archived: 1,
      deleted: 1,
      deletedTestJobs: 1
    });
    expect(database.getItems()).toEqual([
      { id: "part-2", companyId: "company-a", type: "Part" }
    ]);
    expect(database.getJobs()).toEqual([]);
    expect(database.getJobMakeMethods()).toEqual([]);
    expect(database.getDeletionArchives()[0]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: "delete",
          testJobs: [expect.objectContaining({ id: "job-1" })],
          testJobMakeMethods: [expect.objectContaining({ id: "job-method-1" })]
        })
      })
    );
  });

  it("archives and deletes unexecuted test jobs that use selected parts as materials", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [
        { id: "part-1", companyId: "company-a", type: "Part" },
        { id: "part-2", companyId: "company-a", type: "Part" }
      ],
      jobs: [
        {
          id: "job-1",
          itemId: "assembly-1",
          companyId: "company-a",
          status: "Planned",
          quantityComplete: 0,
          quantityShipped: 0,
          quantityReceivedToInventory: 0
        }
      ],
      jobMaterials: [
        {
          id: "job-material-1",
          jobId: "job-1",
          itemId: "part-1",
          companyId: "company-a"
        }
      ]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Delete material-only test job reference",
        deleteTestJobs: true
      })
    ).resolves.toEqual({
      archived: 1,
      deleted: 1,
      deletedTestJobs: 1
    });
    expect(database.getItems()).toEqual([
      { id: "part-2", companyId: "company-a", type: "Part" }
    ]);
    expect(database.getJobs()).toEqual([]);
    expect(database.getJobMaterials()).toEqual([]);
    expect(database.getDeletionArchives()[0]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          testJobMaterials: [expect.objectContaining({ id: "job-material-1" })]
        })
      })
    );
  });

  it("does not delete executed jobs even when test job cleanup is requested", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [{ id: "part-1", companyId: "company-a", type: "Part" }],
      jobs: [
        {
          id: "job-1",
          itemId: "part-1",
          companyId: "company-a",
          status: "In Progress",
          quantityComplete: 1,
          quantityShipped: 0,
          quantityReceivedToInventory: 0
        }
      ]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: "Should not delete executed jobs",
        deleteTestJobs: true
      })
    ).rejects.toThrow(/cannot delete referenced jobs/i);
    expect(database.getItems()).toHaveLength(1);
    expect(database.getJobs()).toHaveLength(1);
    expect(database.getDeletionArchives()).toHaveLength(0);
  });

  it("requires a reason for archived test cleanup deletion", async () => {
    const { archiveAndDeletePartsForTestCleanup } = await import(
      "./parts-bulk-delete.server"
    );
    const database = createDatabase({
      items: [{ id: "part-1", companyId: "company-a", type: "Part" }]
    });

    await expect(
      archiveAndDeletePartsForTestCleanup(database.db as never, {
        itemIds: ["part-1"],
        companyId: "company-a",
        sessionUserId: "developer-user",
        reason: " "
      })
    ).rejects.toThrow(/reason/i);
    expect(database.getItems()).toHaveLength(1);
    expect(database.getDeletionArchives()).toHaveLength(0);
  });
});
