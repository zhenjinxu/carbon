import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import * as aiRoutingDrawingModule from "@carbon/lib/ai-routing-drawing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import {
  type AiRoutingDraft,
  type AiRoutingKnowledgeItem,
  type AiRoutingOperation,
  type AiRoutingSample,
  type AiRoutingTargetEvidence,
  aiRoutingSampleScopeExclusionReasons,
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  routingKnowledgeTags
} from "./ai-routing";
import { parseAiRoutingConfirmedRouteSnapshot } from "./ai-routing-review";

type AiRoutingDrawingModule = typeof import("@carbon/lib/ai-routing-drawing");
type RuntimeAiRoutingDrawingModule = AiRoutingDrawingModule & {
  default?: AiRoutingDrawingModule;
  "module.exports"?: AiRoutingDrawingModule;
};

const runtimeAiRoutingDrawingModule =
  aiRoutingDrawingModule as RuntimeAiRoutingDrawingModule;
const resolvedAiRoutingDrawingModule =
  runtimeAiRoutingDrawingModule.normalizeAiRoutingDrawingExtraction
    ? runtimeAiRoutingDrawingModule
    : (runtimeAiRoutingDrawingModule.default ??
      runtimeAiRoutingDrawingModule["module.exports"]);

if (!resolvedAiRoutingDrawingModule?.normalizeAiRoutingDrawingExtraction) {
  throw new Error(
    "@carbon/lib/ai-routing-drawing did not expose normalization helpers"
  );
}

const { normalizeAiRoutingDrawingExtraction } = resolvedAiRoutingDrawingModule;

type BuiltAiRoutingSample = AiRoutingSample & {
  status: Exclude<NonNullable<AiRoutingSample["status"]>, "Retired">;
};

type BuildSampleArgs = {
  companyId: string;
  itemId: string;
  makeMethodId: string;
  source?: string;
  status?: BuiltAiRoutingSample["status"];
};

type AiRoutingSampleDocumentRow = {
  id?: string | null;
};

type AiRoutingSampleItemRow = AiRoutingKnowledgeItem & {
  id: string;
  readableIdWithRevision?: string | null;
};

type AiRoutingJobMakeMethodRow = {
  id: string;
  jobId?: string | null;
  itemId: string;
};

type BuildJobRouteRowsArgs = {
  companyId: string;
  item: AiRoutingSampleItemRow;
  jobMakeMethod: AiRoutingJobMakeMethodRow;
  operations: Record<string, unknown>[];
  documents?: AiRoutingSampleDocumentRow[];
  status?: BuiltAiRoutingSample["status"];
};

type PersistSampleArgs = {
  sample: AiRoutingSample;
  companyId: string;
  userId: string;
  source?: string;
  itemSnapshot?: unknown;
  drawingSnapshot?: unknown[];
  operationSnapshot?: unknown[];
  ontologySnapshot?: unknown;
};

type PersistDraftArgs = {
  companyId: string;
  userId: string;
  targetItemId: string;
  targetMakeMethodId?: string | null;
  draft: AiRoutingDraft;
  rationale?: unknown;
};

type EnqueueDrawingExtractionArgs = {
  companyId: string;
  userId: string;
  itemId: string;
  documentId: string;
};

export type AiRoutingDrawingExtractionEventPayload =
  EnqueueDrawingExtractionArgs & {
    extractionId: string;
  };

export type AiRoutingDrawingExtractionSummary = {
  documentId: string;
  documentName: string | null;
  extractionId: string | null;
  status: "Pending" | "Processing" | "Succeeded" | "Failed" | null;
  contentHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

type SendDrawingExtractionEvent = (
  payload: AiRoutingDrawingExtractionEventPayload
) => Promise<unknown>;

type RecordFeedbackArgs = {
  companyId: string;
  userId: string;
  draftId: string;
  itemId: string;
  draftStatus: "Accepted" | "Rejected" | "Superseded";
  changeSummary?: string | null;
  reason?: string | null;
  outcomeStatus?: string | null;
  originalSuggestion: unknown;
  confirmedRouteSnapshot?: unknown;
  productionOutcome?: unknown;
  qualityOutcome?: unknown;
};

type AiRoutingSampleRow = {
  id: string;
  itemId: string;
  makeMethodId?: string | null;
  itemSnapshot?: unknown;
  operationSnapshot?: unknown;
  drawingDocumentIds?: string[] | null;
  materialTags?: string[] | null;
  featureTags?: string[] | null;
  processTags?: string[] | null;
  resourceTags?: string[] | null;
  customFields?: unknown;
  status?: AiRoutingSample["status"] | null;
  datasetRole?: AiRoutingSample["datasetRole"] | null;
};

type AiRoutingTargetEvidenceRow = {
  itemId: string;
  readableId?: string | null;
  readableIdWithRevision?: string | null;
  name?: string | null;
  description?: string | null;
  customFields?: unknown;
  extractionId: string;
  extraction: unknown;
};

type AiRoutingTrainingDrawingDocumentRow = {
  id: string;
  name?: string | null;
  path?: string | null;
  extension?: string | null;
  type?: string | null;
  sourceDocument?: string | null;
  sourceDocumentId?: string | null;
  active?: boolean | null;
};

type AiRoutingTrainingDrawingExtractionRow = {
  id: string;
  itemId: string;
  documentId: string;
  status?: string | null;
  contentHash?: string | null;
  rendererVersion?: string | null;
  extractorSchemaVersion?: string | null;
  promptVersion?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  pageCount?: number | null;
  completedAt?: string | null;
  extraction: unknown;
};

export type AiRoutingTrainingDrawingSnapshot = {
  id: string;
  name: string | null;
  path: string | null;
  extension: string | null;
  type: string | null;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  aiDrawingExtraction: {
    id: string;
    documentId: string;
    contentHash: string;
    rendererVersion: string | null;
    extractorSchemaVersion: string;
    promptVersion: string | null;
    modelProvider: string | null;
    modelName: string | null;
    pageCount: number | null;
    completedAt: string | null;
  };
};

function asJsonb(value: unknown) {
  return JSON.stringify(value ?? null);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export class AiRoutingDraftProcessReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRoutingDraftProcessReferenceError";
  }
}

export function isAiRoutingDraftProcessReferenceError(error: unknown) {
  return error instanceof AiRoutingDraftProcessReferenceError;
}

type AiRoutingDraftProcessReferenceRow = {
  id: string;
  companyId: string | null;
};

function aiRoutingDraftProcessIds(
  draft: Pick<AiRoutingDraft, "suggestedOperations">
): string[] {
  return Array.from(
    new Set(
      draft.suggestedOperations
        .map((operation) => operation.processId?.trim())
        .filter((processId): processId is string => Boolean(processId))
    )
  );
}

export function assertAiRoutingDraftProcessReferences(args: {
  companyId: string;
  draft: Pick<AiRoutingDraft, "suggestedOperations">;
  processes: AiRoutingDraftProcessReferenceRow[];
}) {
  const missingProcessId = args.draft.suggestedOperations.find(
    (operation) => !operation.processId?.trim()
  );
  if (missingProcessId) {
    throw new AiRoutingDraftProcessReferenceError(
      "AI routing draft operation is missing a process id"
    );
  }

  const processesById = new Map(
    args.processes.map((process) => [process.id, process])
  );
  const invalidProcessIds = aiRoutingDraftProcessIds(args.draft).filter(
    (processId) => processesById.get(processId)?.companyId !== args.companyId
  );

  if (invalidProcessIds.length > 0) {
    throw new AiRoutingDraftProcessReferenceError(
      `AI routing draft contains process IDs outside this company: ${invalidProcessIds.join(", ")}`
    );
  }
}

