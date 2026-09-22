import { describe, expect, it } from "vitest";
import {
  buildAiRoutingEvaluationRunRecord,
  evaluateAiRoutingHoldouts,
  normalizeAiRoutingProcessSemanticName
} from "./ai-routing-evaluation";
import {
  assertAiRoutingEvaluationRunAuthorization,
  persistAiRoutingEvaluationRun
} from "./ai-routing-evaluation.server";

const expectedOperations = [
  {
    order: 10,
    processId: "wodiprocess-issue",
    processName: "U8 LL01 领料工作中心"
  },
  {
    order: 20,
    processId: "wodiprocess-laser",
    processName: "U8 XJG01 数控激光切割（下料）"
  },
  {
    order: 30,
    processId: "wodiprocess-bend",
    processName: "U8 CSZ01 数控折弯(下料）"
  }
];

const suggestedOperations = [
  {
    order: 10,
    processId: "u8proc-issue",
    processName: "领料工作中心"
  },
  {
    order: 20,
    processId: "u8proc-laser",
    processName: "数控激光切割(下料)"
  },
  {
    order: 30,
    processId: "u8proc-bend",
    processName: "数控折弯（下料）"
  }
];

describe("AI routing holdout evaluation", () => {
  it("keeps raw process IDs separate while matching source-normalized semantics", () => {
    expect(
      normalizeAiRoutingProcessSemanticName(" U8 XJG01 数控激光切割（下料） ")
    ).toBe("数控激光切割(下料)");

    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["evaluation-sample-1"],
      validProcessIds: suggestedOperations.map(
        (operation) => operation.processId
      ),
      cases: [
        {
          evaluationSampleId: "evaluation-sample-1",
          targetItemId: "part-1",
          targetExtractionId: "extraction-1",
          expectedOperations,
          suggestedOperations,
          referenceSampleIds: ["training-sample-1"],
          warnings: []
        }
      ]
    });

    expect(evaluation.caseResults[0]).toMatchObject({
      rawExactSequenceMatch: false,
      normalizedExactSequenceMatch: true,
      semanticPrecision: 1,
      semanticRecall: 1,
      semanticF1: 1,
      evaluationLeakCount: 0,
      workCenterAssignmentCount: 0,
      unsupportedWorkCenterAssignmentCount: 0,
      missingProcessIdCount: 0,
      invalidProcessIds: []
    });
    expect(evaluation.metrics).toMatchObject({
      holdoutCount: 1,
      rawExactSequenceMatches: 0,
      normalizedExactSequenceMatches: 1,
      semanticPrecision: 1,
      semanticRecall: 1,
      semanticF1: 1,
      totalEvaluationLeaks: 0,
      totalWorkCenterAssignments: 0,
      totalUnsupportedWorkCenterAssignments: 0,
      totalMissingProcessIds: 0,
      invalidProcessIds: []
    });
  });

  it("normalizes ordinary lathe model suffixes as one semantic process family", () => {
    expect(
      normalizeAiRoutingProcessSemanticName("普通车床CA6150B/A×2000（机加工）")
    ).toBe("普通车床(机加工)");
    expect(
      normalizeAiRoutingProcessSemanticName(
        "U8 JPC01 普通车床CA6140A×2000(机加工）"
      )
    ).toBe("普通车床(机加工)");

    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["lathe-holdout"],
      validProcessIds: ["u8proc-issue", "u8proc-laser", "u8proc-turn"],
      cases: [
        {
          evaluationSampleId: "lathe-holdout",
          targetItemId: "part-lathe",
          targetExtractionId: "extraction-lathe",
          expectedOperations: [
            {
              order: 10,
              processId: "wodiprocess-issue",
              processName: "领料工作中心"
            },
            {
              order: 20,
              processId: "wodiprocess-laser",
              processName: "数控激光切割（下料）"
            },
            {
              order: 30,
              processId: "wodiprocess-turn-6150",
              processName: "普通车床CA6150B/A×2000（机加工）"
            }
          ],
          suggestedOperations: [
            {
              order: 10,
              processId: "u8proc-issue",
              processName: "U8 LL01 领料工作中心"
            },
            {
              order: 20,
              processId: "u8proc-laser",
              processName: "U8 XJG01 数控激光切割（下料）"
            },
            {
              order: 30,
              processId: "u8proc-turn",
              processName: "U8 JPC01 普通车床CA6140A×2000(机加工）"
            }
          ],
          referenceSampleIds: ["training-lathe"]
        }
      ]
    });

    expect(evaluation.caseResults[0]).toMatchObject({
      rawExactSequenceMatch: false,
      normalizedExactSequenceMatch: true,
      semanticPrecision: 1,
      semanticRecall: 1,
      semanticF1: 1
    });
  });
  it("reports leakage and invalid or unsupported recommendations without hiding them", () => {
    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["evaluation-sample-1", "evaluation-sample-2"],
      validProcessIds: ["u8proc-issue"],
      cases: [
        {
          evaluationSampleId: "evaluation-sample-1",
          targetItemId: "part-1",
          targetExtractionId: "extraction-1",
          expectedOperations,
          suggestedOperations: [
            suggestedOperations[0],
            {
              ...suggestedOperations[1],
              workCenterId: "work-center-unverified"
            },
            {
              order: 30,
              processId: null,
              processName: "打磨(碳钢)"
            }
          ],
          referenceSampleIds: ["evaluation-sample-2"],
          warnings: ["review required"]
        }
      ]
    });

    expect(evaluation.caseResults[0]).toMatchObject({
      normalizedExactSequenceMatch: false,
      evaluationLeakCount: 1,
      workCenterAssignmentCount: 1,
      unsupportedWorkCenterAssignmentCount: 1,
      missingProcessIdCount: 1,
      invalidProcessIds: ["u8proc-laser"]
    });
    expect(evaluation.metrics.totalEvaluationLeaks).toBe(1);
    expect(evaluation.metrics.totalUnsupportedWorkCenterAssignments).toBe(1);
    expect(evaluation.metrics.invalidProcessIds).toEqual(["u8proc-laser"]);
    expect(evaluation.metrics.semanticF1).toBeLessThan(1);
  });

  it("builds an immutable completed run record with explicit provenance", () => {
    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["evaluation-sample-1"],
      validProcessIds: suggestedOperations.map(
        (operation) => operation.processId
      ),
      cases: [
        {
          evaluationSampleId: "evaluation-sample-1",
          targetItemId: "part-1",
          targetExtractionId: "extraction-1",
          expectedOperations,
          suggestedOperations,
          referenceSampleIds: ["training-sample-1"]
        }
      ]
    });

    const record = buildAiRoutingEvaluationRunRecord({
      companyId: "company-1",
      userId: "user-1",
      trainingSampleIds: ["training-sample-1"],
      evaluationSampleIds: ["evaluation-sample-1"],
      generatorVersion: "ai-routing-draft.v1",
      promptVersion: "ai-routing-drawing.prompt.v2",
      extractorSchemaVersion: "ai-routing-drawing.v1",
      modelProvider: "openai",
      modelName: "gpt-5.6-terra",
      evaluation,
      completedAt: new Date("2026-08-20T01:00:00.000Z")
    });

    expect(record).toMatchObject({
      companyId: "company-1",
      status: "Succeeded",
      trainingSampleIds: ["training-sample-1"],
      evaluationSampleIds: ["evaluation-sample-1"],
      generatorVersion: "ai-routing-draft.v1",
      promptVersion: "ai-routing-drawing.prompt.v2",
      extractorSchemaVersion: "ai-routing-drawing.v1",
      modelProvider: "openai",
      modelName: "gpt-5.6-terra",
      createdBy: "user-1",
      completedAt: "2026-08-20T01:00:00.000Z"
    });
    expect(record.caseResults).toEqual(evaluation.caseResults);
    expect(record.metrics).toEqual(evaluation.metrics);
  });
  it("marks small holdout sets as ineligible for the production quality gate", () => {
    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["holdout-1", "holdout-2", "holdout-3", "holdout-4"],
      validProcessIds: suggestedOperations.map(
        (operation) => operation.processId
      ),
      cases: ["holdout-1", "holdout-2", "holdout-3", "holdout-4"].map(
        (evaluationSampleId, index) => ({
          evaluationSampleId,
          targetItemId: `part-${index + 1}`,
          targetExtractionId: `extraction-${index + 1}`,
          expectedOperations,
          suggestedOperations,
          referenceSampleIds: ["training-sample-1"]
        })
      )
    });

    expect(evaluation.metrics.productionGate).toEqual({
      eligible: false,
      minimumHoldouts: 30,
      reason: "Requires at least 30 representative holdouts; evaluated 4."
    });
  });

  it("rejects overlap between Training and Evaluation snapshots", () => {
    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["sample-shared"],
      validProcessIds: [],
      cases: []
    });

    expect(() =>
      buildAiRoutingEvaluationRunRecord({
        companyId: "company-1",
        userId: "user-1",
        trainingSampleIds: ["sample-shared"],
        evaluationSampleIds: ["sample-shared"],
        generatorVersion: "ai-routing-draft.v1",
        extractorSchemaVersion: "ai-routing-drawing.v1",
        evaluation,
        completedAt: new Date("2026-08-20T01:00:00.000Z")
      })
    ).toThrow(/overlap/i);
  });
  it("requires both view and update permission before evaluation persistence", () => {
    expect(() =>
      assertAiRoutingEvaluationRunAuthorization({
        partsView: true,
        partsUpdate: false
      })
    ).toThrow(/permission/i);
    expect(() =>
      assertAiRoutingEvaluationRunAuthorization({
        partsView: true,
        partsUpdate: true
      })
    ).not.toThrow();
  });

  it("persists one immutable run as an atomic insert", async () => {
    const inserted: Record<string, unknown>[] = [];
    const isSqlExpression = (value: unknown) =>
      Boolean(value && typeof value === "object" && "toOperationNode" in value);
    const database = {
      insertInto: () => {
        const builder = {
          values: (value: Record<string, unknown>) => {
            if (!isSqlExpression(value.caseResults)) {
              throw new Error(
                "caseResults must use an explicit jsonb expression"
              );
            }
            if (!isSqlExpression(value.metrics)) {
              throw new Error("metrics must use an explicit jsonb expression");
            }
            inserted.push(value);
            return builder;
          },
          returning: () => builder,
          executeTakeFirstOrThrow: async () => ({ id: "airer-test" })
        };
        return builder;
      }
    };

    const evaluation = evaluateAiRoutingHoldouts({
      evaluationSampleIds: ["evaluation-sample-1"],
      validProcessIds: [],
      cases: []
    });
    const record = buildAiRoutingEvaluationRunRecord({
      companyId: "company-1",
      userId: "user-1",
      trainingSampleIds: ["training-sample-1"],
      evaluationSampleIds: ["evaluation-sample-1"],
      generatorVersion: "generator.v1",
      extractorSchemaVersion: "extractor.v1",
      evaluation,
      completedAt: new Date("2026-08-20T01:00:00.000Z")
    });

    await expect(
      persistAiRoutingEvaluationRun(database as never, record, {
        partsView: true,
        partsUpdate: true
      })
    ).resolves.toBe("airer-test");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      companyId: "company-1",
      status: "Succeeded",
      trainingSampleIds: ["training-sample-1"],
      evaluationSampleIds: ["evaluation-sample-1"]
    });
  });
});
