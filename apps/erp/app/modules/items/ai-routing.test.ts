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

const laserBendWeldGrindSample: AiRoutingSample = {
  ...laserBendSample,
  id: "sample-laser-bend-weld-grind",
  itemId: "laser-bend-weld-grind-part",
  readableId: "1927440703",
  name: "电机底座连接板A",
  materialTags: ["304", "不锈钢"],
  featureTags: ["板件", "折弯", "焊接件"],
  processTags: ["激光切割", "折弯", "焊接", "打磨"],
  resourceTags: ["XJG01", "CSZ01", "BYH01", "MDM02"],
  operations: [
    ...laserBendSample.operations,
    {
      order: 40,
      processId: "proc-weld",
      processName: "氩弧焊（食品）",
      workCenterId: "wc-weld",
      workCenterName: "BYH01",
      description: "焊接"
    },
    {
      order: 50,
      processId: "proc-grind",
      processName: "打磨拉丝抛光（食品）",
      workCenterId: "wc-grind",
      workCenterName: "MDM02",
      description: "打磨"
    }
  ]
};

const drillTapReferenceSample: AiRoutingSample = {
  id: "sample-drill-tap-reference",
  itemId: "drill-tap-reference-part",
  readableId: "1927326104",
  status: "Approved",
  datasetRole: "Training",
  name: "304 孔螺纹件",
  materialTags: ["6061", "铝"],
  featureTags: ["孔", "螺纹"],
  processTags: ["钻孔", "攻丝"],
  resourceTags: ["ZK01", "JQG01"],
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
      processId: "proc-drill",
      processName: "摇臂钻床（机加工）",
      workCenterId: "wc-drill",
      workCenterName: "ZK01",
      description: "钻孔"
    },
    {
      order: 30,
      processId: "proc-tap",
      processName: "气动攻丝机（机加工）",
      workCenterId: "wc-tap",
      workCenterName: "JQG01",
      description: "攻丝"
    }
  ]
};

const drillMillOxidizeSample: AiRoutingSample = {
  id: "sample-drill-mill-oxidize",
  itemId: "drill-mill-oxidize-part",
  readableId: "192672060101",
  status: "Approved",
  datasetRole: "Training",
  name: "连接板1 外协氧化",
  materialTags: ["6061", "铝"],
  featureTags: ["孔", "螺纹"],
  processTags: ["铣削", "攻丝", "氧化"],
  resourceTags: ["JSX01", "JQG01", "WDX01"],
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
      processId: "proc-mill",
      processName: "数显立铣",
      workCenterId: "wc-mill",
      workCenterName: "JSX01",
      description: "铣削"
    },
    {
      order: 30,
      processId: "proc-tap",
      processName: "气动攻丝机（机加工）",
      workCenterId: "wc-tap",
      workCenterName: "JQG01",
      description: "攻丝"
    },
    {
      order: 40,
      processId: "proc-oxidize",
      processName: "外协氧化",
      workCenterId: "wc-oxidize",
      workCenterName: "WDX01",
      description: "外协氧化"
    }
  ]
};