export async function validateAiRoutingDraftProcessReferences(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    draft: Pick<AiRoutingDraft, "suggestedOperations">;
  }
) {
  if (args.draft.suggestedOperations.length === 0) return;

  const processIds = aiRoutingDraftProcessIds(args.draft);
  const processes = processIds.length
    ? await sql<AiRoutingDraftProcessReferenceRow>`
        SELECT "id", "companyId"
        FROM "process"
        WHERE "id" = ANY(${processIds}::text[])
      `.execute(db)
    : { rows: [] };

  assertAiRoutingDraftProcessReferences({
    companyId: args.companyId,
    draft: args.draft,
    processes: processes.rows
  });
}
function isCurrentPartPdfDocument(
  document: AiRoutingTrainingDrawingDocumentRow,
  itemId: string
) {
  return (
    document.active !== false &&
    document.sourceDocument === "Part" &&
    document.sourceDocumentId === itemId &&
    document.type === "PDF" &&
    document.extension?.toLowerCase() === "pdf"
  );
}

function uniqueDrawingDocumentsByPath(
  documents: AiRoutingTrainingDrawingDocumentRow[]
): AiRoutingTrainingDrawingDocumentRow[] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = document.path?.trim() || document.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortExtractionRows(
  rows: AiRoutingTrainingDrawingExtractionRow[]
): AiRoutingTrainingDrawingExtractionRow[] {
  return [...rows].sort((a, b) => {
    const bTime = b.completedAt ? Date.parse(b.completedAt) : 0;
    const aTime = a.completedAt ? Date.parse(a.completedAt) : 0;
    return bTime - aTime || b.id.localeCompare(a.id);
  });
}

function extractionSnapshot(
  row: AiRoutingTrainingDrawingExtractionRow
): AiRoutingTrainingDrawingSnapshot["aiDrawingExtraction"] {
  const extraction = normalizeAiRoutingDrawingExtraction(row.extraction);
  const contentHash = row.contentHash;
  const extractorSchemaVersion = row.extractorSchemaVersion;

  if (
    !contentHash ||
    contentHash !== extraction.document.contentHash ||
    !extractorSchemaVersion ||
    extractorSchemaVersion !== extraction.schemaVersion
  ) {
    throw new Error("Part training sample has a stale AI drawing extraction");
  }

  return {
    id: row.id,
    documentId: row.documentId,
    contentHash,
    rendererVersion: row.rendererVersion ?? null,
    extractorSchemaVersion,
    promptVersion: row.promptVersion ?? null,
    modelProvider: row.modelProvider ?? null,
    modelName: row.modelName ?? null,
    pageCount: row.pageCount ?? extraction.document.pageCount,
    completedAt: row.completedAt ?? null
  };
}

export function aiRoutingTrainingDrawingSnapshotsFromRows(args: {
  itemId: string;
  documents: AiRoutingTrainingDrawingDocumentRow[];
  extractions: AiRoutingTrainingDrawingExtractionRow[];
}): AiRoutingTrainingDrawingSnapshot[] {
  const documents = uniqueDrawingDocumentsByPath(
    args.documents.filter((document) =>
      isCurrentPartPdfDocument(document, args.itemId)
    )
  );

  if (documents.length === 0) {
    throw new Error(
      "Part training sample requires an active Part PDF document"
    );
  }

  return documents.map((document) => {
    const candidates = sortExtractionRows(
      args.extractions.filter(
        (extraction) =>
          extraction.itemId === args.itemId &&
          extraction.documentId === document.id &&
          extraction.status === "Succeeded"
      )
    );

    if (candidates.length === 0) {
      throw new Error(
        "Part training sample requires a succeeded AI drawing extraction"
      );
    }

    return {
      id: document.id,
      name: document.name ?? null,
      path: document.path ?? null,
      extension: document.extension ?? null,
      type: document.type ?? null,
      sourceDocument: document.sourceDocument ?? null,
      sourceDocumentId: document.sourceDocumentId ?? null,
      aiDrawingExtraction: extractionSnapshot(candidates[0])
    };
  });
}

function operationFromRow(row: Record<string, unknown>): AiRoutingOperation {
  const process = row.process as { id?: string; name?: string } | null;
  const workCenter = row.workCenter as { id?: string; name?: string } | null;

  return {
    id: row.id as string | undefined,
    order: Number(row.order ?? 0),
    processId: (row.processId as string | null | undefined) ?? process?.id,
    processName: process?.name ?? stringValue(row.processName),
    workCenterId:
      (row.workCenterId as string | null | undefined) ?? workCenter?.id ?? null,
    workCenterName: workCenter?.name ?? stringValue(row.workCenterName),
    operationType: (row.operationType as string | null | undefined) ?? null,
    operationOrder: (row.operationOrder as string | null | undefined) ?? null,
    description: (row.description as string | null | undefined) ?? null,
    setupTime: Number(row.setupTime ?? 0),
    setupUnit: (row.setupUnit as string | null | undefined) ?? null,
    laborTime: Number(row.laborTime ?? 0),
    laborUnit: (row.laborUnit as string | null | undefined) ?? null,
    machineTime: Number(row.machineTime ?? 0),
    machineUnit: (row.machineUnit as string | null | undefined) ?? null,
    customFields: row.customFields
  };
}

export function aiRoutingSampleFromJobRouteRows(args: BuildJobRouteRowsArgs): {
  data: BuiltAiRoutingSample | null;
  error: Error | null;
  itemSnapshot?: unknown;
  drawingSnapshot?: unknown[];
  operationSnapshot?: unknown[];
} {
  if (args.jobMakeMethod.itemId !== args.item.id) {
    return {
      data: null,
      error: new Error(
        "U8 job route item does not match the AI routing sample item"
      )
    };
  }

  const operations = args.operations
    .map((row) => operationFromRow(row))
    .sort((a, b) => a.order - b.order);

  if (operations.length === 0) {
    return {
      data: null,
      error: new Error("U8 job route sample requires at least one operation")
    };
  }

  const tags = routingKnowledgeTags({ item: args.item, operations });

  return {
    data: {
      id: `${args.companyId}:job-route:${args.jobMakeMethod.id}`,
      itemId: args.item.id,
      readableId:
        stringValue(args.item.readableIdWithRevision) ??
        stringValue(args.item.readableId) ??
        undefined,
      name: args.item.name,
      makeMethodId: null,
      documentIds: (args.documents ?? [])
        .map((document) => stringValue(document.id))
        .filter((id): id is string => Boolean(id)),
      operations,
      status: args.status === "Approved" ? "Approved" : "Candidate",
      datasetRole: "Training",
      ...tags
    },
    error: null,
    itemSnapshot: args.item,
    drawingSnapshot: args.documents ?? [],
    operationSnapshot: operations
  };
}
export function aiRoutingSampleStatusForMakeMethod(
  requestedStatus: BuiltAiRoutingSample["status"] | undefined,
  makeMethodStatus: Database["public"]["Enums"]["makeMethodStatus"]
): BuiltAiRoutingSample["status"] {
  return requestedStatus === "Approved" && makeMethodStatus === "Active"
    ? "Approved"
    : "Candidate";
}

