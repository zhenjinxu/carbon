import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";

type DeletionArchiveTable = {
  companyId: string;
  entityType: string;
  entityId: string;
  reason: string;
  payload: unknown;
  createdBy: string;
};

type PartsCleanupDatabase = KyselyDatabase & {
  deletionArchive: DeletionArchiveTable;
};

export const MAX_PARTS_BULK_DELETE = 100;

export function normalizePartIds(itemIds: string[]) {
  const normalized = itemIds.map((itemId) => itemId.trim());

  if (normalized.length === 0 || normalized.some((itemId) => itemId === "")) {
    throw new Error("Select at least one part to delete");
  }
  if (normalized.length > MAX_PARTS_BULK_DELETE) {
    throw new Error(`Select at most ${MAX_PARTS_BULK_DELETE} parts to delete`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Duplicate part IDs are not allowed");
  }

  return normalized;
}

export function assertPartsBulkDeleteSession(headers: Headers) {
  if (headers.has("carbon-key")) {
    throw new Response("Parts bulk deletion requires a user session", {
      status: 403
    });
  }
}

export class PartsBulkDeleteAuthorizationError extends Error {}

export class PartsBulkDeleteDependencyError extends Error {}

type ReferencedJobForCleanup = {
  id: string;
  itemId: string;
  status: string;
  quantityComplete: unknown;
  quantityShipped: unknown;
  quantityReceivedToInventory: unknown;
};

const DELETABLE_TEST_JOB_STATUSES = new Set(["Draft", "Planned"]);

export type PartsBulkDeleteDatabase = Kysely<KyselyDatabase>;

function normalizeCleanupReason(reason: string) {
  const normalized = reason.trim();
  if (normalized.length === 0) {
    throw new Error("A reason is required for archived test cleanup deletion");
  }
  return normalized;
}

function formatJobDependencyMessage({
  jobCount,
  jobMakeMethodCount,
  jobMaterialCount
}: {
  jobCount: number;
  jobMakeMethodCount: number;
  jobMaterialCount: number;
}) {
  return `One or more selected parts are already referenced by production jobs (${jobCount} job records, ${jobMakeMethodCount} job method records, ${jobMaterialCount} job material records). Delete the test jobs first, or deactivate the parts instead.`;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function isUnexecutedTestJob(job: ReferencedJobForCleanup) {
  return (
    DELETABLE_TEST_JOB_STATUSES.has(job.status) &&
    numberValue(job.quantityComplete) === 0 &&
    numberValue(job.quantityShipped) === 0 &&
    numberValue(job.quantityReceivedToInventory) === 0
  );
}

async function getReferencedJobsForParts(
  trx: Transaction<KyselyDatabase>,
  input: { itemIds: string[]; companyId: string }
) {
  const jobs = await trx
    .selectFrom("job")
    .select([
      "id",
      "itemId",
      "status",
      "quantityComplete",
      "quantityShipped",
      "quantityReceivedToInventory"
    ])
    .where("itemId", "in", input.itemIds)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .execute();
  const jobMakeMethods = await trx
    .selectFrom("jobMakeMethod")
    .selectAll()
    .where("itemId", "in", input.itemIds)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .execute();
  const jobMaterials = await trx
    .selectFrom("jobMaterial")
    .selectAll()
    .where("itemId", "in", input.itemIds)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .execute();

  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const missingJobIds = Array.from(
    new Set(
      [...jobMakeMethods, ...jobMaterials]
        .map((reference) => reference.jobId)
        .filter((jobId) => !jobsById.has(jobId))
    )
  );

  if (missingJobIds.length > 0) {
    const jobsFromMethods = await trx
      .selectFrom("job")
      .select([
        "id",
        "itemId",
        "status",
        "quantityComplete",
        "quantityShipped",
        "quantityReceivedToInventory"
      ])
      .where("id", "in", missingJobIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    for (const job of jobsFromMethods) {
      jobsById.set(job.id, job);
    }
  }

  return {
    jobs: Array.from(jobsById.values()) as ReferencedJobForCleanup[],
    jobMakeMethods,
    jobMaterials
  };
}

async function assertPartsAreNotReferencedByJobs(
  trx: Transaction<KyselyDatabase>,
  input: { itemIds: string[]; companyId: string }
) {
  const references = await getReferencedJobsForParts(trx, input);

  if (
    references.jobs.length > 0 ||
    references.jobMakeMethods.length > 0 ||
    references.jobMaterials.length > 0
  ) {
    throw new PartsBulkDeleteDependencyError(
      formatJobDependencyMessage({
        jobCount: references.jobs.length,
        jobMakeMethodCount: references.jobMakeMethods.length,
        jobMaterialCount: references.jobMaterials.length
      })
    );
  }

  return references;
}

async function deleteReferencedTestJobsForParts(
  trx: Transaction<KyselyDatabase>,
  input: { itemIds: string[]; companyId: string }
) {
  const references = await getReferencedJobsForParts(trx, input);
  if (
    references.jobs.length === 0 &&
    references.jobMakeMethods.length === 0 &&
    references.jobMaterials.length === 0
  ) {
    return references;
  }

  const jobIds = new Set(references.jobs.map((job) => job.id));
  const orphanedMethods = references.jobMakeMethods.filter(
    (method) => !jobIds.has(method.jobId)
  );
  const orphanedMaterials = references.jobMaterials.filter(
    (material) => !jobIds.has(material.jobId)
  );
  if (orphanedMethods.length > 0 || orphanedMaterials.length > 0) {
    throw new PartsBulkDeleteDependencyError(
      "Cannot delete referenced jobs automatically because one or more job method records do not have a matching job in the current company. Deactivate the parts instead."
    );
  }

  const unsafeJobs = references.jobs.filter((job) => !isUnexecutedTestJob(job));
  if (unsafeJobs.length > 0) {
    throw new PartsBulkDeleteDependencyError(
      `Cannot delete referenced jobs automatically because ${unsafeJobs.length} job record(s) are released, in progress, completed, closed, or already have completed/shipped/received quantity. Deactivate the parts instead, or review and delete those jobs manually.`
    );
  }

  const jobIdList = Array.from(jobIds);
  const pickingListLines = await trx
    .selectFrom("pickingListLine")
    .select("jobId")
    .where("jobId", "in", jobIdList)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .execute();
  if (pickingListLines.length > 0) {
    throw new PartsBulkDeleteDependencyError(
      `Cannot delete referenced jobs automatically because ${pickingListLines.length} picking list line(s) already reference them. Deactivate the parts instead, or remove the picking records first.`
    );
  }

  const result = await trx
    .deleteFrom("job")
    .where("id", "in", jobIdList)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();
  if (result.numDeletedRows !== BigInt(jobIdList.length)) {
    throw new Error(
      "Deleted test job rows did not match the archived references"
    );
  }

  return references;
}

export async function bulkDeleteParts(
  db: PartsBulkDeleteDatabase,
  input: {
    itemIds: string[];
    companyId: string;
    sessionUserId: string;
  }
) {
  const itemIds = normalizePartIds(input.itemIds);

  return db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select("developer")
      .where("id", "=", input.sessionUserId)
      .forUpdate()
      .executeTakeFirst();
    if (user?.developer !== true) {
      throw new PartsBulkDeleteAuthorizationError(
        "Parts bulk deletion requires a developer account"
      );
    }

    const selectedParts = await trx
      .selectFrom("item")
      .select("id")
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .forUpdate()
      .execute();
    if (selectedParts.length !== itemIds.length) {
      throw new Error(
        "One or more selected parts do not belong to the current company"
      );
    }

    await assertPartsAreNotReferencedByJobs(trx, {
      itemIds,
      companyId: input.companyId
    });

    const usedInMethodMaterials = await trx
      .selectFrom("methodMaterial")
      .select("itemId")
      .where("itemId", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    if (usedInMethodMaterials.length > 0) {
      throw new Error(
        "One or more selected parts are used in a bill of material and cannot be deleted. Remove them from all BOMs or deactivate the parts instead."
      );
    }

    const itemDelete = await trx
      .deleteFrom("item")
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .executeTakeFirst();
    if (itemDelete.numDeletedRows !== BigInt(itemIds.length)) {
      throw new Error("Deleted rows did not match the requested parts");
    }

    return { deleted: itemIds.length };
  });
}

export async function archiveAndDeletePartsForTestCleanup(
  db: PartsBulkDeleteDatabase,
  input: {
    itemIds: string[];
    companyId: string;
    sessionUserId: string;
    reason: string;
    deleteTestJobs?: boolean;
  }
) {
  const itemIds = normalizePartIds(input.itemIds);
  const reason = normalizeCleanupReason(input.reason);
  const archiveDb = db as unknown as Kysely<PartsCleanupDatabase>;

  return archiveDb.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select("developer")
      .where("id", "=", input.sessionUserId)
      .forUpdate()
      .executeTakeFirst();
    if (user?.developer !== true) {
      throw new PartsBulkDeleteAuthorizationError(
        "Parts bulk deletion requires a developer account"
      );
    }

    const selectedParts = await trx
      .selectFrom("item")
      .selectAll()
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .forUpdate()
      .execute();
    if (selectedParts.length !== itemIds.length) {
      throw new Error(
        "One or more selected parts do not belong to the current company"
      );
    }

    const jobReferences =
      input.deleteTestJobs === true
        ? await deleteReferencedTestJobsForParts(
            trx as unknown as Transaction<KyselyDatabase>,
            {
              itemIds,
              companyId: input.companyId
            }
          )
        : await assertPartsAreNotReferencedByJobs(
            trx as unknown as Transaction<KyselyDatabase>,
            {
              itemIds,
              companyId: input.companyId
            }
          );

    const methodMaterials = await trx
      .selectFrom("methodMaterial")
      .selectAll()
      .where("itemId", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    const partReadableIds = selectedParts.map((item) => item.readableId);
    const partSnapshots = await trx
      .selectFrom("part")
      .selectAll()
      .where("id", "in", partReadableIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    const partSnapshotByReadableId = new Map(
      partSnapshots.map((part) => [part.id, part])
    );

    await trx
      .insertInto("deletionArchive")
      .values(
        selectedParts.map((item) => ({
          companyId: input.companyId,
          entityType: "Part",
          entityId: item.id,
          reason,
          payload: {
            action: "delete",
            item,
            part: partSnapshotByReadableId.get(item.readableId) ?? null,
            methodMaterials: methodMaterials.filter(
              (methodMaterial) => methodMaterial.itemId === item.id
            ),
            testJobs: jobReferences.jobs.filter(
              (job) =>
                job.itemId === item.id ||
                jobReferences.jobMakeMethods.some(
                  (method) =>
                    method.itemId === item.id && method.jobId === job.id
                )
            ),
            testJobMakeMethods: jobReferences.jobMakeMethods.filter(
              (method) => method.itemId === item.id
            ),
            testJobMaterials: jobReferences.jobMaterials.filter(
              (material) => material.itemId === item.id
            )
          },
          createdBy: input.sessionUserId
        }))
      )
      .execute();

    if (methodMaterials.length > 0) {
      const methodMaterialDelete = await trx
        .deleteFrom("methodMaterial")
        .where("itemId", "in", itemIds)
        .where("companyId", "=", input.companyId)
        .executeTakeFirst();
      if (
        methodMaterialDelete.numDeletedRows !== BigInt(methodMaterials.length)
      ) {
        throw new Error(
          "Deleted BOM material rows did not match the archived references"
        );
      }
    }

    const itemDelete = await trx
      .deleteFrom("item")
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .executeTakeFirst();
    if (itemDelete.numDeletedRows !== BigInt(itemIds.length)) {
      throw new Error("Deleted rows did not match the requested parts");
    }

    const result = { archived: selectedParts.length, deleted: itemIds.length };
    return input.deleteTestJobs === true
      ? { ...result, deletedTestJobs: jobReferences.jobs.length }
      : result;
  });
}

export async function archiveAndDeactivatePartsForTestCleanup(
  db: PartsBulkDeleteDatabase,
  input: {
    itemIds: string[];
    companyId: string;
    sessionUserId: string;
    reason: string;
  }
) {
  const itemIds = normalizePartIds(input.itemIds);
  const reason = normalizeCleanupReason(input.reason);
  const archiveDb = db as unknown as Kysely<PartsCleanupDatabase>;

  return archiveDb.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select("developer")
      .where("id", "=", input.sessionUserId)
      .forUpdate()
      .executeTakeFirst();
    if (user?.developer !== true) {
      throw new PartsBulkDeleteAuthorizationError(
        "Parts bulk deletion requires a developer account"
      );
    }

    const selectedParts = await trx
      .selectFrom("item")
      .selectAll()
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .forUpdate()
      .execute();
    if (selectedParts.length !== itemIds.length) {
      throw new Error(
        "One or more selected parts do not belong to the current company"
      );
    }

    const methodMaterials = await trx
      .selectFrom("methodMaterial")
      .selectAll()
      .where("itemId", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    const partReadableIds = selectedParts.map((item) => item.readableId);
    const partSnapshots = await trx
      .selectFrom("part")
      .selectAll()
      .where("id", "in", partReadableIds)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .execute();
    const partSnapshotByReadableId = new Map(
      partSnapshots.map((part) => [part.id, part])
    );
    const jobReferences = await getReferencedJobsForParts(
      trx as unknown as Transaction<KyselyDatabase>,
      {
        itemIds,
        companyId: input.companyId
      }
    );

    await trx
      .insertInto("deletionArchive")
      .values(
        selectedParts.map((item) => ({
          companyId: input.companyId,
          entityType: "Part",
          entityId: item.id,
          reason,
          payload: {
            action: "deactivate",
            item,
            part: partSnapshotByReadableId.get(item.readableId) ?? null,
            methodMaterials: methodMaterials.filter(
              (methodMaterial) => methodMaterial.itemId === item.id
            ),
            jobReferences: {
              jobs: jobReferences.jobs.filter(
                (job) =>
                  job.itemId === item.id ||
                  jobReferences.jobMakeMethods.some(
                    (method) =>
                      method.itemId === item.id && method.jobId === job.id
                  )
              ),
              jobMakeMethods: jobReferences.jobMakeMethods.filter(
                (method) => method.itemId === item.id
              ),
              jobMaterials: jobReferences.jobMaterials.filter(
                (material) => material.itemId === item.id
              )
            }
          },
          createdBy: input.sessionUserId
        }))
      )
      .execute();

    const result = await trx
      .updateTable("item")
      .set({
        active: false,
        updatedBy: input.sessionUserId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "in", itemIds)
      .where("companyId", "=", input.companyId)
      .where("type", "=", "Part")
      .executeTakeFirst();
    if (result.numUpdatedRows !== BigInt(itemIds.length)) {
      throw new Error("Deactivated rows did not match the requested parts");
    }

    return { archived: selectedParts.length, deactivated: itemIds.length };
  });
}