const _laserTapNoBendSample: AiRoutingSample = {
  ...laserBendSample,
  id: "sample-laser-tap-no-bend",
  itemId: "laser-tap-no-bend-part",
  readableId: "19277003010106",
  name: "焊接板攻丝件",
  featureTags: ["板件", "孔", "螺纹"],
  processTags: ["激光切割", "攻丝"],
  resourceTags: ["XJG01", "JQG01"],
  operations: [
    laserBendSample.operations[0],
    laserBendSample.operations[1],
    {
      order: 30,
      processId: "proc-tap",
      processName: "气动攻丝机（机加工）",
      workCenterId: "wc-tap",
      workCenterName: "JQG01",
      description: "攻丝"
    }
  ]
};
function drawingExtraction(
  overrides: {
    titleBlock?: Partial<AiRoutingDrawingExtraction["titleBlock"]>;
    part?: Partial<AiRoutingDrawingExtraction["part"]>;
    features?: Partial<AiRoutingDrawingExtraction["features"]>;
    notes?: AiRoutingDrawingExtraction["notes"];
    dimensions?: AiRoutingDrawingExtraction["dimensions"];
  } = {}
): AiRoutingDrawingExtraction {
  return {
    schemaVersion: "ai-routing-drawing.v1",
    document: {
      pageCount: 1,
      renderedPageCount: 1,
      contentHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    titleBlock: {
      partNumber: "TEST-PART",
      revision: null,
      material: null,
      finish: null,
      heatTreatment: null,
      ...overrides.titleBlock
    },
    part: {
      class: "unknown",
      stockForm: "unknown",
      ...overrides.part
    },
    dimensions: overrides.dimensions ?? [],
    features: {
      holes: [],
      threads: [],
      slots: [],
      pockets: [],
      bends: [],
      welds: [],
      surfaces: [],
      ...overrides.features
    },
    notes: overrides.notes ?? [],
    explicitUnknowns: [],
    warnings: []
  };
}

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

  it("normalizes machining operation names into process tags", () => {
    expect(
      routingKnowledgeTags({
        operations: [
          { processName: "普通车床CA6140A×2000(机加工）" },
          { processName: "摇臂钻床（机加工）" }
        ]
      }).processTags
    ).toEqual(expect.arrayContaining(["车削", "钻孔"]));
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

  it("excludes component-scope and governance-disallowed samples from retrieval", () => {
    const keptSample: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-kept-laser-bend",
      itemId: "kept-laser-bend-part",
      name: "\u8fde\u63a5\u677f 6061-T6"
    };
    const componentSample: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-component-route",
      itemId: "component-route-part",
      name: "\u8f6c\u8f74\u5ea7\u7ec4\u4ef62"
    };
    const illegalLaserSample = {
      ...laserBendSample,
      id: "sample-illegal-laser-route",
      itemId: "illegal-laser-route-part",
      name: "\u65e0\u677f\u6750\u6fc0\u5149\u6837\u672c",
      customFields: {
        aiRoutingScope: {
          exclusionReasons: ["illegal_laser_no_plate"]
        }
      }
    } as AiRoutingSample;

    const ranked = rankSimilarRoutingSamples({
      target: {
        id: "target",
        itemId: "target-part",
        readableId: "1927930205",
        name: "6061 \u94dd\u677f\u5e26\u5b54\u6298\u5f2f\u4ef6",
        materialTags: ["6061", "\u94dd"],
        featureTags: ["\u677f\u4ef6", "\u5b54", "\u6298\u5f2f"]
      },
      samples: [componentSample, illegalLaserSample, keptSample]
    });

    expect(ranked.map((sample) => sample.sampleId)).toEqual([
      "sample-kept-laser-bend"
    ]);
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
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null]);
    expect(draft.warnings).toContain(
      "Work center recommendations are withheld until resource capability evidence is available."
    );
    expect(draft.references[0]).toMatchObject({
      sampleId: "sample-laser-bend",
      readableId: "1927930203"
    });
  });

  it("uses drawing-derived process hints without exposing route answers", () => {
    const plainRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-plain-route",
      itemId: "plain-route-part",
      processTags: ["激光切割", "折弯"]
    };
    const threadedRoute: AiRoutingSample = {
      ...plainRoute,
      id: "sample-threaded-route",
      itemId: "threaded-route-part",
      processTags: [],
      operations: [
        ...plainRoute.operations,
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };

    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "threaded-target",
      itemId: "threaded-target-part",
      drawingExtraction: {
        schemaVersion: "ai-routing-drawing.v1",
        titleBlock: {
          partNumber: "T-THREAD",
          revision: null,
          material: "6061-T6",
          finish: null,
          heatTreatment: null
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        dimensions: [],
        features: {
          holes: [],
          threads: [
            {
              id: "thread-1",
              label: "M6 threaded hole",
              quantity: 4,
              size: "M6",
              depth: null,
              unit: "mm",
              evidence: [
                {
                  id: "ev-thread",
                  pageNumber: 1,
                  text: "4XM6-6H",
                  confidence: 0.94
                }
              ]
            }
          ],
          slots: [],
          pockets: [],
          bends: [
            {
              id: "bend-1",
              label: "90° bend",
              quantity: 1,
              angle: 90,
              radius: null,
              unit: "mm",
              evidence: [
                {
                  id: "ev-bend",
                  pageNumber: 1,
                  text: "BEND 90°",
                  confidence: 0.9
                }
              ]
            }
          ],
          welds: [],
          surfaces: []
        },
        notes: [
          {
            id: "note-laser-compatible-stock",
            text: "Raw stock is suitable for laser cutting.",
            category: "material",
            evidence: [
              {
                id: "ev-laser-compatible-stock",
                pageNumber: 1,
                text: "laser cutting stock",
                confidence: 0.91
              }
            ]
          }
        ],
        explicitUnknowns: [],
        warnings: []
      } satisfies AiRoutingDrawingExtraction
    });

    expect(target).not.toHaveProperty("processTags");
    expect(target.processHints).toEqual(
      expect.arrayContaining(["激光切割", "折弯", "攻丝"])
    );

    const draft = generateAiRoutingDraft({
      target,
      samples: [plainRoute, threadedRoute]
    });

    expect(draft.references[0]?.sampleId).toBe("sample-threaded-route");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toContain("proc-tap");
  });
  it("does not infer laser cutting when material evidence says the stock is laser-unsuitable", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "laser-unsuitable-plate-target",
      itemId: "laser-unsuitable-plate-part",
      item: {
        readableId: "1927930206",
        name: "6061 plate with tapped holes"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "1927930206",
          material: "6061-T6"
        },
        part: { class: "machined", stockForm: "plate" },
        notes: [
          {
            id: "note-laser-unsuitable-stock",
            text: "Raw material is not suitable for laser cutting.",
            category: "material",
            evidence: [
              {
                id: "ev-laser-unsuitable-stock",
                pageNumber: 1,
                text: "not suitable for laser cutting",
                confidence: 0.96
              }
            ]
          }
        ],
        features: {
          holes: [
            {
              id: "hole-1",
              label: "Tapped hole",
              quantity: 2,
              diameter: 6,
              unit: "mm",
              thread: "M6",
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "2XM6",
                  confidence: 0.93
                }
              ]
            }
          ]
        }
      })
    });

    expect(target.featureTags).toEqual(
      expect.arrayContaining(["板件", "孔", "螺纹"])
    );
    expect(target.processHints).toEqual(expect.arrayContaining(["攻丝"]));
    expect(target.processHints).not.toContain("激光切割");
  });

  it("preserves laser cutting when sheet stock has explicit laser suitability evidence", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "laser-suitable-sheet-target",
      itemId: "laser-suitable-sheet-part",
      item: {
        readableId: "1927930202",
        name: "laser-compatible sheet part"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "1927930202",
          material: "laser cutting sheet stock"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        notes: [
          {
            id: "note-laser-stock",
            text: "Material/stock supports laser cutting.",
            category: "material",
            evidence: [
              {
                id: "ev-laser-stock",
                pageNumber: 1,
                text: "laser cutting sheet stock",
                confidence: 0.95
              }
            ]
          }
        ]
      })
    });

    expect(target.featureTags).toContain("板件");
    expect(target.processHints).toContain("激光切割");
  });

  it("does not classify push-plate connecting rods as plate parts", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "push-plate-rod-target",
      itemId: "push-plate-rod-part",
      item: {
        readableId: "192759010202",
        name: "推板连接杆"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192759010202",
          material: "304"
        },
        part: { class: "turned", stockForm: "bar" },
        dimensions: [
          {
            id: "dim-length",
            kind: "linear",
            label: "推板连接杆 length",
            nominal: 120,
            unit: "mm",
            evidence: [
              {
                id: "ev-dim-length",
                pageNumber: 1,
                text: "推板连接杆 L=120",
                confidence: 0.94
              }
            ]
          }
        ]
      })
    });

    expect(target.featureTags).not.toContain("板件");
    expect(target.processHints).not.toContain("激光切割");
  });

  it("does not infer shaft turning evidence from bearing-seat plate text", () => {
    const bearingSeatPlateTarget = aiRoutingTargetEvidenceFromDrawing({
      id: "bearing-seat-plate-target",
      itemId: "bearing-seat-plate-part",
      item: {
        readableId: "19267202210104",
        name: "\u8f74\u627f\u5ea7\u677f"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "19267202210104",
          material: "SUS304 2B\u5e73\u677f"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "bearing seat mounting hole",
              quantity: 4,
              diameter: 8,
              unit: "mm",
              thread: null,
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "4X \u00d88 THRU",
                  confidence: 0.93
                }
              ]
            }
          ]
        },
        dimensions: [
          {
            id: "dim-name",
            kind: "linear",
            label: "\u8f74\u627f\u5ea7\u677f length",
            nominal: 160,
            unit: "mm",
            evidence: [
              {
                id: "ev-bearing-seat-text",
                pageNumber: 1,
                text: "\u8f74\u627f\u5ea7\u677f",
                confidence: 0.95
              }
            ]
          }
        ]
      })
    });

    expect(bearingSeatPlateTarget.featureTags).toEqual(
      expect.arrayContaining(["\u677f\u4ef6", "\u5b54"])
    );
    expect(bearingSeatPlateTarget.featureTags).not.toContain("\u8f74\u7c7b");
    expect(bearingSeatPlateTarget.processHints).toContain(
      "\u6fc0\u5149\u5207\u5272"
    );
    expect(bearingSeatPlateTarget.processHints).not.toContain("\u8f66\u524a");

    const shaftPlateTarget = aiRoutingTargetEvidenceFromDrawing({
      id: "shaft-plate-target",
      itemId: "shaft-plate-part",
      item: {
        readableId: "19276939010203",
        name: "\u4e3b\u52a8\u8f74\u56fa\u5b9a\u677f"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "19276939010203",
          material: "SUS304 2B\u5e73\u677f"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "shaft center hole",
              quantity: 1,
              diameter: 28.2,
              unit: "mm",
              thread: null,
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "\u00d828.20",
                  confidence: 0.93
                }
              ]
            }
          ]
        },
        dimensions: [
          {
            id: "dim-name",
            kind: "linear",
            label: "\u4e3b\u52a8\u8f74\u56fa\u5b9a\u677f length",
            nominal: 160,
            unit: "mm",
            evidence: [
              {
                id: "ev-shaft-plate-text",
                pageNumber: 1,
                text: "\u4e3b\u52a8\u8f74\u56fa\u5b9a\u677f",
                confidence: 0.95
              }
            ]
          }
        ]
      })
    });

    expect(shaftPlateTarget.featureTags).toEqual(
      expect.arrayContaining(["\u677f\u4ef6", "\u5b54", "\u8f74\u7c7b"])
    );
    expect(shaftPlateTarget.processHints).toEqual(
      expect.arrayContaining(["\u6fc0\u5149\u5207\u5272", "\u8f66\u524a"])
    );
  });

  it("composes missing operations from secondary samples only when drawing evidence supports the process", () => {
    const baseRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-base-laser-bend",
      itemId: "base-laser-bend-part"
    };
    const threadedRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-thread-and-grind",
      itemId: "thread-and-grind-part",
      featureTags: ["孔"],
      operations: [
        {
          order: 10,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          workCenterId: "wc-tap",
          workCenterName: "JQG01",
          description: "攻丝"
        },
        {
          order: 20,
          processId: "proc-grind",
          processName: "打磨(碳钢)",
          workCenterId: "wc-grind",
          workCenterName: "MDM01",
          description: "领料"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "thread-evidence-target",
        itemId: "target-part",
        materialTags: ["6061", "铝"],
        featureTags: ["板件", "孔", "折弯"],
        processHints: ["攻丝"],
        drawingEvidence: [
          {
            kind: "thread",
            sourceId: "thread-1",
            evidenceId: "ev-thread",
            label: "M6",
            pageNumber: 1,
            text: "4XM6-6H",
            confidence: 0.94
          }
        ]
      },
      samples: [baseRoute, threadedRoute]
    });

    expect(draft.references[0]?.sampleId).toBe("sample-base-laser-bend");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser", "proc-bend", "proc-tap"]);
    expect(draft.suggestedOperations[3]).toMatchObject({
      order: 40,
      sourceSampleId: "sample-thread-and-grind",
      sourceOperationOrder: 10,
      workCenterId: null,
      workCenterName: null
    });
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-grind");
  });

  it("uses explicit weld and surface evidence to retain weld and polish operations", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "weld-surface-target",
      itemId: "weld-surface-part",
      item: {
        readableId: "1927440703",
        name: "电机底座连接板A"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "1927440703",
          material: "SUS304",
          finish: "打磨拉丝抛光"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          bends: [
            {
              id: "bend-1",
              label: "90° bend",
              angle: 90,
              unit: "deg",
              evidence: [
                {
                  id: "ev-bend-1",
                  pageNumber: 1,
                  text: "BEND 90°",
                  confidence: 0.93
                }
              ]
            }
          ],
          welds: [
            {
              id: "weld-1",
              label: "continuous fillet weld",
              weldType: "fillet",
              evidence: [
                {
                  id: "ev-weld-1",
                  pageNumber: 1,
                  text: "焊接后打磨",
                  confidence: 0.91
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-1",
              label: "polished food-contact surface",
              finish: "打磨拉丝抛光",
              evidence: [
                {
                  id: "ev-surface-1",
                  pageNumber: 1,
                  text: "表面打磨拉丝抛光",
                  confidence: 0.92
                }
              ]
            }
          ]
        }
      })
    });

    expect(target.processHints).toEqual(
      expect.arrayContaining(["激光切割", "折弯", "焊接", "打磨"])
    );

    const draft = generateAiRoutingDraft({
      target,
      samples: [laserBendSample, laserBendWeldGrindSample]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual([
      "proc-ll",
      "proc-laser",
      "proc-bend",
      "proc-weld",
      "proc-grind"
    ]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null, null]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterName)
    ).toEqual([null, null, null, null, null]);
  });
  it("finds weld and polish recovery candidates beyond the initial ranked window only with explicit evidence", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "weld-grind-reachability-target",
      itemId: "weld-grind-reachability-part",
      item: {
        readableId: "1927440704",
        name: "电机底座连接板B"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "1927440704",
          material: "SUS304",
          finish: "打磨拉丝抛光"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          bends: [
            {
              id: "bend-1",
              label: "90° bend",
              angle: 90,
              unit: "deg",
              evidence: [
                {
                  id: "ev-bend-1",
                  pageNumber: 1,
                  text: "BEND 90°",
                  confidence: 0.93
                }
              ]
            }
          ],
          welds: [
            {
              id: "weld-1",
              label: "continuous fillet weld",
              weldType: "fillet",
              evidence: [
                {
                  id: "ev-weld-1",
                  pageNumber: 1,
                  text: "焊接后打磨",
                  confidence: 0.91
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-1",
              label: "polished food-contact surface",
              finish: "打磨拉丝抛光",
              evidence: [
                {
                  id: "ev-surface-1",
                  pageNumber: 1,
                  text: "表面打磨拉丝抛光",
                  confidence: 0.92
                }
              ]
            }
          ]
        }
      })
    });
    const laserBendBaseRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "aaa-weld-grind-laser-bend-base",
      itemId: "weld-grind-laser-bend-base-part",
      readableId: "1927440704-base",
      name: "304 折弯板 base",
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "折弯"],
      processTags: ["激光切割", "折弯"],
      resourceTags: ["XJG01", "CSZ01"],
      operations: laserBendSample.operations
    };
    const laserBendDistractors: AiRoutingSample[] = Array.from(
      { length: 8 },
      (_, index): AiRoutingSample => ({
        ...laserBendBaseRoute,
        id: `aaa-weld-grind-distractor-${String(index).padStart(2, "0")}`,
        itemId: `weld-grind-distractor-part-${index}`,
        readableId: `1927440704-distractor-${index}`,
        name: "304 折弯板干扰件"
      })
    );
    const retainedWeldGrindRoute: AiRoutingSample = {
      id: "zzy-retained-weld-grind-route",
      itemId: "retained-weld-grind-part",
      readableId: "1927440703",
      status: "Approved",
      datasetRole: "Training",
      name: "电机底座连接板A",
      materialTags: [],
      featureTags: ["焊接件"],
      processTags: ["焊接", "打磨"],
      resourceTags: ["BYH01", "MDM02"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 40,
          processId: "proc-weld",
          processName: "氩弧焊（食品）",
          description: "焊接"
        },
        {
          order: 50,
          processId: "proc-grind",
          processName: "打磨拉丝抛光（食品）",
          description: "打磨"
        }
      ]
    };
    const millingPollutedWeldGrindRoute: AiRoutingSample = {
      ...retainedWeldGrindRoute,
      id: "zzz-polluted-weld-grind-milling-route",
      itemId: "polluted-weld-grind-milling-part",
      readableId: "19267205020101",
      name: "腔体板3",
      featureTags: ["焊接件", "槽"],
      processTags: ["焊接", "打磨", "铣削"],
      resourceTags: ["BYH01", "MDM02", "JLJ01"],
      operations: [
        ...retainedWeldGrindRoute.operations,
        {
          order: 45,
          processId: "proc-cnc",
          processName: "立式加工中心VMC850B(机加工）",
          description: "加工中心"
        }
      ]
    };

    expect(target.processHints).toEqual(
      expect.arrayContaining(["激光切割", "折弯", "焊接", "打磨"])
    );

    const draft = generateAiRoutingDraft({
      target,
      samples: [
        laserBendBaseRoute,
        ...laserBendDistractors,
        retainedWeldGrindRoute,
        millingPollutedWeldGrindRoute
      ]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual([
      "proc-ll",
      "proc-laser",
      "proc-bend",
      "proc-weld",
      "proc-grind"
    ]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-cnc");
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null, null]);
    expect(
      draft.references.some(
        (reference) => reference.sampleId === "zzy-retained-weld-grind-route"
      )
    ).toBe(true);
  });
  it("recovers the remaining shield weld/grind pair from explicit weld notes and polish evidence", () => {
    const laserBendBaseRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "aaa-shield-laser-bend-base",
      itemId: "shield-laser-bend-base-part",
      readableId: "192766040302-base",
      name: "SUS304 拉丝板折弯护罩 base",
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "折弯"],
      processTags: ["激光切割", "折弯"],
      resourceTags: ["XJG01", "CSZ01"],
      operations: laserBendSample.operations
    };
    const retainedShieldWeldGrindRoute: AiRoutingSample = {
      id: "zzy-retained-shield-weld-grind-route",
      itemId: "retained-shield-weld-grind-part",
      readableId: "192766040302",
      status: "Approved",
      datasetRole: "Training",
      name: "防护罩1",
      materialTags: [],
      featureTags: ["焊接件"],
      processTags: ["焊接", "打磨"],
      resourceTags: ["BYH03", "MDM01"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 40,
          processId: "proc-weld",
          processName: "氩弧焊（碳钢）",
          description: "焊接"
        },
        {
          order: 50,
          processId: "proc-grind",
          processName: "打磨（碳钢）",
          description: "打磨"
        }
      ]
    };

    for (const item of [
      { readableId: "192766040302", name: "防护罩1" },
      { readableId: "192766040304", name: "护罩2" }
    ]) {
      const target = aiRoutingTargetEvidenceFromDrawing({
        id: `${item.readableId}-weld-note-target`,
        itemId: `${item.readableId}-part`,
        item,
        drawingExtraction: drawingExtraction({
          titleBlock: {
            partNumber: item.readableId,
            material: "SUS304 拉丝板",
            finish: "打磨"
          },
          part: { class: "sheet-metal", stockForm: "sheet" },
          features: {
            bends: [
              {
                id: `${item.readableId}-bend-1`,
                label: "90° bend",
                angle: 90,
                unit: "deg",
                evidence: [
                  {
                    id: `${item.readableId}-ev-bend-1`,
                    pageNumber: 1,
                    text: "BEND 90°",
                    confidence: 0.93
                  }
                ]
              }
            ],
            surfaces: [
              {
                id: `${item.readableId}-surface-1`,
                label: "polished shield surface",
                finish: "打磨",
                evidence: [
                  {
                    id: `${item.readableId}-ev-surface-1`,
                    pageNumber: 1,
                    text: "表面打磨",
                    confidence: 0.92
                  }
                ]
              }
            ]
          },
          notes: [
            {
              id: `${item.readableId}-note-weld-grind`,
              text: "焊接后打磨",
              category: "process",
              evidence: [
                {
                  id: `${item.readableId}-ev-note-weld-grind`,
                  pageNumber: 1,
                  text: "焊接后打磨",
                  confidence: 0.91
                }
              ]
            }
          ]
        })
      });

      expect(target.processHints).toEqual(
        expect.arrayContaining(["激光切割", "折弯", "焊接", "打磨"])
      );
      expect(target.drawingEvidence?.some((fact) => fact.kind === "weld")).toBe(
        false
      );

      const draft = generateAiRoutingDraft({
        target,
        samples: [laserBendBaseRoute, retainedShieldWeldGrindRoute]
      });

      expect(
        draft.suggestedOperations.map((operation) => operation.processId)
      ).toEqual([
        "proc-ll",
        "proc-laser",
        "proc-bend",
        "proc-weld",
        "proc-grind"
      ]);
      expect(
        draft.suggestedOperations.map((operation) => operation.workCenterId)
      ).toEqual([null, null, null, null, null]);
    }
  });
  it("uses process-owner folded-edge closure confirmation as guarded weld evidence", () => {
    const laserBendBaseRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "aaa-human-confirmed-shield-laser-bend-base",
      itemId: "human-confirmed-shield-base-part",
      readableId: "192766040302-base",
      name: "SUS304 拉丝板折弯护罩 base",
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "折弯"],
      processTags: ["激光切割", "折弯"],
      resourceTags: ["XJG01", "CSZ01"],
      operations: laserBendSample.operations
    };
    const retainedShieldWeldGrindRoute: AiRoutingSample = {
      id: "zzy-human-confirmed-shield-weld-grind-route",
      itemId: "human-confirmed-shield-weld-grind-part",
      readableId: "192766040302",
      status: "Approved",
      datasetRole: "Training",
      name: "防护罩1",
      materialTags: [],
      featureTags: ["焊接件"],
      processTags: ["焊接", "打磨"],
      resourceTags: ["BYH03", "MDM01"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 40,
          processId: "proc-weld",
          processName: "氩弧焊（食品）",
          description: "焊接"
        },
        {
          order: 50,
          processId: "proc-grind",
          processName: "打磨拉丝抛光（食品）",
          description: "打磨"
        }
      ]
    };

    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "human-confirmed-folded-edge-target",
      itemId: "192766040302-part",
      item: {
        readableId: "192766040302",
        name: "防护罩1",
        customFields: {
          processTags: ["hidden-target-process"],
          resourceTags: ["hidden-target-resource"],
          aiRoutingHumanEvidence: {
            processConfirmations: [
              {
                source: "process_owner_review",
                evidenceType: "folded_edge_closure_requires_welding",
                allowed: true,
                processes: ["焊接"],
                text: "折弯边需要封闭所以需要氩弧焊",
                sourceDocument:
                  "ai-routing-weld-evidence-human-review-filled-20260828.xlsx"
              }
            ]
          }
        }
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192766040302",
          material: "SUS304",
          finish: "表面拉丝处理"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          bends: [
            {
              id: "bend-1",
              label: "90° bend",
              angle: 90,
              unit: "deg",
              evidence: [
                {
                  id: "ev-bend-1",
                  pageNumber: 1,
                  text: "90° R2",
                  confidence: 0.93
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-1",
              label: "brushed surface",
              finish: "拉丝",
              evidence: [
                {
                  id: "ev-surface-1",
                  pageNumber: 1,
                  text: "4.表面拉丝处理。",
                  confidence: 0.92
                }
              ]
            }
          ]
        }
      })
    });

    expect(target.processHints).toEqual(
      expect.arrayContaining(["激光切割", "折弯", "焊接", "打磨"])
    );
    expect(target.drawingEvidence?.some((fact) => fact.kind === "weld")).toBe(
      false
    );
    expect(JSON.stringify(target)).not.toContain("hidden-target-process");
    expect(JSON.stringify(target)).not.toContain("hidden-target-resource");

    const draft = generateAiRoutingDraft({
      target,
      samples: [laserBendBaseRoute, retainedShieldWeldGrindRoute]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual([
      "proc-ll",
      "proc-laser",
      "proc-bend",
      "proc-weld",
      "proc-grind"
    ]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null, null]);
  });
  it("uses explicit oxidation evidence without requiring uncertain work-center mappings", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "oxidation-surface-target",
      itemId: "oxidation-surface-part",
      item: {
        readableId: "192672060101",
        name: "连接件1"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192672060101",
          material: "6061-T6",
          finish: "外协氧化"
        },
        part: { class: "machined", stockForm: "unknown" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "Tapped hole",
              quantity: 4,
              diameter: 5,
              unit: "mm",
              thread: "M5",
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "4XM5-6H",
                  confidence: 0.93
                }
              ]
            }
          ],
          threads: [
            {
              id: "thread-1",
              label: "M5 thread",
              specification: "M5-6H",
              evidence: [
                {
                  id: "ev-thread-1",
                  pageNumber: 1,
                  text: "4XM5-6H",
                  confidence: 0.94
                }
              ]
            },
            {
              id: "thread-2",
              label: "M6 thread",
              specification: "M6-6H",
              evidence: [
                {
                  id: "ev-thread-2",
                  pageNumber: 1,
                  text: "2XM6-6H",
                  confidence: 0.91
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-oxidation",
              label: "outsourced oxidation finish",
              finish: "外协氧化",
              evidence: [
                {
                  id: "ev-surface-oxidation",
                  pageNumber: 1,
                  text: "表面外协氧化",
                  confidence: 0.92
                }
              ]
            }
          ]
        }
      })
    });

    expect(target.processHints).toEqual(
      expect.arrayContaining(["攻丝", "氧化"])
    );
    expect(target.processHints).not.toContain("激光切割");
    expect(target.processHints).not.toContain("折弯");

    const secondaryOxidationRoute: AiRoutingSample = {
      ...drillMillOxidizeSample,
      id: "sample-secondary-oxidation-route",
      itemId: "secondary-oxidation-route-part",
      materialTags: ["铝"],
      featureTags: ["孔"]
    };

    const draft = generateAiRoutingDraft({
      target,
      samples: [drillTapReferenceSample, secondaryOxidationRoute],
      minimumScore: 30
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-drill", "proc-tap", "proc-oxidize"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterName)
    ).toEqual([null, null, null, null]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-laser");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-bend");
  });

  it("uses process-owner milling base-route confirmation for tapped anodized pad routes", () => {
    const issueProcess = "领料";
    const issueProcessName = "领料工作中心";
    const millingProcess = "铣削";
    const primaryMillProcessName = "数显立铣（北一）XA5032（机加工）";
    const verticalMillProcessName = "立式铣床（精乔）4S-R8(机加工）";
    const tapProcess = "攻丝";
    const tapProcessName = "气动攻丝机（机加工）";
    const oxidationProcess = "氧化";
    const oxidationProcessName = "外协氧化";
    const holeFeature = "孔";
    const threadFeature = "螺纹";
    const evidenceType =
      "machined_plate_pad_tap_oxidation_requires_milling_base_route";

    const machinedPadMillingBaseRoute: AiRoutingSample = {
      id: "sample-machined-pad-milling-base-route",
      itemId: "similar-machined-pad-source-part",
      readableId: "192713850912",
      status: "Approved",
      datasetRole: "Training",
      name: "推箱垫2 外协氧化",
      materialTags: ["6061", "铝"],
      featureTags: [holeFeature, threadFeature],
      processTags: [millingProcess, tapProcess, oxidationProcess],
      resourceTags: ["JSX01", "JLX02", "JQG01", "WYH01"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: issueProcessName,
          workCenterId: "wc-ll",
          workCenterName: "LL01",
          description: issueProcess
        },
        {
          order: 20,
          processId: "proc-mill-primary",
          processName: primaryMillProcessName,
          workCenterId: "wc-mill-primary",
          workCenterName: "JSX01",
          description: millingProcess
        },
        {
          order: 30,
          processId: "proc-vertical-mill",
          processName: verticalMillProcessName,
          workCenterId: "wc-vertical-mill",
          workCenterName: "JLX02",
          description: millingProcess
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: tapProcessName,
          workCenterId: "wc-tap",
          workCenterName: "JQG01",
          description: tapProcess
        },
        {
          order: 50,
          processId: "proc-oxidize",
          processName: oxidationProcessName,
          workCenterId: "wc-oxidize",
          workCenterName: "WYH01",
          description: oxidationProcessName
        }
      ]
    };

    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "human-confirmed-milling-base-target",
      itemId: "192713850911-part",
      item: {
        readableId: "192713850911",
        name: "推箱垫1",
        customFields: {
          processTags: ["hidden-target-process"],
          resourceTags: ["hidden-target-resource"],
          aiRoutingHumanEvidence: {
            processConfirmations: [
              {
                source: "process_owner_review",
                evidenceType,
                allowed: true,
                processes: [millingProcess],
                text: "工艺负责人确认：攻丝 + 阳极氧化的连接板/垫，图纸未写铣削时也需要数显立铣/立式铣床/加工中心底层路线。",
                sourceDocument:
                  "ai-routing-oxidation-milling-base-route-diagnostic-20260831.json"
              }
            ]
          }
        }
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192713850911",
          material: "6061-T6",
          finish: "阳极氧化处理"
        },
        part: { class: "machined", stockForm: "unknown" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "Tapped hole",
              quantity: 4,
              diameter: 5,
              unit: "mm",
              thread: "M5-6H",
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "4XM5-6H",
                  confidence: 0.93
                }
              ]
            }
          ],
          threads: [
            {
              id: "thread-1",
              label: "M5 thread",
              specification: "M5-6H",
              evidence: [
                {
                  id: "ev-thread-1",
                  pageNumber: 1,
                  text: "4XM5-6H",
                  confidence: 0.94
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-oxidation",
              label: "anodized surface",
              finish: "阳极氧化处理",
              evidence: [
                {
                  id: "ev-surface-oxidation",
                  pageNumber: 1,
                  text: "表面阳极氧化处理",
                  confidence: 0.92
                }
              ]
            }
          ]
        }
      })
    });

    expect(target.processHints).toEqual(
      expect.arrayContaining([tapProcess, oxidationProcess, millingProcess])
    );
    expect(target.humanEvidence?.map((fact) => fact.label)).toContain(
      evidenceType
    );
    expect(JSON.stringify(target)).not.toContain("hidden-target-process");
    expect(JSON.stringify(target)).not.toContain("hidden-target-resource");

    const draft = generateAiRoutingDraft({
      target,
      samples: [machinedPadMillingBaseRoute],
      minimumScore: 0
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual([
      "proc-ll",
      "proc-mill-primary",
      "proc-vertical-mill",
      "proc-tap",
      "proc-oxidize"
    ]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null, null]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterName)
    ).toEqual([null, null, null, null, null]);
  });
  it("does not inherit milling from the best reference when target has no milling evidence", () => {
    const millingContaminatedRoute: AiRoutingSample = {
      id: "sample-milling-contaminated-laser-tap-weld",
      itemId: "milling-contaminated-laser-tap-weld-part",
      readableId: "19277003010106",
      status: "Approved",
      datasetRole: "Training",
      name: "焊接板攻丝件",
      materialTags: ["304", "不锈钢"],
      featureTags: ["板件", "孔", "螺纹", "焊接件"],
      processTags: ["激光切割", "攻丝", "焊接", "铣削"],
      resourceTags: ["XJG01", "JQG01", "BYH01", "JSX01"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-laser",
          processName: "数控激光切割",
          description: "下料"
        },
        {
          order: 30,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        },
        {
          order: 40,
          processId: "proc-mill",
          processName: "数显立铣",
          description: "铣削"
        },
        {
          order: 45,
          processId: "proc-cnc",
          processName: "立式加工中心VMC850B(机加工）",
          description: "加工中心"
        },
        {
          order: 50,
          processId: "proc-weld",
          processName: "氩弧焊（食品）",
          description: "焊接"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "laser-tap-weld-target",
        itemId: "laser-tap-weld-part",
        readableId: "19277003010106",
        name: "焊接板攻丝件",
        materialTags: ["304", "不锈钢"],
        featureTags: ["板件", "孔", "螺纹", "焊接件"],
        processHints: ["激光切割", "攻丝", "焊接"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "M6",
            pageNumber: 1,
            text: "4XM6-6H",
            confidence: 0.93
          },
          {
            kind: "thread",
            sourceId: "thread-1",
            evidenceId: "ev-thread",
            label: "M6",
            pageNumber: 1,
            text: "4XM6-6H",
            confidence: 0.94
          },
          {
            kind: "weld",
            sourceId: "weld-1",
            evidenceId: "ev-weld",
            label: "焊接",
            pageNumber: 1,
            text: "焊接",
            confidence: 0.9
          }
        ]
      },
      samples: [millingContaminatedRoute]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser", "proc-tap", "proc-weld"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-mill");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-cnc");
  });

  it("does not add bend from weak bend text without bend evidence", () => {
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "weak-bend-text-target",
      itemId: "weak-bend-text-part",
      item: {
        readableId: "192770010102",
        name: "固定板"
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192770010102",
          material: "SUS304"
        },
        part: { class: "sheet-metal", stockForm: "sheet" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "Tapped hole",
              quantity: 4,
              diameter: 6,
              unit: "mm",
              thread: "M6",
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "4XM6-6H",
                  confidence: 0.93
                }
              ]
            }
          ],
          threads: [
            {
              id: "thread-1",
              label: "M6 thread",
              specification: "M6-6H",
              evidence: [
                {
                  id: "ev-thread-1",
                  pageNumber: 1,
                  text: "4XM6-6H",
                  confidence: 0.94
                }
              ]
            }
          ]
        },
        notes: [
          {
            id: "note-template-bend-text",
            text: "模板文字包含折弯字样，但图纸没有折弯特征。",
            category: "general",
            evidence: [
              {
                id: "ev-template-bend-text",
                pageNumber: 1,
                text: "折弯",
                confidence: 0.7
              }
            ]
          }
        ]
      })
    });

    expect(target.drawingEvidence?.some((fact) => fact.kind === "bend")).toBe(
      false
    );
    expect(target.processHints).not.toContain("折弯");

    const draft = generateAiRoutingDraft({
      target,
      samples: [laserBendSample]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-bend");
  });

  it("does not copy bend operations when target drawing has no bend evidence", () => {
    const draft = generateAiRoutingDraft({
      target: {
        id: "flat-hole-target",
        itemId: "flat-hole-part",
        materialTags: ["6061", "铝"],
        featureTags: ["板件", "孔"],
        processHints: ["激光切割"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "Ø6.5",
            pageNumber: 1,
            text: "2X Ø6.5 THRU",
            confidence: 0.93
          }
        ]
      },
      samples: [laserBendSample]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-bend");
  });
  it("uses explicit sheet-bend evidence to recover below-threshold routes without unsupported operations", () => {
    const laserBendGrindSample: AiRoutingSample = {
      ...laserBendSample,
      id: "sample-laser-bend-grind",
      itemId: "laser-bend-grind-part",
      operations: [
        ...laserBendSample.operations,
        {
          order: 40,
          processId: "proc-grind",
          processName: "打磨（碳钢）",
          description: "领料"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "sheet-bend-target",
        itemId: "sheet-bend-part",
        readableId: "1927930804",
        name: "折弯板件",
        materialTags: [],
        featureTags: ["板件", "折弯"],
        processHints: ["激光切割", "折弯"],
        drawingEvidence: [
          {
            kind: "bend",
            sourceId: "bend-1",
            evidenceId: "ev-bend",
            label: "90° bend",
            pageNumber: 1,
            text: "BEND 90°",
            confidence: 0.93
          }
        ]
      },
      samples: [laserBendGrindSample],
      minimumScore: 35
    });

    expect(draft.warnings).toContain(
      "Work center recommendations are withheld until resource capability evidence is available."
    );
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser", "proc-bend"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-grind");
  });
  it("prefers shorter same-score routes when target evidence is generic", () => {
    const sawMillRoute: AiRoutingSample = {
      id: "aaa-saw-mill-route",
      itemId: "saw-mill-part",
      readableId: "192713410401",
      status: "Approved",
      datasetRole: "Training",
      name: "304 管件锯床后铣削",
      materialTags: ["304"],
      featureTags: [],
      processTags: ["锯床", "铣削"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-saw",
          processName: "锯床下料",
          description: "下料"
        },
        {
          order: 30,
          processId: "proc-mill",
          processName: "数显立铣",
          description: "铣削"
        }
      ]
    };
    const sawOnlyRoute: AiRoutingSample = {
      ...sawMillRoute,
      id: "zzz-saw-only-route",
      itemId: "saw-only-part",
      readableId: "192713410402",
      name: "304 管件锯床下料",
      processTags: ["锯床"],
      operations: sawMillRoute.operations.slice(0, 2)
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "generic-tube-target",
        itemId: "generic-tube-part",
        readableId: "192793010401",
        name: "304 管件",
        materialTags: ["304"],
        featureTags: [],
        processHints: ["锯床"],
        drawingEvidence: [
          {
            kind: "dimension",
            sourceId: "dimension-1",
            evidenceId: "ev-dimension",
            label: "L",
            pageNumber: 1,
            text: "L=120",
            confidence: 0.9
          }
        ]
      },
      samples: [sawMillRoute, sawOnlyRoute]
    });

    expect(draft.references[0]?.sampleId).toBe("zzz-saw-only-route");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-saw"]);
  });
  it("adds turning to laser routes for explicit sheet-shaft targets without copying saw or tap extras", () => {
    const laserShaftRoute: AiRoutingSample = {
      id: "sample-laser-shaft",
      itemId: "laser-shaft-part",
      readableId: "192437180604",
      status: "Approved",
      datasetRole: "Training",
      name: "304 板轴激光件",
      materialTags: ["304"],
      featureTags: ["板件", "轴类"],
      processTags: ["激光切割"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-laser",
          processName: "数控激光切割（下料）",
          description: "下料"
        }
      ]
    };
    const sawTurnTapRoute: AiRoutingSample = {
      id: "sample-saw-turn-tap",
      itemId: "saw-turn-tap-part",
      readableId: "191967100102",
      status: "Approved",
      datasetRole: "Training",
      name: "轴类孔车削攻丝件",
      materialTags: [],
      featureTags: ["轴类", "孔"],
      processTags: ["车削", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-saw",
          processName: "锯床下料",
          description: "下料"
        },
        {
          order: 30,
          processId: "proc-turn",
          processName: "普通车床CA6140A×2000(机加工）",
          description: "车削"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "laser-turn-target",
        itemId: "laser-turn-part",
        readableId: "19276939010203",
        name: "304 板轴孔件",
        materialTags: ["304"],
        featureTags: ["板件", "轴类", "孔"],
        processHints: ["激光切割", "车削"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "Ø8",
            pageNumber: 1,
            text: "Ø8 THRU",
            confidence: 0.92
          },
          {
            kind: "dimension",
            sourceId: "dimension-1",
            evidenceId: "ev-length",
            label: "L",
            pageNumber: 1,
            text: "L=95",
            confidence: 0.88
          }
        ]
      },
      samples: [laserShaftRoute, sawTurnTapRoute]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser", "proc-turn"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-saw");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-tap");
  });
  it("finds retained laser-turning recovery candidates beyond the initial top-20 window", () => {
    const laserBaseRoute: AiRoutingSample = {
      id: "sample-laser-base-route",
      itemId: "laser-base-part",
      readableId: "19276939010203-base",
      status: "Approved",
      datasetRole: "Training",
      name: "304 \u677f\u5b54\u6fc0\u5149\u4ef6",
      materialTags: ["304"],
      featureTags: ["\u677f\u4ef6", "\u5b54"],
      processTags: ["\u6fc0\u5149\u5207\u5272"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "\u9886\u6599\u5de5\u4f5c\u4e2d\u5fc3",
          description: "\u9886\u6599"
        },
        {
          order: 20,
          processId: "proc-laser",
          processName:
            "\u6570\u63a7\u6fc0\u5149\u5207\u5272\uff08\u4e0b\u6599\uff09",
          description: "\u4e0b\u6599"
        }
      ]
    };
    const laserHoleDistractors: AiRoutingSample[] = Array.from(
      { length: 20 },
      (_, index): AiRoutingSample => ({
        id: "aaa-laser-hole-distractor-" + String(index).padStart(2, "0"),
        itemId: "aaa-laser-hole-distractor-part-" + index,
        readableId: "aaa-" + index,
        status: "Approved",
        datasetRole: "Training",
        name: "\u677f\u5b54\u6fc0\u5149\u5e72\u6270\u4ef6",
        materialTags: [],
        featureTags: ["\u677f\u4ef6", "\u5b54"],
        processTags: ["\u6fc0\u5149\u5207\u5272"],
        resourceTags: [],
        operations: [
          {
            order: 10,
            processId: "proc-ll",
            processName: "\u9886\u6599\u5de5\u4f5c\u4e2d\u5fc3",
            description: "\u9886\u6599"
          },
          {
            order: 20,
            processId: "proc-laser",
            processName:
              "\u6570\u63a7\u6fc0\u5149\u5207\u5272\uff08\u4e0b\u6599\uff09",
            description: "\u4e0b\u6599"
          }
        ]
      })
    );
    const retainedTurningRoute: AiRoutingSample = {
      id: "zzz-retained-turning-route",
      itemId: "retained-turning-part",
      readableId: "192770010401",
      status: "Approved",
      datasetRole: "Training",
      name: "\u60f0\u8f6e\u8f74",
      materialTags: [],
      featureTags: ["\u8f74\u7c7b", "\u5b54"],
      processTags: ["\u8f66\u524a"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "\u9886\u6599\u5de5\u4f5c\u4e2d\u5fc3",
          description: "\u9886\u6599"
        },
        {
          order: 20,
          processId: "proc-saw",
          processName: "\u952f\u5e8a\u4e0b\u6599",
          description: "\u4e0b\u6599"
        },
        {
          order: 30,
          processId: "proc-turn",
          processName:
            "\u666e\u901a\u8f66\u5e8aCA6140A\u00d72000(\u673a\u52a0\u5de5\uff09",
          description: "\u8f66\u524a"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName:
            "\u6c14\u52a8\u653b\u4e1d\u673a\uff08\u673a\u52a0\u5de5\uff09",
          description: "\u653b\u4e1d"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "laser-turn-target-beyond-top-20",
        itemId: "laser-turn-part-beyond-top-20",
        readableId: "19276939010203",
        name: "304 \u4e3b\u52a8\u8f74\u56fa\u5b9a\u677f",
        materialTags: ["304"],
        featureTags: ["\u677f\u4ef6", "\u8f74\u7c7b", "\u5b54"],
        processHints: ["\u6fc0\u5149\u5207\u5272", "\u8f66\u524a"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "\u00d88",
            pageNumber: 1,
            text: "\u00d88 THRU",
            confidence: 0.92
          }
        ]
      },
      samples: [laserBaseRoute, ...laserHoleDistractors, retainedTurningRoute]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-laser", "proc-turn"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-saw");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-tap");
    expect(
      draft.references.some(
        (reference) => reference.sampleId === "zzz-retained-turning-route"
      )
    ).toBe(true);
  });
  it("adds turning to threaded shaft routes without copying saw extras", () => {
    const millTapRoute: AiRoutingSample = {
      id: "sample-threaded-shaft-mill-tap",
      itemId: "threaded-shaft-mill-tap-part",
      readableId: "1920790304",
      status: "Approved",
      datasetRole: "Training",
      name: "304 孔螺纹加工件",
      materialTags: ["304"],
      featureTags: ["孔"],
      processTags: ["铣削", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-mill",
          processName: "数显立铣（北一）XA5032（机加工）",
          description: "铣削"
        },
        {
          order: 30,
          processId: "proc-cnc",
          processName: "立式加工中心VMC850B(机加工）",
          description: "加工中心"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };
    const sawTurnTapRoute: AiRoutingSample = {
      id: "sample-threaded-shaft-saw-turn-tap",
      itemId: "threaded-shaft-saw-turn-tap-part",
      readableId: "191967100102",
      status: "Approved",
      datasetRole: "Training",
      name: "轴类孔车削攻丝件",
      materialTags: [],
      featureTags: ["轴类", "孔"],
      processTags: ["车削", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-saw",
          processName: "锯床下料",
          description: "下料"
        },
        {
          order: 30,
          processId: "proc-turn",
          processName: "普通车床CA6140A×2000(机加工）",
          description: "车削"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "threaded-shaft-target",
        itemId: "threaded-shaft-part",
        readableId: "192788110402",
        name: "304 轴类孔螺纹件",
        materialTags: ["304"],
        featureTags: ["轴类", "孔", "螺纹"],
        processHints: ["攻丝", "车削"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "Ø8",
            pageNumber: 1,
            text: "Ø8 THRU",
            confidence: 0.92
          },
          {
            kind: "thread",
            sourceId: "thread-1",
            evidenceId: "ev-thread",
            label: "M8",
            pageNumber: 1,
            text: "M8",
            confidence: 0.9
          }
        ]
      },
      samples: [millTapRoute, sawTurnTapRoute]
    });

    const orderedProcessIds = draft.suggestedOperations
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((operation) => operation.processId);
    expect(orderedProcessIds).toEqual([
      "proc-ll",
      "proc-turn",
      "proc-mill",
      "proc-cnc",
      "proc-tap"
    ]);
    expect(orderedProcessIds).not.toContain("proc-saw");
    expect(orderedProcessIds.filter((id) => id === "proc-tap")).toHaveLength(1);
  });
  it("uses human-confirmed shaft stock preparation evidence for saw turn tap galvanizing routes", () => {
    const issueProcess = "\u9886\u6599";
    const issueProcessName = "\u9886\u6599\u5de5\u4f5c\u4e2d\u5fc3";
    const sawProcess = "\u952f\u5e8a";
    const sawProcessName = "\u952f\u5e8a\u4e0b\u6599";
    const turnProcess = "\u8f66\u524a";
    const turnProcessName =
      "\u666e\u901a\u8f66\u5e8aCA6140A\u00d72000(\u673a\u52a0\u5de5\uff09";
    const tapProcess = "\u653b\u4e1d";
    const tapProcessName =
      "\u6c14\u52a8\u653b\u4e1d\u673a\uff08\u673a\u52a0\u5de5\uff09";
    const galvanizedProcess = "\u9540\u950c";
    const galvanizedProcessName = "\u5916\u534f\u9540\u950c";
    const shaftFeature = "\u8f74\u7c7b";
    const holeFeature = "\u5b54";
    const threadFeature = "\u87ba\u7eb9";
    const laserProcess = "\u6fc0\u5149\u5207\u5272";
    const bendProcess = "\u6298\u5f2f";
    const oxidationProcess = "\u6c27\u5316";

    const shaftSawTurnTapGalvanizeRoute: AiRoutingSample = {
      id: "sample-192744-shaft-saw-turn-tap-galvanize",
      itemId: "similar-rotary-shaft-source-part",
      readableId: "2408510609",
      status: "Approved",
      datasetRole: "Training",
      name: "\u65cb\u8f6c\u8f74 直径8",
      materialTags: ["304"],
      featureTags: [shaftFeature, holeFeature, threadFeature],
      processTags: [sawProcess, turnProcess, tapProcess, galvanizedProcess],
      resourceTags: ["XDJ01", "JPC01", "JQG01", "WDX01"],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: issueProcessName,
          workCenterId: "wc-ll",
          workCenterName: "LL01",
          description: issueProcess
        },
        {
          order: 20,
          processId: "proc-saw",
          processName: sawProcessName,
          workCenterId: "wc-saw",
          workCenterName: "XDJ01",
          description: "\u4e0b\u6599"
        },
        {
          order: 30,
          processId: "proc-turn",
          processName: turnProcessName,
          workCenterId: "wc-turn",
          workCenterName: "JPC01",
          description: turnProcess
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: tapProcessName,
          workCenterId: "wc-tap",
          workCenterName: "JQG01",
          description: tapProcess
        },
        {
          order: 50,
          processId: "proc-galvanize",
          processName: galvanizedProcessName,
          workCenterId: "wc-galvanize",
          workCenterName: "WDX01",
          description: galvanizedProcess
        }
      ]
    };

    const target = aiRoutingTargetEvidenceFromDrawing({
      id: "human-confirmed-shaft-saw-target",
      itemId: "192744070201-part",
      item: {
        readableId: "192744070201",
        name: "\u65cb\u8f6c\u8f74",
        customFields: {
          processTags: ["hidden-shaft-process"],
          resourceTags: ["hidden-shaft-resource"],
          aiRoutingHumanEvidence: {
            processConfirmations: [
              {
                source: "process_owner_review",
                evidenceType: "shaft_stock_preparation_requires_saw_cutoff",
                allowed: true,
                processes: [sawProcess],
                text: "192744070201 \u662f\u65cb\u8f6c\u8f74\uff0c\u81ea\u7136\u9700\u8981\u952f\u5e8a\u4e0b\u6599\uff1b\u540c\u7c7b\u8f74\u7c7b\u8f66\u524a\u8def\u7ebf\u5f3a\u652f\u6301\u3002",
                sourceDocument:
                  "ai-routing-shaft-saw-route-diagnostic-20260831.json"
              }
            ]
          }
        }
      },
      drawingExtraction: drawingExtraction({
        titleBlock: {
          partNumber: "192744070201",
          material: "304",
          finish: "\u9540\u950c\u5904\u7406"
        },
        part: { class: "machined", stockForm: "bar" },
        features: {
          holes: [
            {
              id: "hole-1",
              label: "\u4e24\u7aef\u5185\u87ba\u7eb9\u5e95\u5b54",
              quantity: 2,
              diameter: 6.8,
              unit: "mm",
              thread: "M8-6H",
              evidence: [
                {
                  id: "ev-hole-1",
                  pageNumber: 1,
                  text: "\u4e24\u7aef\u5747\u6807\u6ce8 M8-6H\u3001\u23006.80 \u6df123.75",
                  confidence: 0.92
                }
              ]
            }
          ],
          threads: [
            {
              id: "thread-1",
              label: "\u4e24\u7aef\u5185\u87ba\u7eb9",
              specification: "M8-6H",
              evidence: [
                {
                  id: "ev-thread-1",
                  pageNumber: 1,
                  text: "\u4e24\u7aef\u5747\u6807\u6ce8 M8-6H \u6df120",
                  confidence: 0.91
                }
              ]
            }
          ],
          surfaces: [
            {
              id: "surface-galvanizing",
              label: "galvanized surface",
              finish: "\u9540\u950c\u5904\u7406",
              evidence: [
                {
                  id: "ev-surface-galvanizing",
                  pageNumber: 1,
                  text: "\u8868\u9762\u9540\u950c\u5904\u7406\u3002",
                  confidence: 0.93
                }
              ]
            }
          ]
        },
        notes: [
          {
            id: "note-galvanizing-1",
            text: "\u8868\u9762\u9540\u950c\u5904\u7406\u3002",
            evidence: [
              {
                id: "ev-note-galvanizing-1",
                pageNumber: 1,
                text: "2.\u8868\u9762\u9540\u950c\u5904\u7406",
                confidence: 0.92
              }
            ]
          },
          {
            id: "note-galvanizing-2",
            text: "\u6240\u6709\u5c3a\u5bf8\u90fd\u4e3a\u9540\u950c\u540e\u5c3a\u5bf8\u3002",
            evidence: [
              {
                id: "ev-note-galvanizing-2",
                pageNumber: 1,
                text: "3.\u6240\u6709\u5c3a\u5bf8\u90fd\u4e3a\u9540\u950c\u540e\u5c3a\u5bf8",
                confidence: 0.92
              }
            ]
          }
        ]
      })
    });

    expect(target.featureTags).toEqual(
      expect.arrayContaining([shaftFeature, holeFeature, threadFeature])
    );
    expect(target.processHints).toEqual(
      expect.arrayContaining([
        tapProcess,
        turnProcess,
        sawProcess,
        galvanizedProcess
      ])
    );
    expect(target.processHints).not.toEqual(
      expect.arrayContaining([laserProcess, bendProcess, oxidationProcess])
    );
    expect(target.humanEvidence?.map((fact) => fact.label)).toContain(
      "shaft_stock_preparation_requires_saw_cutoff"
    );
    expect(JSON.stringify(target)).not.toContain("hidden-shaft-process");
    expect(JSON.stringify(target)).not.toContain("hidden-shaft-resource");

    const draft = generateAiRoutingDraft({
      target,
      samples: [shaftSawTurnTapGalvanizeRoute]
    });

    const orderedProcessIds = draft.suggestedOperations
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((operation) => operation.processId);

    expect(orderedProcessIds).toEqual([
      "proc-ll",
      "proc-saw",
      "proc-turn",
      "proc-tap",
      "proc-galvanize"
    ]);
    expect(
      draft.suggestedOperations.map((operation) => operation.workCenterId)
    ).toEqual([null, null, null, null, null]);
  });
  it("recovers drill and tap operations for explicit hole-thread targets without sheet or shaft evidence", () => {
    const millTapRoute: AiRoutingSample = {
      id: "sample-mill-tap",
      itemId: "mill-tap-part",
      readableId: "1920790304",
      status: "Approved",
      datasetRole: "Training",
      name: "304 孔螺纹加工件",
      materialTags: ["304"],
      featureTags: ["孔"],
      processTags: ["铣削", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-mill",
          processName: "数显立铣（北一）XA5032（机加工）",
          description: "铣削"
        },
        {
          order: 30,
          processId: "proc-cnc",
          processName: "立式加工中心VMC850B(机加工）",
          description: "加工中心"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };
    const drillTapRoute: AiRoutingSample = {
      id: "sample-drill-tap-recovery",
      itemId: "drill-tap-recovery-part",
      readableId: "1920790301",
      status: "Approved",
      datasetRole: "Training",
      name: "孔螺纹钻攻件",
      materialTags: [],
      featureTags: ["孔"],
      processTags: ["钻孔", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-laser",
          processName: "数控激光切割（下料）",
          description: "下料"
        },
        {
          order: 30,
          processId: "proc-drill",
          processName: "摇臂钻床（机加工）",
          description: "钻孔"
        },
        {
          order: 40,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        },
        {
          order: 50,
          processId: "proc-grind",
          processName: "打磨拉丝抛光（食品）",
          description: "打磨"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "hole-thread-target",
        itemId: "hole-thread-part",
        readableId: "1927326104",
        name: "304 孔螺纹件",
        materialTags: ["304"],
        featureTags: ["孔", "螺纹"],
        processHints: ["攻丝"],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "Ø5",
            pageNumber: 1,
            text: "4X Ø5 THRU",
            confidence: 0.93
          },
          {
            kind: "thread",
            sourceId: "thread-1",
            evidenceId: "ev-thread",
            label: "M6",
            pageNumber: 1,
            text: "4XM6-6H",
            confidence: 0.94
          },
          {
            kind: "thread",
            sourceId: "thread-2",
            evidenceId: "ev-thread-secondary",
            label: "M8",
            pageNumber: 1,
            text: "2XM8-6H",
            confidence: 0.91
          }
        ]
      },
      samples: [millTapRoute, drillTapRoute]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-drill", "proc-tap"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toEqual(["proc-ll", "proc-mill", "proc-cnc", "proc-tap"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-grind");
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-laser");
  });
  it("does not copy tap operations when hole evidence has no thread", () => {
    const drillTapSample: AiRoutingSample = {
      id: "sample-drill-tap",
      itemId: "drill-tap-part",
      readableId: "1927326104",
      status: "Approved",
      datasetRole: "Training",
      name: "304 孔螺纹件",
      materialTags: ["304"],
      featureTags: ["孔", "螺纹"],
      processTags: ["钻孔", "攻丝"],
      resourceTags: [],
      operations: [
        {
          order: 10,
          processId: "proc-ll",
          processName: "领料工作中心",
          description: "领料"
        },
        {
          order: 20,
          processId: "proc-drill",
          processName: "摇臂钻床（机加工）",
          description: "钻孔"
        },
        {
          order: 30,
          processId: "proc-tap",
          processName: "气动攻丝机（机加工）",
          description: "攻丝"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "hole-only-target",
        itemId: "hole-only-part",
        readableId: "192788110401",
        name: "304 孔件",
        materialTags: ["304"],
        featureTags: ["孔"],
        processHints: [],
        drawingEvidence: [
          {
            kind: "hole",
            sourceId: "hole-1",
            evidenceId: "ev-hole",
            label: "Ø6.5",
            pageNumber: 1,
            text: "2X Ø6.5 THRU",
            confidence: 0.93
          }
        ]
      },
      samples: [drillTapSample]
    });

    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).toEqual(["proc-ll", "proc-drill"]);
    expect(
      draft.suggestedOperations.map((operation) => operation.processId)
    ).not.toContain("proc-tap");
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

  it("withholds a draft when weak PDF evidence ties different operation sequences", () => {
    const simplePlateRoute: AiRoutingSample = {
      ...laserBendSample,
      id: "aaa-simple-plate-route",
      itemId: "simple-plate-part",
      featureTags: ["板件", "折弯"],
      processTags: ["激光切割", "折弯", "下料", "领料"],
      operations: laserBendSample.operations.slice(0, 3)
    };
    const finishingPlateRoute: AiRoutingSample = {
      ...simplePlateRoute,
      id: "zzz-finishing-plate-route",
      itemId: "finishing-plate-part",
      processTags: ["激光切割", "折弯", "下料", "领料", "打磨"],
      operations: [
        ...simplePlateRoute.operations,
        {
          order: 40,
          processId: "proc-grind",
          processName: "打磨(碳钢)",
          description: "领料"
        }
      ]
    };

    const draft = generateAiRoutingDraft({
      target: {
        id: "weak-evidence-target",
        itemId: "target-part",
        materialTags: [],
        featureTags: ["板件"],
        drawingEvidence: [
          {
            kind: "dimension",
            sourceId: "dimension-1",
            evidenceId: "evidence-1",
            label: "L",
            pageNumber: 1,
            text: "L=480",
            confidence: 0.9
          }
        ]
      },
      samples: [simplePlateRoute, finishingPlateRoute],
      minimumScore: 30
    });

    expect(draft.suggestedOperations).toEqual([]);
    expect(draft.warnings).toContain(
      "Insufficient PDF evidence to choose among equally scored routing samples."
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