export function aiRoutingSampleFromRow(
  row: AiRoutingSampleRow
): AiRoutingSample {
  const itemSnapshot = objectValue(row.itemSnapshot);
  const operationSnapshot = Array.isArray(row.operationSnapshot)
    ? row.operationSnapshot
    : [];
  const readableId =
    stringValue(itemSnapshot.readableIdWithRevision) ??
    stringValue(itemSnapshot.readableId) ??
    undefined;
  const name = stringValue(itemSnapshot.name) ?? undefined;

  return {
    id: row.id,
    itemId: row.itemId,
    readableId,
    name,
    makeMethodId: row.makeMethodId ?? null,
    documentIds: stringArray(row.drawingDocumentIds),
    operations: operationSnapshot.map((operation) =>
      operationFromRow(objectValue(operation))
    ),
    materialTags: stringArray(row.materialTags),
    featureTags: stringArray(row.featureTags),
    processTags: stringArray(row.processTags),
    resourceTags: stringArray(row.resourceTags),
    customFields: row.customFields,
    scopeExclusionReasons: aiRoutingSampleScopeExclusionReasons({
      readableId,
      name,
      customFields: row.customFields
    }),
    status: row.status ?? "Candidate",
    datasetRole: row.datasetRole ?? "Training"
  };
}

export function aiRoutingTargetEvidenceFromExtractionRow(
  row: AiRoutingTargetEvidenceRow
): AiRoutingTargetEvidence {
  const extraction = normalizeAiRoutingDrawingExtraction(row.extraction);

  return aiRoutingTargetEvidenceFromDrawing({
    id: row.extractionId,
    itemId: row.itemId,
    item: {
      readableId: row.readableIdWithRevision ?? row.readableId,
      name: row.name,
      description: row.description,
      customFields: row.customFields
    },
    drawingExtraction: extraction
  });
}

export function isMissingAiRoutingSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /relation\s+"aiRouting(Sample|Draft|Feedback)"\s+does not exist/i.test(
      message
    ) ||
    /relation\s+"aiDrawingExtraction"\s+does not exist/i.test(message) ||
    /aiRouting(Sample|Draft|Feedback).*does not exist/i.test(message) ||
    /aiDrawingExtraction.*does not exist/i.test(message) ||
    /type\s+"aiRoutingDatasetRole"\s+does not exist/i.test(message) ||
    /column\s+"datasetRole"\s+does not exist/i.test(message) ||
    /datasetRole.*does not exist/i.test(message)
  );
}

export function aiRoutingDrawingExtractionEventPayload(
  args: AiRoutingDrawingExtractionEventPayload
): AiRoutingDrawingExtractionEventPayload {
  return {
    companyId: args.companyId,
    userId: args.userId,
    itemId: args.itemId,
    documentId: args.documentId,
    extractionId: args.extractionId
  };
}

export const AI_ROUTING_DRAWING_EXTRACTION_STALE_AFTER_MS = 20 * 60 * 1000;

type ActiveAiRoutingDrawingExtraction = {
  id: string;
  status: "Pending" | "Processing";
  startedAt?: string | null;
  createdAt?: string | null;
};

export function aiRoutingDrawingExtractionQueueDecision(args: {
  activeExtraction: ActiveAiRoutingDrawingExtraction | null;
  now?: Date;
}): "create" | "reuse" | "replace-stale-processing" {
  const extraction = args.activeExtraction;
  if (!extraction) return "create";
  if (extraction.status === "Pending") return "reuse";

  const referenceTime = extraction.startedAt ?? extraction.createdAt;
  const startedAtMs = referenceTime ? Date.parse(referenceTime) : Number.NaN;
  const nowMs = (args.now ?? new Date()).getTime();

  return Number.isFinite(startedAtMs) &&
    nowMs - startedAtMs < AI_ROUTING_DRAWING_EXTRACTION_STALE_AFTER_MS
    ? "reuse"
    : "replace-stale-processing";
}

