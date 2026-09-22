import type {
  AiRoutingDraft,
  AiRoutingDrawingEvidenceFact,
  AiRoutingTargetEvidence
} from "./ai-routing";

export type AiRoutingHumanReviewCheckpointKey =
  | "pdfEvidenceAvailable"
  | "draftOperationsAvailable"
  | "sourceSamplesAvailable"
  | "formalRoutingUnchanged";

export type AiRoutingHumanReviewModel = {
  pdfEvidence: {
    evidenceId: string | null;
    available: boolean;
    materialTags: string[];
    featureTags: string[];
    drawingEvidenceCount: number;
    warningCount: number;
    warnings: string[];
    preview: AiRoutingDrawingEvidenceFact[];
  };
  draftEvidence: {
    suggestedOperationCount: number;
    sourceSampleCount: number;
    matchedDrawingEvidenceCount: number;
    workCenterAssignmentCount: number;
  };
  checkpoints: Array<{
    key: AiRoutingHumanReviewCheckpointKey;
    satisfied: boolean;
  }>;
};

export type AiRoutingReviewedOperation =
  AiRoutingDraft["suggestedOperations"][number];

export type AiRoutingConfirmedRouteSnapshot = {
  status: "Technologist reviewed";
  targetItemId: string;
  formalRoutingAction: "not-published";
  suggestedOperations: AiRoutingReviewedOperation[];
  referenceSampleIds: string[];
  warnings: string[];
};

export function aiRoutingReviewedOperationKey(
  operation: Pick<
    AiRoutingReviewedOperation,
    "sourceSampleId" | "sourceOperationOrder"
  >
) {
  return `${operation.sourceSampleId}:${operation.sourceOperationOrder}`;
}

export function reviewedAiRoutingOperations(
  draft: AiRoutingDraft | null | undefined
): AiRoutingReviewedOperation[] {
  return (
    draft?.suggestedOperations.map((operation) => ({ ...operation })) ?? []
  );
}

export function updateAiRoutingReviewedOperation(args: {
  operations: AiRoutingReviewedOperation[];
  operationKey: string;
  patch: Partial<Pick<AiRoutingReviewedOperation, "description" | "order">>;
}): AiRoutingReviewedOperation[] {
  return args.operations.map((operation) => {
    if (aiRoutingReviewedOperationKey(operation) !== args.operationKey) {
      return { ...operation };
    }

    return {
      ...operation,
      ...args.patch
    };
  });
}

