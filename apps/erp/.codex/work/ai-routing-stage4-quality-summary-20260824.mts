import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateAiRoutingHoldouts,
  type AiRoutingEvaluationCaseInput
} from "../../app/modules/items/ai-routing-evaluation.ts";

type SmokeOperationRow = {
  position: number;
  expectedProcessId?: string | null;
  expectedProcessName?: string | null;
  predictedProcessId?: string | null;
  predictedProcessName?: string | null;
};
type SmokeResult = {
  readableId: string;
  targetExtractionId: string;
  trainingSampleCount: number;
  warnings: string[];
  warningCount: number;
  topReferences: Array<{ sampleId: string; readableId?: string | null }>;
  comparison: {
    byPosition: SmokeOperationRow[];
    exactSequenceMatch: boolean;
  };
  evaluationLeakCount: number;
  workCenterAssignmentCount: number;
  unsupportedWorkCenterAssignmentCount: number;
  missingProcessIdCount: number;
  invalidProcessIds: string[];
};
type SmokeSummary = {
  companyId: string;
  evaluatedAt: string;
  holdoutCount: number;
  trainingSampleCount: number;
  totalEvaluationLeaks: number;
  totalWorkCenterAssignments: number;
  totalUnsupportedWorkCenterAssignments: number;
  totalMissingProcessIds: number;
  invalidProcessIds: string[];
  results: SmokeResult[];
};
function operationCountDelta(row: { expectedOperationCount: number; suggestedOperationCount: number }) {
  return row.suggestedOperationCount - row.expectedOperationCount;
}
function expectedOperations(rows: SmokeOperationRow[]) {
  return rows
    .filter((row) => row.expectedProcessId || row.expectedProcessName)
    .map((row) => ({
      order: row.position,
      processId: row.expectedProcessId ?? null,
      processName: row.expectedProcessName ?? null
    }));
}
function suggestedOperations(rows: SmokeOperationRow[]) {
  return rows
    .filter((row) => row.predictedProcessId || row.predictedProcessName)
    .map((row) => ({
      order: row.position,
      processId: row.predictedProcessId ?? null,
      processName: row.predictedProcessName ?? null
    }));
}
const root = resolve(import.meta.dirname, "../../../..");
const inputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-evaluation-20260823.json");
const baselinePath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-prompt-v3-reextraction-20260824.json");
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-turned-class-mapping-reverted-20260824.json");
const smoke = JSON.parse(readFileSync(inputPath, "utf8")) as SmokeSummary;
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const validProcessIds = Array.from(
  new Set(
    smoke.results.flatMap((result) =>
      result.comparison.byPosition.flatMap((row) => [
        row.expectedProcessId,
        row.predictedProcessId
      ])
    ).filter((value): value is string => Boolean(value))
  )
);
const cases: AiRoutingEvaluationCaseInput[] = smoke.results.map((result) => ({
  evaluationSampleId: result.readableId,
  targetItemId: result.readableId,
  targetExtractionId: result.targetExtractionId,
  expectedOperations: expectedOperations(result.comparison.byPosition),
  suggestedOperations: suggestedOperations(result.comparison.byPosition),
  referenceSampleIds: result.topReferences.map((reference) => reference.sampleId),
  warnings: result.warnings
}));
const evaluation = evaluateAiRoutingHoldouts({
  evaluationSampleIds: smoke.results.map((result) => result.readableId),
  validProcessIds,
  cases
});
const baselineRows = new Map(
  (baseline.normalizedRows ?? []).map((row: any) => [row.readableId, row])
);
const normalizedRows = evaluation.caseResults.map((row, index) => {
  const readableId = smoke.results[index]?.readableId ?? row.targetItemId;
  return {
    readableId,
    normalizedExactSequenceMatch: row.normalizedExactSequenceMatch,
    normalizedPositionMatchCount: row.normalizedPositionMatchCount,
    actualOperationCount: row.expectedOperationCount,
    suggestedOperationCount: row.suggestedOperationCount,
    operationCountDelta: operationCountDelta(row),
    warningCount: smoke.results[index]?.warningCount ?? row.warnings.length
  };
});
const normalizedMismatches = normalizedRows
  .filter((row) => !row.normalizedExactSequenceMatch)
  .map((row) => row.readableId);
const improvedFromBaseline = normalizedRows
  .filter((row) => {
    const before = baselineRows.get(row.readableId) as any;
    return before && !before.normalizedExactSequenceMatch && row.normalizedExactSequenceMatch;
  })
  .map((row) => row.readableId);
const regressedFromBaseline = normalizedRows
  .filter((row) => {
    const before = baselineRows.get(row.readableId) as any;
    return before && before.normalizedExactSequenceMatch && !row.normalizedExactSequenceMatch;
  })
  .map((row) => row.readableId);
const operationCountImprovedFromBaseline = normalizedRows
  .filter((row) => {
    const before = baselineRows.get(row.readableId) as any;
    return before && Math.abs(row.operationCountDelta) < Math.abs(before.operationCountDelta);
  })
  .map((row) => row.readableId);
const operationCountRegressedFromBaseline = normalizedRows
  .filter((row) => {
    const before = baselineRows.get(row.readableId) as any;
    return before && Math.abs(row.operationCountDelta) > Math.abs(before.operationCountDelta);
  })
  .map((row) => row.readableId);
const output = {
  evaluatedAt: new Date().toISOString(),
  sourceEvaluationFile: inputPath,
  baselineFile: baselinePath,
  holdoutCount: smoke.holdoutCount,
  trainingSampleCount: smoke.trainingSampleCount,
  rawExactSequenceMatches: evaluation.metrics.rawExactSequenceMatches,
  normalizedExactSequenceMatches: evaluation.metrics.normalizedExactSequenceMatches,
  operationCountMatches: normalizedRows.filter((row) => row.operationCountDelta === 0).length,
  underPredicted: normalizedRows.filter((row) => row.operationCountDelta < 0).length,
  overPredicted: normalizedRows.filter((row) => row.operationCountDelta > 0).length,
  warningRows: normalizedRows.filter((row) => row.warningCount > 0).length,
  totalEvaluationLeaks: smoke.totalEvaluationLeaks,
  totalWorkCenterAssignments: smoke.totalWorkCenterAssignments,
  totalUnsupportedWorkCenterAssignments: smoke.totalUnsupportedWorkCenterAssignments,
  totalMissingProcessIds: smoke.totalMissingProcessIds,
  invalidProcessIdCount: smoke.invalidProcessIds.length,
  invalidProcessIds: smoke.invalidProcessIds,
  normalizedMismatches,
  improvedFromBaseline,
  regressedFromBaseline,
  operationCountImprovedFromBaseline,
  operationCountRegressedFromBaseline,
  baselineComparison: {
    normalizedExactSequenceMatches: `${baseline.normalizedExactSequenceMatches} -> ${evaluation.metrics.normalizedExactSequenceMatches}`,
    operationCountMatches: `${baseline.operationCountMatches} -> ${normalizedRows.filter((row) => row.operationCountDelta === 0).length}`,
    underPredicted: `${baseline.underPredicted} -> ${normalizedRows.filter((row) => row.operationCountDelta < 0).length}`,
    overPredicted: `${baseline.overPredicted} -> ${normalizedRows.filter((row) => row.operationCountDelta > 0).length}`,
    warningRows: `${baseline.warningRows} -> ${normalizedRows.filter((row) => row.warningCount > 0).length}`
  },
  normalizedRows
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));