export async function enqueueAiRoutingDrawingExtraction(
  db: Kysely<KyselyDatabase>,
  args: EnqueueDrawingExtractionArgs,
  sendEvent: SendDrawingExtractionEvent = (payload) =>
    trigger("ai-routing-extract-part-drawing", payload)
) {
  const extractionId = await db.transaction().execute(async (trx) => {
    const scopeKey = `${args.companyId}:${args.itemId}:${args.documentId}`;
    await sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))
    `.execute(trx);

    const existing = await sql<ActiveAiRoutingDrawingExtraction>`
      SELECT "id", "status", "startedAt", "createdAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = ${args.companyId}
        AND "itemId" = ${args.itemId}
        AND "documentId" = ${args.documentId}
        AND "status" IN ('Pending'::"aiDrawingExtractionStatus", 'Processing'::"aiDrawingExtractionStatus")
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
      FOR UPDATE
    `.execute(trx);

    const activeExtraction = existing.rows[0] ?? null;
    const decision = aiRoutingDrawingExtractionQueueDecision({
      activeExtraction
    });

    if (decision === "reuse" && activeExtraction) {
      return activeExtraction.id;
    }

    if (decision === "replace-stale-processing" && activeExtraction) {
      await sql`
        UPDATE "aiDrawingExtraction"
        SET
          "status" = 'Failed'::"aiDrawingExtractionStatus",
          "errorCategory" = 'Model',
          "errorCode" = 'STALE_PROCESSING_TIMEOUT',
          "errorMessage" = 'The previous drawing extraction worker stopped before completion',
          "completedAt" = NOW(),
          "updatedBy" = ${args.userId},
          "updatedAt" = NOW()
        WHERE "id" = ${activeExtraction.id}
          AND "companyId" = ${args.companyId}
          AND "status" = 'Processing'::"aiDrawingExtractionStatus"
      `.execute(trx);
    }

    const created = await sql<{ id: string }>`
      INSERT INTO "aiDrawingExtraction" (
        "companyId",
        "itemId",
        "documentId",
        "status",
        "createdBy",
        "updatedBy"
      ) VALUES (
        ${args.companyId},
        ${args.itemId},
        ${args.documentId},
        'Pending'::"aiDrawingExtractionStatus",
        ${args.userId},
        ${args.userId}
      )
      RETURNING "id"
    `.execute(trx);

    return created.rows[0]?.id;
  });

  if (!extractionId) {
    throw new Error("Failed to create AI drawing extraction request");
  }

  const payload = aiRoutingDrawingExtractionEventPayload({
    ...args,
    extractionId
  });
  await sendEvent(payload);

  return { extractionId, status: "Pending" as const };
}
export async function getAiRoutingDrawingExtractionSummaries(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; itemId: string }
) {
  const result = await sql<AiRoutingDrawingExtractionSummary>`
    SELECT
      document."id" AS "documentId",
      document."name" AS "documentName",
      extraction."id" AS "extractionId",
      extraction."status" AS "status",
      extraction."contentHash" AS "contentHash",
      extraction."errorCode" AS "errorCode",
      extraction."errorMessage" AS "errorMessage",
      extraction."createdAt" AS "createdAt",
      extraction."completedAt" AS "completedAt"
    FROM "document" AS document
    LEFT JOIN LATERAL (
      SELECT
        "id",
        "status",
        "contentHash",
        "errorCode",
        "errorMessage",
        "createdAt",
        "completedAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = ${args.companyId}
        AND "itemId" = ${args.itemId}
        AND "documentId" = document."id"
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) AS extraction ON TRUE
    WHERE document."companyId" = ${args.companyId}
      AND document."sourceDocument" = 'Part'
      AND document."sourceDocumentId" = ${args.itemId}
      AND document."active" = TRUE
      AND document."type" = 'PDF'
      AND LOWER(document."extension") = 'pdf'
    ORDER BY document."createdAt" DESC, document."id" ASC
  `.execute(db);

  return result.rows;
}
export async function getAiRoutingTrainingDrawingSnapshots(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; itemId: string }
) {
  const documents = await sql<AiRoutingTrainingDrawingDocumentRow>`
    SELECT
      "id",
      "name",
      "path",
      "extension",
      "type",
      "sourceDocument",
      "sourceDocumentId",
      "active"
    FROM "document"
    WHERE "companyId" = ${args.companyId}
      AND "sourceDocument" = 'Part'
      AND "sourceDocumentId" = ${args.itemId}
      AND "active" = TRUE
      AND "type" = 'PDF'
      AND LOWER("extension") = 'pdf'
    ORDER BY "createdAt" DESC, "id" ASC
  `.execute(db);

  const documentIds = documents.rows.map((document) => document.id);
  const extractions = documentIds.length
    ? await sql<AiRoutingTrainingDrawingExtractionRow>`
        SELECT
          "id",
          "itemId",
          "documentId",
          "status",
          "contentHash",
          "rendererVersion",
          "extractorSchemaVersion",
          "promptVersion",
          "modelProvider",
          "modelName",
          "pageCount",
          "completedAt",
          "extraction"
        FROM "aiDrawingExtraction"
        WHERE "companyId" = ${args.companyId}
          AND "itemId" = ${args.itemId}
          AND "documentId" = ANY(${documentIds}::text[])
        ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
      `.execute(db)
    : { rows: [] };

  return aiRoutingTrainingDrawingSnapshotsFromRows({
    itemId: args.itemId,
    documents: documents.rows,
    extractions: extractions.rows
  });
}

export async function getAiRoutingTargetEvidenceForItem(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; itemId: string }
) {
  const result = await sql<AiRoutingTargetEvidenceRow>`
    SELECT
      item."id" AS "itemId",
      item."readableId" AS "readableId",
      item."readableIdWithRevision" AS "readableIdWithRevision",
      item."name" AS "name",
      item."description" AS "description",
      item."notes" AS "customFields",
      extraction."id" AS "extractionId",
      extraction."extraction" AS "extraction"
    FROM "item" AS item
    JOIN LATERAL (
      SELECT "id", "extraction", "completedAt", "updatedAt", "createdAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = ${args.companyId}
        AND "itemId" = ${args.itemId}
        AND "status" = 'Succeeded'::"aiDrawingExtractionStatus"
        AND jsonb_typeof("extraction") = 'object'
      ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
      LIMIT 1
    ) AS extraction ON TRUE
    WHERE item."companyId" = ${args.companyId}
      AND item."id" = ${args.itemId}
    LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  return row ? aiRoutingTargetEvidenceFromExtractionRow(row) : null;
}

export async function getAiRoutingSamples(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; limit?: number }
) {
  const result = await sql<AiRoutingSampleRow>`
    SELECT
      "id",
      "itemId",
      "makeMethodId",
      "itemSnapshot",
      "operationSnapshot",
      "drawingDocumentIds",
      "materialTags",
      "featureTags",
      "processTags",
      "resourceTags",
      "customFields",
      "status",
      "datasetRole"
    FROM "aiRoutingSample"
    WHERE "companyId" = ${args.companyId}
      AND "status" = 'Approved'::"aiRoutingSampleStatus"
      AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC
    LIMIT ${args.limit ?? 100}
  `.execute(db);

  return result.rows.map(aiRoutingSampleFromRow);
}

