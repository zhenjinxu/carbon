import type { AiRoutingDrawingExtraction } from "@carbon/lib/ai-routing-drawing";
import { describe, expect, it } from "vitest";
import {
  type AiRoutingSample,
  aiRoutingTargetEvidence,
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  rankSimilarRoutingSamples,
  routingKnowledgeTags
} from "./ai-routing";

const laserBendSample = {
  id: "sample-laser-bend",
  itemId: "part-1",
  readableId: "1927930203",
  status: "Approved" as const,
  datasetRole: "Training" as const,
  name: "连接板 6061-T6 L=480",
  materialTags: ["6061", "铝"],
  featureTags: ["板件", "孔", "折弯"],
  processTags: ["激光切割", "折弯", "攻丝"],
  resourceTags: ["XJG01", "CSZ01", "JQG01"],
  operations: [
    {
      order: 10,
      processId: "proc-ll",
      processName: "领料工作中心",
      workCenterId: "wc-ll",
      workCenterName: "LL01",
      description: "领料"
    },
    {
      order: 20,
      processId: "proc-laser",
      processName: "数控激光切割",
      workCenterId: "wc-laser",
      workCenterName: "XJG01",
      description: "下料"
    },
    {
      order: 30,
      processId: "proc-bend",
      processName: "数控折弯",
      workCenterId: "wc-bend",
      workCenterName: "CSZ01",
      description: "折弯"
    }
  ]
};

const weldingSample = {
  id: "sample-welding",
  itemId: "part-2",
  readableId: "192793020200",
  status: "Approved" as const,
  datasetRole: "Training" as const,
  name: "焊接支架 碳钢",
  materialTags: ["碳钢"],
  featureTags: ["焊接件", "支架"],
  processTags: ["焊接", "打磨"],
  resourceTags: ["BPZ01", "BYH03", "MDM01"],
  operations: [
    {
      order: 10,
      processId: "proc-fitup",
      processName: "板焊拼装",
      workCenterId: "wc-fitup",
      workCenterName: "BPZ01",
      description: "拼装"
    }
  ]
};

