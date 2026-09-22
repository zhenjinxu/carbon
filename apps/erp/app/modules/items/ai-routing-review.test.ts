import { describe, expect, it } from "vitest";
import type { AiRoutingDraft, AiRoutingTargetEvidence } from "./ai-routing";
import {
  aiRoutingReviewedOperationKey,
  buildAiRoutingConfirmedRouteSnapshot,
  buildAiRoutingHumanReviewModel,
  parseAiRoutingConfirmedRouteSnapshot,
  reviewedAiRoutingOperations,
  updateAiRoutingReviewedOperation
} from "./ai-routing-review";

describe("AI routing human review model", () => {
  it("separates PDF evidence, draft source samples, and formal-routing guardrails", () => {
    const targetEvidence: AiRoutingTargetEvidence = {
      id: "aide-1",
      itemId: "part-1",
      readableId: "1927930202",
      name: "Panel bracket",
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "孔", "折弯"],
      drawingWarnings: ["Finish was not visible on the drawing."],
      drawingEvidence: [
        {
          kind: "hole",
          sourceId: "hole-1",
          evidenceId: "ev-hole",
          label: "2X Ø6.6",
          pageNumber: 1,
          text: "2X Ø6.6 THRU",
          confidence: 0.92
        },
        {
          kind: "bend",
          sourceId: "bend-1",
          evidenceId: "ev-bend",
          label: "90° bend",
          pageNumber: 1,
          text: "90° ±1°",
          confidence: 0.87
        }
      ]
    };
    const draft: AiRoutingDraft = {
      status: "Draft",
      targetItemId: "part-1",
      suggestedOperations: [
        {
          order: 1,
          processId: "proc-laser",
          processName: "Laser cut",
          workCenterId: null,
          workCenterName: null,
          sourceSampleId: "sample-1",
          sourceOperationOrder: 20
        }
      ],
      references: [
        {
          sampleId: "sample-1",
          itemId: "sample-part-1",
          readableId: "1924371005",
          name: "Similar bracket",
          score: 50,
          matched: {
            materialTags: ["304"],
            featureTags: ["板件", "折弯"],
            processTags: [],
            resourceTags: []
          },
          matchedDrawingEvidence: [targetEvidence.drawingEvidence![1]!]
        }
      ],
      warnings: []
    };

    const model = buildAiRoutingHumanReviewModel({ targetEvidence, draft });

    expect(model.pdfEvidence).toMatchObject({
      available: true,
      drawingEvidenceCount: 2,
      warningCount: 1,
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "孔", "折弯"]
    });
    expect(model.pdfEvidence.preview).toEqual([
      expect.objectContaining({ kind: "hole", text: "2X Ø6.6 THRU" }),
      expect.objectContaining({ kind: "bend", text: "90° ±1°" })
    ]);
    expect(model.draftEvidence).toMatchObject({
      suggestedOperationCount: 1,
      sourceSampleCount: 1,
      matchedDrawingEvidenceCount: 1
    });
    expect(model.checkpoints).toEqual(
      expect.arrayContaining([
        { key: "pdfEvidenceAvailable", satisfied: true },
        { key: "draftOperationsAvailable", satisfied: true },
        { key: "sourceSamplesAvailable", satisfied: true },
        { key: "formalRoutingUnchanged", satisfied: true }
      ])
    );
  });

  it("keeps the formal-routing guardrail visible when PDF evidence is missing", () => {
    const model = buildAiRoutingHumanReviewModel({
      targetEvidence: null,
      draft: null
    });

    expect(model.pdfEvidence.available).toBe(false);
    expect(model.draftEvidence.suggestedOperationCount).toBe(0);
    expect(model.checkpoints).toEqual(
      expect.arrayContaining([
        { key: "pdfEvidenceAvailable", satisfied: false },
        { key: "formalRoutingUnchanged", satisfied: true }
      ])
    );
  });
  it("builds a confirmed route snapshot from reviewed operation edits without mutating the original suggestion", () => {
    const draft: AiRoutingDraft = {
      status: "Draft",
      targetItemId: "part-1",
      suggestedOperations: [
        {
          order: 1,
          processId: "proc-laser",
          processName: "Laser cut",
          description: "Laser cut blank",
          workCenterId: null,
          workCenterName: null,
          sourceSampleId: "sample-1",
          sourceOperationOrder: 10
        },
        {
          order: 2,
          processId: "proc-tap",
          processName: "Tap",
          description: "Tap M6 holes",
          workCenterId: null,
          workCenterName: null,
          sourceSampleId: "sample-2",
          sourceOperationOrder: 30
        }
      ],
      references: [
        {
          sampleId: "sample-1",
          itemId: "sample-part-1",
          readableId: "1927930207",
          name: "Similar tapped plate",
          score: 48,
          matched: {
            materialTags: ["304"],
            featureTags: ["孔"],
            processTags: [],
            resourceTags: []
          },
          matchedDrawingEvidence: []
        },
        {
          sampleId: "sample-2",
          itemId: "sample-part-2",
          readableId: "1927930203",
          name: "Similar laser part",
          score: 42,
          matched: {
            materialTags: ["304"],
            featureTags: ["板件"],
            processTags: [],
            resourceTags: []
          },
          matchedDrawingEvidence: []
        }
      ],
      warnings: ["Review tap order before publishing."]
    };

    const reviewed = reviewedAiRoutingOperations(draft);
    const updated = updateAiRoutingReviewedOperation({
      operations: reviewed,
      operationKey: aiRoutingReviewedOperationKey(reviewed[1]!),
      patch: { description: "Deburr and tap M6 holes" }
    });
    const snapshot = buildAiRoutingConfirmedRouteSnapshot({
      draft,
      reviewedOperations: updated
    });

    expect(draft.suggestedOperations[1]!.description).toBe("Tap M6 holes");
    expect(snapshot.suggestedOperations).not.toBe(draft.suggestedOperations);
    expect(snapshot).toMatchObject({
      status: "Technologist reviewed",
      targetItemId: "part-1",
      formalRoutingAction: "not-published",
      referenceSampleIds: ["sample-1", "sample-2"],
      warnings: ["Review tap order before publishing."],
      suggestedOperations: [
        expect.objectContaining({ description: "Laser cut blank" }),
        expect.objectContaining({ description: "Deburr and tap M6 holes" })
      ]
    });
  });
  it("parses confirmed route snapshots and treats missing or malformed payloads as null", () => {
    const snapshot = {
      status: "Technologist reviewed",
      targetItemId: "part-1",
      formalRoutingAction: "not-published",
      suggestedOperations: [],
      referenceSampleIds: ["sample-1"],
      warnings: []
    };

    expect(
      parseAiRoutingConfirmedRouteSnapshot(JSON.stringify(snapshot))
    ).toEqual(snapshot);
    expect(parseAiRoutingConfirmedRouteSnapshot("")).toBeNull();
    expect(parseAiRoutingConfirmedRouteSnapshot("not-json")).toBeNull();
  });
});