export async function getAiRoutingSampleCount(
  db: Kysely<KyselyDatabase>,
  companyId: string
) {
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS "count"
    FROM "aiRoutingSample"
    WHERE "companyId" = ${companyId}
      AND "status" = 'Approved'::"aiRoutingSampleStatus"
      AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
  `.execute(db);

  return Number(result.rows[0]?.count ?? 0);
}

export async function buildAiRoutingSampleFromMakeMethod(
  client: SupabaseClient<Database>,
  args: BuildSampleArgs
): Promise<{
  data: BuiltAiRoutingSample | null;
  error: Error | null;
  itemSnapshot?: unknown;
  drawingSnapshot?: unknown[];
  operationSnapshot?: unknown[];
}> {
  const [itemResult, methodResult, operationResult, documentResult] =
    await Promise.all([
      client
        .from("item")
        .select(
          "id, readableId, readableIdWithRevision, name, description, revision, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode, customFields:notes"
        )
        .eq("id", args.itemId)
        .eq("companyId", args.companyId)
        .single(),
      client
        .from("makeMethod")
        .select("id, itemId, version, status, customFields")
        .eq("id", args.makeMethodId)
        .eq("itemId", args.itemId)
        .eq("companyId", args.companyId)
        .single(),
      client
        .from("methodOperation")
        .select(
          "id, order, operationOrder, operationType, processId, workCenterId, description, setupTime, setupUnit, laborTime, laborUnit, machineTime, machineUnit, customFields, process(id, name), workCenter(id, name)"
        )
        .eq("makeMethodId", args.makeMethodId)
        .eq("companyId", args.companyId)
        .order("order", { ascending: true }),
      client
        .from("document")
        .select(
          "id, name, path, extension, type, sourceDocument, sourceDocumentId"
        )
        .eq("companyId", args.companyId)
        .eq("sourceDocumentId", args.itemId)
        .eq("active", true)
    ]);

  const error =
    itemResult.error ??
    methodResult.error ??
    operationResult.error ??
    documentResult.error;

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  if (!itemResult.data || !methodResult.data) {
    return {
      data: null,
      error: new Error(
        "Part or make method was not found for AI routing sample"
      )
    };
  }

  const item = itemResult.data;
  const method = methodResult.data;
  const operations = (operationResult.data ?? []).map((row) =>
    operationFromRow(row as Record<string, unknown>)
  );
  const tags = routingKnowledgeTags({ item, operations });

  return {
    data: {
      id: `${args.companyId}:${args.makeMethodId}`,
      itemId: args.itemId,
      readableId: item.readableIdWithRevision ?? item.readableId,
      name: item.name,
      makeMethodId: method.id,
      documentIds: (documentResult.data ?? []).map((document) => document.id),
      operations,
      status: aiRoutingSampleStatusForMakeMethod(args.status, method.status),
      datasetRole: "Training",
      ...tags
    },
    error: null,
    itemSnapshot: item,
    drawingSnapshot: documentResult.data ?? [],
    operationSnapshot: operations
  };
}

export async function buildAndPersistAiRoutingSampleFromMakeMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: BuildSampleArgs & { userId: string }
) {
  const sample = await buildAiRoutingSampleFromMakeMethod(client, args);
  if (sample.error || !sample.data) return sample;

  const drawingSnapshot = await getAiRoutingTrainingDrawingSnapshots(db, {
    companyId: args.companyId,
    itemId: args.itemId
  });

  const id = await persistAiRoutingSample(db, {
    sample: sample.data,
    companyId: args.companyId,
    userId: args.userId,
    source: args.source,
    itemSnapshot: sample.itemSnapshot,
    drawingSnapshot,
    operationSnapshot: sample.operationSnapshot
  });

  return { ...sample, id };
}

export async function persistAiRoutingSample(
  db: Kysely<KyselyDatabase>,
  args: PersistSampleArgs
) {
  return db.transaction().execute(async (trx) => {
    const result = await sql<{ id: string }>`
      INSERT INTO "aiRoutingSample" (
        "id",
        "companyId",
        "itemId",
        "makeMethodId",
        "source",
        "status",
        "datasetRole",
        "itemSnapshot",
        "drawingDocumentIds",
        "drawingSnapshot",
        "operationSnapshot",
        "materialTags",
        "featureTags",
        "processTags",
        "resourceTags",
        "ontologySnapshot",
        "createdBy",
        "updatedBy",
        "updatedAt"
      ) VALUES (
        ${args.sample.id},
        ${args.companyId},
        ${args.sample.itemId},
        ${args.sample.makeMethodId ?? null},
        ${args.source ?? "confirmed-method"},
        ${args.sample.status ?? "Candidate"}::"aiRoutingSampleStatus",
        ${args.sample.datasetRole ?? "Training"}::"aiRoutingDatasetRole",
        ${asJsonb(args.itemSnapshot ?? {})}::jsonb,
        ${args.sample.documentIds ?? []}::text[],
        ${asJsonb(args.drawingSnapshot ?? [])}::jsonb,
        ${asJsonb(args.operationSnapshot ?? args.sample.operations)}::jsonb,
        ${args.sample.materialTags}::text[],
        ${args.sample.featureTags}::text[],
        ${args.sample.processTags}::text[],
        ${args.sample.resourceTags}::text[],
        ${asJsonb(args.ontologySnapshot ?? null)}::jsonb,
        ${args.userId},
        ${args.userId},
        NOW()
      )
      ON CONFLICT ("companyId", "makeMethodId")
      WHERE "makeMethodId" IS NOT NULL
        AND "status" <> 'Retired'::"aiRoutingSampleStatus"
      DO UPDATE SET
        "sampleVersion" = "aiRoutingSample"."sampleVersion" + 1,
        "itemSnapshot" = EXCLUDED."itemSnapshot",
        "drawingDocumentIds" = EXCLUDED."drawingDocumentIds",
        "drawingSnapshot" = EXCLUDED."drawingSnapshot",
        "operationSnapshot" = EXCLUDED."operationSnapshot",
        "materialTags" = EXCLUDED."materialTags",
        "featureTags" = EXCLUDED."featureTags",
        "processTags" = EXCLUDED."processTags",
        "resourceTags" = EXCLUDED."resourceTags",
        "ontologySnapshot" = EXCLUDED."ontologySnapshot",
        "status" = EXCLUDED."status",
        "source" = EXCLUDED."source",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
      WHERE "aiRoutingSample"."datasetRole" = 'Training'::"aiRoutingDatasetRole"
        AND "aiRoutingSample"."lockedAt" IS NULL
      RETURNING "id"
    `.execute(trx);

    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error("AI routing evaluation samples cannot be overwritten");
    }

    return id;
  });
}

const AI_ROUTING_METHOD_OPERATION_ORDERS = new Set([
  "After Previous",
  "With Previous"
]);
const AI_ROUTING_OPERATION_TYPES = new Set(["Inside", "Outside"]);
const AI_ROUTING_STANDARD_FACTORS = new Set([
  "Hours/Piece",
  "Hours/100 Pieces",
  "Hours/1000 Pieces",
  "Minutes/Piece",
  "Minutes/100 Pieces",
  "Minutes/1000 Pieces",
  "Pieces/Hour",
  "Pieces/Minute",
  "Seconds/Piece",
  "Total Hours",
  "Total Minutes"
]);

type MaterializeAcceptedAiRoutingDraftArgs = {
  companyId: string;
  userId: string;
  itemId: string;
  draftId: string;
};

type AiRoutingMaterializationDraftRow = {
  id: string;
  itemId: string;
  targetMakeMethodId: string | null;
  acceptedMakeMethodId: string | null;
  status: string;
};

type AiRoutingMaterializationFeedbackRow = {
  confirmedRouteSnapshot: unknown;
};

type AiRoutingMaterializationMakeMethodRow = {
  id: string;
  itemId: string;
  status: string;
  version: number;
  tags: string[] | null;
  customFields: unknown;
};

type AiRoutingMaterializedMethodOperationInsert = {
  companyId: string;
  makeMethodId: string;
  order: number;
  operationOrder: "After Previous" | "With Previous";
  operationType: "Inside" | "Outside";
  processId: string;
  workCenterId: string | null;
  description: string;
  setupTime: number;
  setupUnit: string;
  laborTime: number;
  laborUnit: string;
  machineTime: number;
  machineUnit: string;
  customFields: unknown;
  workInstruction: unknown;
  createdBy: string;
};

type AiRoutingMaterializationTransaction = {
  getAcceptedDraftForUpdate(args: {
    companyId: string;
    itemId: string;
    draftId: string;
  }): Promise<AiRoutingMaterializationDraftRow | null>;
  getLatestAcceptedFeedback(args: {
    companyId: string;
    itemId: string;
    draftId: string;
  }): Promise<AiRoutingMaterializationFeedbackRow | null>;
  getTargetMakeMethodForUpdate(args: {
    companyId: string;
    itemId: string;
    makeMethodId: string;
  }): Promise<AiRoutingMaterializationMakeMethodRow | null>;
  getNextMakeMethodVersion(args: {
    companyId: string;
    itemId: string;
  }): Promise<number>;
  getActiveProcessIds(companyId: string, ids: string[]): Promise<Set<string>>;
  getActiveWorkCenterIds(
    companyId: string,
    ids: string[]
  ): Promise<Set<string>>;
  getActiveWorkCenterProcessPairs(
    companyId: string,
    pairs: Array<{ processId: string; workCenterId: string }>
  ): Promise<Set<string>>;
  insertDraftMakeMethod(args: {
    companyId: string;
    itemId: string;
    version: number;
    tags: string[] | null;
    customFields: unknown;
    createdBy: string;
  }): Promise<AiRoutingMaterializationMakeMethodRow>;
  insertMethodOperations(
    rows: AiRoutingMaterializedMethodOperationInsert[]
  ): Promise<void>;
  linkDraftToAcceptedMakeMethod(args: {
    companyId: string;
    itemId: string;
    draftId: string;
    makeMethodId: string;
    updatedBy: string;
  }): Promise<boolean>;
};

export type AiRoutingMaterializationStore = {
  transaction<T>(
    callback: (trx: AiRoutingMaterializationTransaction) => Promise<T>
  ): Promise<T>;
};

export type AiRoutingMaterializationResult = {
  action: "Created" | "Reused";
  makeMethodId: string;
  itemId: string;
  version: number;
  operationCount: number;
};

function nonEmptyText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function finiteNumberOrDefault(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function methodOperationOrder(
  value: string | null | undefined
): "After Previous" | "With Previous" {
  return AI_ROUTING_METHOD_OPERATION_ORDERS.has(value ?? "")
    ? (value as "After Previous" | "With Previous")
    : "After Previous";
}

function operationType(value: string | null | undefined): "Inside" | "Outside" {
  return AI_ROUTING_OPERATION_TYPES.has(value ?? "")
    ? (value as "Inside" | "Outside")
    : "Inside";
}

function standardFactor(value: string | null | undefined, fallback: string) {
  return AI_ROUTING_STANDARD_FACTORS.has(value ?? "") ? value! : fallback;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map(nonEmptyText).filter(Boolean) as string[])];
}

function workCenterProcessPairKey(args: {
  processId: string;
  workCenterId: string;
}) {
  return `${args.processId}\u0000${args.workCenterId}`;
}

function uniqueWorkCenterProcessPairs(
  operations: AiRoutingMaterializedMethodOperationInsert[]
) {
  const pairs: Array<{ processId: string; workCenterId: string }> = [];
  const seen = new Set<string>();

  for (const operation of operations) {
    const processId = nonEmptyText(operation.processId);
    const workCenterId = nonEmptyText(operation.workCenterId);
    if (!processId || !workCenterId) continue;

    const key = workCenterProcessPairKey({ processId, workCenterId });
    if (seen.has(key)) continue;

    seen.add(key);
    pairs.push({ processId, workCenterId });
  }

  return pairs;
}

function parseAcceptedAiRoutingSnapshot(args: {
  value: unknown;
  itemId: string;
}) {
  const raw =
    typeof args.value === "string" ? args.value : JSON.stringify(args.value);
  const snapshot = parseAiRoutingConfirmedRouteSnapshot(raw);

  if (!snapshot) {
    throw new Error(
      "Accepted AI routing draft is missing a reviewed route snapshot"
    );
  }
  if (snapshot.targetItemId !== args.itemId) {
    throw new Error(
      "Accepted AI routing snapshot does not match the target item"
    );
  }
  if (snapshot.suggestedOperations.length === 0) {
    throw new Error("Accepted AI routing snapshot has no reviewed operations");
  }

  return snapshot;
}

function buildMaterializedMethodOperations(args: {
  companyId: string;
  userId: string;
  draftId: string;
  makeMethodId: string;
  snapshot: ReturnType<typeof parseAcceptedAiRoutingSnapshot>;
}): AiRoutingMaterializedMethodOperationInsert[] {
  return [...args.snapshot.suggestedOperations]
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.sourceOperationOrder - right.sourceOperationOrder
    )
    .map((operation, index) => {
      const processId = nonEmptyText(operation.processId);
      if (!processId) {
        throw new Error(
          "Accepted AI routing operation is missing a process id"
        );
      }

      return {
        companyId: args.companyId,
        makeMethodId: args.makeMethodId,
        order: index + 1,
        operationOrder: methodOperationOrder(operation.operationOrder),
        operationType: operationType(operation.operationType),
        processId,
        workCenterId: nonEmptyText(operation.workCenterId),
        description:
          nonEmptyText(operation.description) ??
          nonEmptyText(operation.processName) ??
          "",
        setupTime: finiteNumberOrDefault(operation.setupTime),
        setupUnit: standardFactor(operation.setupUnit, "Total Minutes"),
        laborTime: finiteNumberOrDefault(operation.laborTime),
        laborUnit: standardFactor(operation.laborUnit, "Minutes/Piece"),
        machineTime: finiteNumberOrDefault(operation.machineTime),
        machineUnit: standardFactor(operation.machineUnit, "Minutes/Piece"),
        customFields: {
          aiRouting: {
            draftId: args.draftId,
            sourceSampleId: operation.sourceSampleId,
            sourceOperationId: operation.sourceOperationId ?? null,
            sourceOperationOrder: operation.sourceOperationOrder,
            referenceSampleIds: args.snapshot.referenceSampleIds,
            warnings: args.snapshot.warnings
          },
          reviewedOperationCustomFields: operation.customFields ?? null
        },
        workInstruction: {},
        createdBy: args.userId
      };
    });
}

async function assertMaterializedOperationReferences(args: {
  trx: AiRoutingMaterializationTransaction;
  companyId: string;
  operations: AiRoutingMaterializedMethodOperationInsert[];
}) {
  const processIds = uniqueNonEmpty(
    args.operations.map((row) => row.processId)
  );
  const workCenterIds = uniqueNonEmpty(
    args.operations.map((row) => row.workCenterId)
  );
  const workCenterProcessPairs = uniqueWorkCenterProcessPairs(args.operations);
  const [validProcessIds, validWorkCenterIds, validWorkCenterProcessPairs] =
    await Promise.all([
      args.trx.getActiveProcessIds(args.companyId, processIds),
      args.trx.getActiveWorkCenterIds(args.companyId, workCenterIds),
      args.trx.getActiveWorkCenterProcessPairs(
        args.companyId,
        workCenterProcessPairs
      )
    ]);
  const missingProcessIds = processIds.filter((id) => !validProcessIds.has(id));
  const missingWorkCenterIds = workCenterIds.filter(
    (id) => !validWorkCenterIds.has(id)
  );

  const unsupportedWorkCenterProcessPairs = workCenterProcessPairs.filter(
    (pair) => !validWorkCenterProcessPairs.has(workCenterProcessPairKey(pair))
  );

  if (
    missingProcessIds.length > 0 ||
    missingWorkCenterIds.length > 0 ||
    unsupportedWorkCenterProcessPairs.length > 0
  ) {
    throw new Error(
      [
        missingProcessIds.length
          ? `Invalid AI routing process IDs: ${missingProcessIds.join(", ")}`
          : null,
        missingWorkCenterIds.length
          ? `Invalid AI routing work center IDs: ${missingWorkCenterIds.join(", ")}`
          : null,
        unsupportedWorkCenterProcessPairs.length
          ? `Unsupported AI routing work center/process pairs: ${unsupportedWorkCenterProcessPairs
              .map((pair) => `${pair.workCenterId} -> ${pair.processId}`)
              .join(", ")}`
          : null
      ]
        .filter(Boolean)
        .join("; ")
    );
  }
}

export async function materializeAcceptedAiRoutingDraftWithStore(
  store: AiRoutingMaterializationStore,
  args: MaterializeAcceptedAiRoutingDraftArgs
): Promise<AiRoutingMaterializationResult> {
  return store.transaction(async (trx) => {
    const draft = await trx.getAcceptedDraftForUpdate(args);
    if (!draft) {
      throw new Error("AI routing draft was not found for this Part");
    }
    if (draft.acceptedMakeMethodId) {
      const existing = await trx.getTargetMakeMethodForUpdate({
        companyId: args.companyId,
        itemId: args.itemId,
        makeMethodId: draft.acceptedMakeMethodId
      });
      if (!existing || existing.status !== "Draft") {
        throw new Error(
          "AI routing draft is linked to a missing Draft method version"
        );
      }
      return {
        action: "Reused",
        makeMethodId: existing.id,
        itemId: existing.itemId,
        version: existing.version,
        operationCount: 0
      };
    }
    if (draft.status !== "Accepted") {
      throw new Error(
        "Only accepted AI routing drafts can create a Draft method version"
      );
    }
    if (!draft.targetMakeMethodId) {
      throw new Error(
        "AI routing draft is stale because its target method is missing"
      );
    }

    const [feedback, targetMethod] = await Promise.all([
      trx.getLatestAcceptedFeedback(args),
      trx.getTargetMakeMethodForUpdate({
        companyId: args.companyId,
        itemId: args.itemId,
        makeMethodId: draft.targetMakeMethodId
      })
    ]);
    if (!feedback) {
      throw new Error("Accepted AI routing draft has no feedback snapshot");
    }
    if (!targetMethod) {
      throw new Error(
        "AI routing draft target method was not found for this Part"
      );
    }

    const snapshot = parseAcceptedAiRoutingSnapshot({
      value: feedback.confirmedRouteSnapshot,
      itemId: args.itemId
    });
    const operationsForValidation = buildMaterializedMethodOperations({
      companyId: args.companyId,
      userId: args.userId,
      draftId: args.draftId,
      makeMethodId: "pending-ai-routing-method",
      snapshot
    });

    await assertMaterializedOperationReferences({
      trx,
      companyId: args.companyId,
      operations: operationsForValidation
    });

    const nextVersion = await trx.getNextMakeMethodVersion({
      companyId: args.companyId,
      itemId: args.itemId
    });
    const draftMethod = await trx.insertDraftMakeMethod({
      companyId: args.companyId,
      itemId: args.itemId,
      version: nextVersion,
      tags: targetMethod.tags,
      customFields: targetMethod.customFields,
      createdBy: args.userId
    });
    const operations = operationsForValidation.map((operation) => ({
      ...operation,
      makeMethodId: draftMethod.id
    }));

    await trx.insertMethodOperations(operations);

    const linked = await trx.linkDraftToAcceptedMakeMethod({
      companyId: args.companyId,
      itemId: args.itemId,
      draftId: args.draftId,
      makeMethodId: draftMethod.id,
      updatedBy: args.userId
    });
    if (!linked) {
      throw new Error("AI routing draft was already materialized");
    }

    return {
      action: "Created",
      makeMethodId: draftMethod.id,
      itemId: draftMethod.itemId,
      version: draftMethod.version,
      operationCount: operations.length
    };
  });
}

function aiRoutingMaterializationTransaction(
  trx: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>
): AiRoutingMaterializationTransaction {
  return {
    async getAcceptedDraftForUpdate(args) {
      const result = await sql<AiRoutingMaterializationDraftRow>`
        SELECT
          "id",
          "itemId",
          "targetMakeMethodId",
          "acceptedMakeMethodId",
          "status"::text AS "status"
        FROM "aiRoutingDraft"
        WHERE "id" = ${args.draftId}
          AND "companyId" = ${args.companyId}
          AND "itemId" = ${args.itemId}
        FOR UPDATE
      `.execute(trx);
      return result.rows[0] ?? null;
    },
    async getLatestAcceptedFeedback(args) {
      const result = await sql<AiRoutingMaterializationFeedbackRow>`
        SELECT "confirmedRouteSnapshot"
        FROM "aiRoutingFeedback"
        WHERE "companyId" = ${args.companyId}
          AND "draftId" = ${args.draftId}
          AND "itemId" = ${args.itemId}
        ORDER BY "createdAt" DESC
        LIMIT 1
      `.execute(trx);
      return result.rows[0] ?? null;
    },
    async getTargetMakeMethodForUpdate(args) {
      const result = await sql<{
        id: string;
        itemId: string;
        status: string;
        version: number | string;
        tags: string[] | null;
        customFields: unknown;
      }>`
        SELECT
          "id",
          "itemId",
          "status"::text AS "status",
          "version",
          "tags",
          "customFields"
        FROM "makeMethod"
        WHERE "id" = ${args.makeMethodId}
          AND "companyId" = ${args.companyId}
          AND "itemId" = ${args.itemId}
        FOR UPDATE
      `.execute(trx);
      const row = result.rows[0];
      return row
        ? {
            ...row,
            version: Number(row.version)
          }
        : null;
    },
    async getNextMakeMethodVersion(args) {
      const result = await sql<{ version: number | string }>`
        SELECT COALESCE(MAX("version"), 0) + 1 AS "version"
        FROM "makeMethod"
        WHERE "companyId" = ${args.companyId}
          AND "itemId" = ${args.itemId}
      `.execute(trx);
      return Number(result.rows[0]?.version ?? 1);
    },
    async getActiveProcessIds(companyId, ids) {
      if (ids.length === 0) return new Set<string>();
      const result = await sql<{ id: string }>`
        SELECT "id"
        FROM "process"
        WHERE "companyId" = ${companyId}
          AND "active" = true
          AND "id" = ANY(${ids}::text[])
      `.execute(trx);
      return new Set(result.rows.map((row) => row.id));
    },
    async getActiveWorkCenterIds(companyId, ids) {
      if (ids.length === 0) return new Set<string>();
      const result = await sql<{ id: string }>`
        SELECT "id"
        FROM "workCenter"
        WHERE "companyId" = ${companyId}
          AND "active" = true
          AND "id" = ANY(${ids}::text[])
      `.execute(trx);
      return new Set(result.rows.map((row) => row.id));
    },
    async getActiveWorkCenterProcessPairs(companyId, pairs) {
      if (pairs.length === 0) return new Set<string>();
      const requestedPairs = new Set(pairs.map(workCenterProcessPairKey));
      const processIds = uniqueNonEmpty(pairs.map((pair) => pair.processId));
      const workCenterIds = uniqueNonEmpty(
        pairs.map((pair) => pair.workCenterId)
      );
      const result = await sql<{ processId: string; workCenterId: string }>`
        SELECT wcp."processId", wcp."workCenterId"
        FROM "workCenterProcess" wcp
        INNER JOIN "process" p
          ON p."id" = wcp."processId"
          AND p."companyId" = wcp."companyId"
          AND p."active" = true
        INNER JOIN "workCenter" wc
          ON wc."id" = wcp."workCenterId"
          AND wc."companyId" = wcp."companyId"
          AND wc."active" = true
        WHERE wcp."companyId" = ${companyId}
          AND wcp."processId" = ANY(${processIds}::text[])
          AND wcp."workCenterId" = ANY(${workCenterIds}::text[])
      `.execute(trx);
      return new Set(
        result.rows
          .map(workCenterProcessPairKey)
          .filter((key) => requestedPairs.has(key))
      );
    },
    async insertDraftMakeMethod(args) {
      const result = await sql<{
        id: string;
        itemId: string;
        status: string;
        version: number | string;
        tags: string[] | null;
        customFields: unknown;
      }>`
        INSERT INTO "makeMethod" (
          "companyId",
          "itemId",
          "status",
          "version",
          "tags",
          "customFields",
          "createdBy"
        ) VALUES (
          ${args.companyId},
          ${args.itemId},
          'Draft'::"makeMethodStatus",
          ${args.version},
          ${args.tags}::text[],
          ${asJsonb(args.customFields ?? null)}::jsonb,
          ${args.createdBy}
        )
        RETURNING
          "id",
          "itemId",
          "status"::text AS "status",
          "version",
          "tags",
          "customFields"
      `.execute(trx);
      const row = result.rows[0];
      if (!row)
        throw new Error("Failed to create AI routing Draft method version");
      return {
        ...row,
        version: Number(row.version)
      };
    },
    async insertMethodOperations(rows) {
      for (const row of rows) {
        await sql`
          INSERT INTO "methodOperation" (
            "companyId",
            "makeMethodId",
            "order",
            "operationOrder",
            "operationType",
            "processId",
            "workCenterId",
            "description",
            "setupTime",
            "setupUnit",
            "laborTime",
            "laborUnit",
            "machineTime",
            "machineUnit",
            "customFields",
            "workInstruction",
            "createdBy"
          ) VALUES (
            ${row.companyId},
            ${row.makeMethodId},
            ${row.order},
            ${row.operationOrder}::"methodOperationOrder",
            ${row.operationType}::"operationType",
            ${row.processId},
            ${row.workCenterId},
            ${row.description},
            ${row.setupTime},
            ${row.setupUnit}::"factor",
            ${row.laborTime},
            ${row.laborUnit}::"factor",
            ${row.machineTime},
            ${row.machineUnit}::"factor",
            ${asJsonb(row.customFields)}::jsonb,
            ${asJsonb(row.workInstruction)}::jsonb,
            ${row.createdBy}
          )
        `.execute(trx);
      }
    },
    async linkDraftToAcceptedMakeMethod(args) {
      const result = await sql<{ id: string }>`
        UPDATE "aiRoutingDraft"
        SET
          "acceptedMakeMethodId" = ${args.makeMethodId},
          "updatedBy" = ${args.updatedBy},
          "updatedAt" = NOW()
        WHERE "id" = ${args.draftId}
          AND "companyId" = ${args.companyId}
          AND "itemId" = ${args.itemId}
          AND "status" = 'Accepted'::"aiRoutingDraftStatus"
          AND "acceptedMakeMethodId" IS NULL
        RETURNING "id"
      `.execute(trx);
      return Boolean(result.rows[0]);
    }
  };
}

function aiRoutingMaterializationStore(
  db: Kysely<KyselyDatabase>
): AiRoutingMaterializationStore {
  return {
    transaction: (callback) =>
      db
        .transaction()
        .execute((trx) => callback(aiRoutingMaterializationTransaction(trx)))
  };
}

export async function materializeAcceptedAiRoutingDraft(
  db: Kysely<KyselyDatabase>,
  args: MaterializeAcceptedAiRoutingDraftArgs
) {
  return materializeAcceptedAiRoutingDraftWithStore(
    aiRoutingMaterializationStore(db),
    args
  );
}
export async function persistGeneratedAiRoutingDraft(
  db: Kysely<KyselyDatabase>,
  args: PersistDraftArgs
) {
  await validateAiRoutingDraftProcessReferences(db, {
    companyId: args.companyId,
    draft: args.draft
  });

  return db.transaction().execute(async (trx) => {
    const confidence = args.draft.references[0]?.score
      ? Math.min(1, Math.max(0, args.draft.references[0].score / 100))
      : null;
    const result = await sql<{ id: string }>`
      INSERT INTO "aiRoutingDraft" (
        "companyId",
        "itemId",
        "targetMakeMethodId",
        "status",
        "source",
        "confidence",
        "suggestedOperations",
        "referenceSamples",
        "warnings",
        "rationale",
        "createdBy"
      ) VALUES (
        ${args.companyId},
        ${args.targetItemId},
        ${args.targetMakeMethodId ?? null},
        'Draft'::"aiRoutingDraftStatus",
        'similarity-retrieval',
        ${confidence},
        ${asJsonb(args.draft.suggestedOperations)}::jsonb,
        ${asJsonb(args.draft.references)}::jsonb,
        ${args.draft.warnings}::text[],
        ${asJsonb(args.rationale ?? null)}::jsonb,
        ${args.userId}
      )
      RETURNING "id"
    `.execute(trx);

    return result.rows[0]?.id ?? null;
  });
}

export async function generateAndPersistAiRoutingDraft(
  db: Kysely<KyselyDatabase>,
  args: Omit<PersistDraftArgs, "draft"> & {
    target: AiRoutingTargetEvidence;
    samples: AiRoutingSample[];
    minimumScore?: number;
  }
) {
  const draft = generateAiRoutingDraft({
    target: args.target,
    samples: args.samples,
    minimumScore: args.minimumScore
  });
  const id = await persistGeneratedAiRoutingDraft(db, { ...args, draft });

  return { id, draft };
}

export async function recordAiRoutingFeedback(
  db: Kysely<KyselyDatabase>,
  args: RecordFeedbackArgs
) {
  return db.transaction().execute(async (trx) => {
    const draft = await sql<{ id: string }>`
      UPDATE "aiRoutingDraft"
      SET
        "status" = ${args.draftStatus}::"aiRoutingDraftStatus",
        "updatedBy" = ${args.userId},
        "updatedAt" = NOW(),
        "acceptedAt" = CASE WHEN ${args.draftStatus} = 'Accepted' THEN NOW() ELSE "acceptedAt" END,
        "acceptedBy" = CASE WHEN ${args.draftStatus} = 'Accepted' THEN ${args.userId} ELSE "acceptedBy" END,
        "rejectedAt" = CASE WHEN ${args.draftStatus} = 'Rejected' THEN NOW() ELSE "rejectedAt" END,
        "rejectedBy" = CASE WHEN ${args.draftStatus} = 'Rejected' THEN ${args.userId} ELSE "rejectedBy" END
      WHERE "id" = ${args.draftId}
        AND "companyId" = ${args.companyId}
        AND "itemId" = ${args.itemId}
        AND "status" = 'Draft'::"aiRoutingDraftStatus"
      RETURNING "id"
    `.execute(trx);

    if (!draft.rows[0]) {
      throw new Error("AI routing draft was not found or already reviewed");
    }

    const feedback = await sql<{ id: string }>`
      INSERT INTO "aiRoutingFeedback" (
        "companyId",
        "draftId",
        "itemId",
        "changeSummary",
        "reason",
        "outcomeStatus",
        "originalSuggestion",
        "confirmedRouteSnapshot",
        "productionOutcome",
        "qualityOutcome",
        "createdBy"
      ) VALUES (
        ${args.companyId},
        ${args.draftId},
        ${args.itemId},
        ${args.changeSummary ?? null},
        ${args.reason ?? null},
        ${args.outcomeStatus ?? null},
        ${asJsonb(args.originalSuggestion)}::jsonb,
        ${asJsonb(args.confirmedRouteSnapshot ?? null)}::jsonb,
        ${asJsonb(args.productionOutcome ?? null)}::jsonb,
        ${asJsonb(args.qualityOutcome ?? null)}::jsonb,
        ${args.userId}
      )
      RETURNING "id"
    `.execute(trx);

    return feedback.rows[0]?.id ?? null;
  });
}