describe("AI routing knowledge helpers", () => {
  it("extracts deterministic knowledge tags from part and operation text", () => {
    expect(
      routingKnowledgeTags({
        item: {
          readableId: "1927930206",
          name: "铝合金连接板 6061-T6",
          description: "带攻丝孔，需要外协氧化"
        },
        operations: [
          {
            processName: "数控激光切割（下料）",
            workCenterName: "XJG01"
          },
          {
            processName: "气动攻丝机（机加工）",
            workCenterName: "JQG01"
          }
        ]
      })
    ).toMatchObject({
      materialTags: ["6061", "铝"],
      featureTags: ["板件", "孔"],
      processTags: ["激光切割", "攻丝", "下料"],
      resourceTags: ["xjg01", "jqg01"]
    });
  });

  it("removes route-derived answers from target evidence", () => {
    const evidence = aiRoutingTargetEvidence({
      ...laserBendSample,
      processTags: ["hidden-target-process"],
      resourceTags: ["hidden-target-resource"],
      operations: [
        {
          order: 10,
          processName: "hidden-target-process",
          workCenterName: "hidden-target-resource"
        }
      ]
    });

    expect(evidence).not.toHaveProperty("operations");
    expect(evidence).not.toHaveProperty("processTags");
    expect(evidence).not.toHaveProperty("resourceTags");
    expect(evidence.featureTags).toEqual(["板件", "孔", "折弯"]);
  });

  it("ranks similar samples by PDF-visible material and features", () => {
    const ranked = rankSimilarRoutingSamples({
      target: {
        id: "target",
        itemId: "target-part",
        readableId: "1927930205",
        name: "6061 铝板带孔折弯件",
        materialTags: ["6061", "铝"],
        featureTags: ["板件", "孔", "折弯"]
      },
      samples: [weldingSample, laserBendSample]
    });

    expect(ranked[0]).toMatchObject({
      sampleId: "sample-laser-bend",
      matched: {
        materialTags: ["6061", "铝"],
        featureTags: ["板件", "孔", "折弯"],
        processTags: [],
        resourceTags: []
      }
    });
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("generates a traceable draft from the best similar approved sample", () => {
    const draft = generateAiRoutingDraft({
      target: {
        id: "target",
        itemId: "target-part",
        readableId: "1927930205",
        name: "6061 铝板带孔折弯件",
        materialTags: ["6061", "铝"],
        featureTags: ["板件", "孔", "折弯"]
      },
      samples: [weldingSample, laserBendSample]
    });

    expect(draft.status).toBe("Draft");
    expect(draft.suggestedOperations).toHaveLength(3);
    expect(draft.suggestedOperations[1]).toMatchObject({
      order: 20,
      processId: "proc-laser",
      sourceSampleId: "sample-laser-bend",
      sourceOperationOrder: 20
    });
    expect(draft.references[0]).toMatchObject({
      sampleId: "sample-laser-bend",
      readableId: "1927930203"
    });
  });

  it("does not generate operations when no sample has enough evidence", () => {
    const draft = generateAiRoutingDraft({
      target: {
        id: "target",
        itemId: "target-part",
        readableId: "X-001",
        name: "未知新品类",
        materialTags: ["塑料"],
        featureTags: ["注塑件"]
      },
      samples: [laserBendSample, weldingSample]
    });

    expect(draft.suggestedOperations).toEqual([]);
    expect(draft.warnings).toContain(
      "No approved routing sample met the minimum similarity threshold."
    );
  });

  it("uses only approved training samples for production retrieval", () => {
    const ranked = rankSimilarRoutingSamples({
      target: {
        id: "target",
        itemId: "target-part",
        readableId: laserBendSample.readableId,
        name: laserBendSample.name,
        materialTags: laserBendSample.materialTags,
        featureTags: laserBendSample.featureTags
      },
      samples: [
        {
          ...laserBendSample,
          id: "sample-candidate",
          itemId: "candidate-part",
          status: "Candidate"
        } as AiRoutingSample,
        {
          ...laserBendSample,
          id: "sample-evaluation",
          itemId: "evaluation-part",
          status: "Approved",
          datasetRole: "Evaluation"
        } as AiRoutingSample,
        {
          ...laserBendSample,
          id: "sample-training",
          itemId: "training-part",
          status: "Approved",
          datasetRole: "Training"
        } as AiRoutingSample
      ]
    });

    expect(ranked.map(({ sampleId }) => sampleId)).toEqual(["sample-training"]);
  });
  it("builds PDF-only target evidence and keeps drawing evidence traceable in draft references", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: {
        pageCount: 1,
        renderedPageCount: 1,
        contentHash: "a".repeat(64)
      },
      titleBlock: {
        partNumber: "1927930205",
        revision: null,
        material: "6061-T6 aluminum",
        finish: null,
        heatTreatment: null
      },
      part: { class: "sheet-metal", stockForm: "sheet" },
      dimensions: [
        {
          id: "dim-length",
          kind: "linear",
          label: "L=480",
          nominal: 480,
          unit: "mm",
          evidence: [
            {
              id: "ev-length",
              pageNumber: 1,
              text: "L=480",
              confidence: 0.96
            }
          ]
        }
      ],
      features: {
        holes: [
          {
            id: "hole-1",
            label: "mounting holes",
            quantity: 2,
            diameter: 6.5,
            unit: "mm",
            thread: null,
            evidence: [
              {
                id: "ev-hole",
                pageNumber: 1,
                text: "2X Ø6.5 THRU",
                confidence: 0.93
              }
            ]
          }
        ],
        threads: [],
        slots: [],
        pockets: [],
        bends: [
          {
            id: "bend-1",
            label: "90 degree flange",
            quantity: 1,
            angle: 90,
            radius: 2,
            unit: "mm",
            evidence: [
              {
                id: "ev-bend",
                pageNumber: 1,
                text: "BEND 90° R2",
                confidence: 0.9
              }
            ]
          }
        ],
        welds: [],
        surfaces: []
      },
      notes: [],
      explicitUnknowns: [],
      warnings: ["verify bend direction"]
    } satisfies AiRoutingDrawingExtraction;

    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "target-evidence",
      itemId: "target-part",
      item: {
        readableId: "1927930205",
        name: "PDF target with hidden route answers",
        customFields: {
          processTags: ["hidden-target-process"],
          resourceTags: ["hidden-target-resource"]
        }
      },
      drawingExtraction
    });

    expect(target).not.toHaveProperty("operations");
    expect(target).not.toHaveProperty("processTags");
    expect(target).not.toHaveProperty("resourceTags");
    expect(JSON.stringify(target)).not.toContain("hidden-target-process");
    expect(JSON.stringify(target)).not.toContain("hidden-target-resource");
    expect(target.materialTags).toEqual(["6061", "铝"]);
    expect(target.featureTags).toEqual(
      expect.arrayContaining(["板件", "孔", "折弯"])
    );
    expect(target.drawingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hole",
          pageNumber: 1,
          text: "2X Ø6.5 THRU"
        }),
        expect.objectContaining({
          kind: "bend",
          pageNumber: 1,
          text: "BEND 90° R2"
        })
      ])
    );

    const draft = generateAiRoutingDraft({
      target,
      samples: [
        {
          ...laserBendSample,
          id: "sample-evaluation",
          itemId: "evaluation-part",
          datasetRole: "Evaluation"
        },
        laserBendSample
      ]
    });

    expect(draft.references.map((reference) => reference.sampleId)).toEqual([
      "sample-laser-bend"
    ]);
    expect(draft.references[0]?.matchedDrawingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "hole", evidenceId: "ev-hole" }),
        expect.objectContaining({ kind: "bend", evidenceId: "ev-bend" })
      ])
    );
  });
  it("prefers tied references that have matched drawing evidence", () => {
    const ranked = rankSimilarRoutingSamples({
      target: {
        id: "target",
        itemId: "target-part",
        materialTags: ["304"],
        featureTags: ["板件", "孔"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "mounting hole",
            pageNumber: 1,
            text: "Ø6.5 THRU",
            confidence: 0.9
          }
        ]
      },
      samples: [
        {
          ...laserBendSample,
          id: "aaa-plate-only",
          itemId: "plate-only",
          materialTags: ["304"],
          featureTags: ["板件"]
        },
        {
          ...laserBendSample,
          id: "zzz-hole-evidence",
          itemId: "hole-evidence",
          materialTags: ["304"],
          featureTags: ["孔"]
        }
      ]
    });

    expect(ranked.map((reference) => reference.sampleId)).toEqual([
      "zzz-hole-evidence",
      "aaa-plate-only"
    ]);
    expect(ranked[0]?.matchedDrawingEvidence).toEqual([
      expect.objectContaining({ kind: "hole", evidenceId: "ev-hole" })
    ]);
  });
});