export function buildAiRoutingConfirmedRouteSnapshot(args: {
  draft: AiRoutingDraft;
  reviewedOperations: AiRoutingReviewedOperation[];
}): AiRoutingConfirmedRouteSnapshot {
  return {
    status: "Technologist reviewed",
    targetItemId: args.draft.targetItemId,
    formalRoutingAction: "not-published",
    suggestedOperations: args.reviewedOperations.map((operation) => ({
      ...operation
    })),
    referenceSampleIds: args.draft.references.map(
      (reference) => reference.sampleId
    ),
    warnings: [...args.draft.warnings]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseReviewedOperation(
  value: unknown
): AiRoutingReviewedOperation | null {
  if (!isRecord(value)) return null;
  if (typeof value.order !== "number") return null;
  if (typeof value.sourceSampleId !== "string") return null;
  if (typeof value.sourceOperationOrder !== "number") return null;

  return {
    order: value.order,
    processId: optionalString(value.processId),
    processName: optionalString(value.processName),
    workCenterId: optionalString(value.workCenterId),
    workCenterName: optionalString(value.workCenterName),
    operationType: optionalString(value.operationType),
    operationOrder: optionalString(value.operationOrder),
    description: optionalString(value.description),
    setupTime: typeof value.setupTime === "number" ? value.setupTime : null,
    setupUnit: optionalString(value.setupUnit),
    laborTime: typeof value.laborTime === "number" ? value.laborTime : null,
    laborUnit: optionalString(value.laborUnit),
    machineTime:
      typeof value.machineTime === "number" ? value.machineTime : null,
    machineUnit: optionalString(value.machineUnit),
    customFields: value.customFields,
    sourceSampleId: value.sourceSampleId,
    sourceOperationId: optionalString(value.sourceOperationId) ?? undefined,
    sourceOperationOrder: value.sourceOperationOrder
  };
}

export function parseAiRoutingConfirmedRouteSnapshot(
  value: string
): AiRoutingConfirmedRouteSnapshot | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    if (parsed.status !== "Technologist reviewed") return null;
    if (parsed.formalRoutingAction !== "not-published") return null;
    if (typeof parsed.targetItemId !== "string") return null;
    if (!Array.isArray(parsed.suggestedOperations)) return null;
    if (!Array.isArray(parsed.referenceSampleIds)) return null;
    if (!Array.isArray(parsed.warnings)) return null;

    const suggestedOperations = parsed.suggestedOperations.map(
      parseReviewedOperation
    );
    if (suggestedOperations.some((operation) => operation === null)) {
      return null;
    }
    if (
      !parsed.referenceSampleIds.every(
        (sampleId) => typeof sampleId === "string"
      )
    ) {
      return null;
    }
    if (!parsed.warnings.every((warning) => typeof warning === "string")) {
      return null;
    }

    return {
      status: "Technologist reviewed",
      targetItemId: parsed.targetItemId,
      formalRoutingAction: "not-published",
      suggestedOperations: suggestedOperations.filter(
        (operation): operation is AiRoutingReviewedOperation =>
          operation !== null
      ),
      referenceSampleIds: [...parsed.referenceSampleIds],
      warnings: [...parsed.warnings]
    };
  } catch {
    return null;
  }
}

export function buildAiRoutingHumanReviewModel(args: {
  targetEvidence: AiRoutingTargetEvidence | null | undefined;
  draft: AiRoutingDraft | null | undefined;
}): AiRoutingHumanReviewModel {
  const drawingEvidence = args.targetEvidence?.drawingEvidence ?? [];
  const drawingWarnings = args.targetEvidence?.drawingWarnings ?? [];
  const suggestedOperationCount = args.draft?.suggestedOperations.length ?? 0;
  const sourceSampleCount = args.draft?.references.length ?? 0;
  const matchedDrawingEvidenceCount =
    args.draft?.references.reduce(
      (count, reference) =>
        count + (reference.matchedDrawingEvidence?.length ?? 0),
      0
    ) ?? 0;
  const workCenterAssignmentCount =
    args.draft?.suggestedOperations.filter(
      (operation) => operation.workCenterId || operation.workCenterName
    ).length ?? 0;

  return {
    pdfEvidence: {
      evidenceId: args.targetEvidence?.id ?? null,
      available: Boolean(args.targetEvidence && drawingEvidence.length > 0),
      materialTags: args.targetEvidence?.materialTags ?? [],
      featureTags: args.targetEvidence?.featureTags ?? [],
      drawingEvidenceCount: drawingEvidence.length,
      warningCount: drawingWarnings.length,
      warnings: drawingWarnings,
      preview: drawingEvidence.slice(0, 6)
    },
    draftEvidence: {
      suggestedOperationCount,
      sourceSampleCount,
      matchedDrawingEvidenceCount,
      workCenterAssignmentCount
    },
    checkpoints: [
      {
        key: "pdfEvidenceAvailable",
        satisfied: Boolean(args.targetEvidence && drawingEvidence.length > 0)
      },
      {
        key: "draftOperationsAvailable",
        satisfied: suggestedOperationCount > 0
      },
      {
        key: "sourceSamplesAvailable",
        satisfied: sourceSampleCount > 0
      },
      {
        key: "formalRoutingUnchanged",
        satisfied: true
      }
    ]
  };
}
