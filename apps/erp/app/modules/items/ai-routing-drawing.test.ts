import { describe, expect, it } from "vitest";
import {
  AI_ROUTING_DRAWING_SCHEMA_VERSION,
  aiRoutingDrawingExtractionSchema,
  normalizeAiRoutingDrawingExtraction
} from "./ai-routing-drawing";

const validExtraction = {
  schemaVersion: AI_ROUTING_DRAWING_SCHEMA_VERSION,
  document: {
    pageCount: 2,
    renderedPageCount: 2,
    contentHash: "a".repeat(64)
  },
  titleBlock: {
    partNumber: "1927930202",
    revision: "A",
    material: "6061-T6",
    finish: "anodize",
    heatTreatment: null
  },
  part: {
    class: "sheet-metal",
    stockForm: "plate"
  },
  dimensions: [
    {
      id: "dim-overall-length",
      kind: "linear",
      label: "overall length",
      nominal: 480,
      unit: "mm",
      tolerance: { plus: 0.2, minus: -0.2 },
      evidence: [
        {
          id: "ev-length",
          pageNumber: 1,
          text: "480 ±0.2",
          boundingBox: { x: 0.12, y: 0.2, width: 0.1, height: 0.03 },
          confidence: 0.93
        }
      ]
    }
  ],
  features: {
    holes: [
      {
        id: "hole-m6-pattern",
        quantity: 4,
        diameter: 5,
        unit: "mm",
        thread: "M6",
        evidence: [
          {
            id: "ev-hole",
            pageNumber: 1,
            text: "4X M6",
            confidence: 0.91
          }
        ]
      }
    ],
    threads: [],
    slots: [],
    pockets: [],
    bends: [
      {
        id: "bend-90",
        angle: 90,
        unit: "degree",
        evidence: [
          {
            id: "ev-bend",
            pageNumber: 2,
            text: "90° BEND",
            confidence: 0.86
          }
        ]
      }
    ],
    welds: [],
    surfaces: []
  },
  notes: [
    {
      id: "note-deburr",
      text: "Deburr all edges",
      category: "manufacturing",
      evidence: [
        {
          id: "ev-note",
          pageNumber: 2,
          text: "DEBURR ALL EDGES",
          confidence: 0.8
        }
      ]
    }
  ],
  explicitUnknowns: ["heatTreatment"],
  warnings: ["finish requires review"]
};

describe("AI routing drawing extraction contract", () => {
  it("accepts traceable drawing features with explicit title-block unknowns", () => {
    const parsed = aiRoutingDrawingExtractionSchema.parse(validExtraction);

    expect(parsed.schemaVersion).toBe(AI_ROUTING_DRAWING_SCHEMA_VERSION);
    expect(parsed.titleBlock.heatTreatment).toBeNull();
    expect(parsed.features.holes[0].evidence[0]).toMatchObject({
      pageNumber: 1,
      confidence: 0.91
    });
  });

  it("normalizes deterministically without adding route-derived process answers", () => {
    const normalized = normalizeAiRoutingDrawingExtraction({
      ...validExtraction,
      warnings: [" finish requires review ", "finish requires review"],
      explicitUnknowns: ["heatTreatment", "heatTreatment"]
    });

    expect(normalized.warnings).toEqual(["finish requires review"]);
    expect(normalized.explicitUnknowns).toEqual(["heatTreatment"]);
    expect(JSON.stringify(normalized)).not.toContain("operationSnapshot");
    expect(JSON.stringify(normalized)).not.toContain("processTags");
  });

  it("rejects duplicate evidence identifiers within one extraction", () => {
    const duplicateEvidence = {
      ...validExtraction,
      notes: [
        {
          id: "note-duplicate",
          text: "Duplicate evidence",
          category: "general",
          evidence: [
            {
              id: "ev-hole",
              pageNumber: 1,
              text: "duplicate",
              confidence: 0.7
            }
          ]
        }
      ]
    };

    expect(
      aiRoutingDrawingExtractionSchema.safeParse(duplicateEvidence).success
    ).toBe(false);
  });

  it("rejects invalid page and confidence bounds", () => {
    const invalidBounds = {
      ...validExtraction,
      dimensions: [
        {
          ...validExtraction.dimensions[0],
          evidence: [
            {
              id: "ev-bad-page",
              pageNumber: 3,
              text: "outside page range",
              confidence: 1.2
            }
          ]
        }
      ]
    };

    expect(
      aiRoutingDrawingExtractionSchema.safeParse(invalidBounds).success
    ).toBe(false);
  });

  it("rejects unknown controlled values and extra model output fields", () => {
    const unsafeOutput = {
      ...validExtraction,
      part: {
        class: "invented-casting-class",
        stockForm: "plate"
      },
      operations: [{ processName: "laser cutting" }]
    };

    expect(
      aiRoutingDrawingExtractionSchema.safeParse(unsafeOutput).success
    ).toBe(false);
  });
});
