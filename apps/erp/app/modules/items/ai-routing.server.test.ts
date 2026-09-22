import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AiRoutingDrawingExtraction } from "@carbon/lib/ai-routing-drawing";
import { describe, expect, it } from "vitest";
import {
  aiRoutingDrawingExtractionEventPayload,
  aiRoutingDrawingExtractionQueueDecision,
  aiRoutingSampleFromJobRouteRows,
  aiRoutingSampleFromRow,
  aiRoutingSampleStatusForMakeMethod,
  aiRoutingTargetEvidenceFromExtractionRow,
  aiRoutingTrainingDrawingSnapshotsFromRows,
  assertAiRoutingDraftProcessReferences,
  isMissingAiRoutingSchemaError
} from "./ai-routing.server";

describe("AI routing server helpers", () => {
  it("maps persisted sample rows back into draft-generation samples", () => {
    expect(
      aiRoutingSampleFromRow({
        id: "sample-1",
        itemId: "part-1",
        makeMethodId: "method-1",
        itemSnapshot: {
          readableIdWithRevision: "1927930202",
          name: "端部铸件毛坯"
        },
        operationSnapshot: [
          {
            id: "op-1",
            order: 10,
            processId: "proc-1",
            processName: "领料",
            workCenterId: "wc-1",
            workCenterName: "LL01",
            description: "领料"
          }
        ],
        drawingDocumentIds: ["doc-1"],
        materialTags: ["6061"],
        featureTags: ["板件"],
        processTags: ["领料"],
        resourceTags: ["ll01"],
        status: "Approved",
        datasetRole: "Evaluation"
      })
    ).toMatchObject({
      id: "sample-1",
      itemId: "part-1",
      readableId: "1927930202",
      name: "端部铸件毛坯",
      makeMethodId: "method-1",
      documentIds: ["doc-1"],
      operations: [{ id: "op-1", order: 10, description: "领料" }],
      materialTags: ["6061"],
      featureTags: ["板件"],
      processTags: ["领料"],
      resourceTags: ["ll01"],
      status: "Approved",
      datasetRole: "Evaluation"
    });
  });

  it("maps persisted sample scope exclusions from custom fields", () => {
    const sample = aiRoutingSampleFromRow({
      id: "sample-scope-excluded",
      itemId: "part-1",
      makeMethodId: "method-1",
      itemSnapshot: {
        readableIdWithRevision: "1927930206",
        name: "\u65e0\u677f\u6750\u6fc0\u5149\u6837\u672c"
      },
      operationSnapshot: [],
      drawingDocumentIds: [],
      materialTags: [],
      featureTags: ["\u677f\u4ef6"],
      processTags: ["\u6fc0\u5149\u5207\u5272"],
      resourceTags: [],
      status: "Approved",
      datasetRole: "Training",
      customFields: {
        aiRoutingScope: {
          exclusionReasons: ["illegal_laser_no_plate"]
        }
      }
    });

    expect(sample.scopeExclusionReasons).toEqual(["illegal_laser_no_plate"]);
  });
  it("builds an ID-only drawing extraction event payload", () => {
    const payload = aiRoutingDrawingExtractionEventPayload({
      companyId: "company-1",
      userId: "user-1",
      itemId: "part-1",
      documentId: "doc-1",
      extractionId: "aide-1"
    });

    expect(payload).toEqual({
      companyId: "company-1",
      userId: "user-1",
      itemId: "part-1",
      documentId: "doc-1",
      extractionId: "aide-1"
    });
    expect(Object.keys(payload).sort()).toEqual([
      "companyId",
      "documentId",
      "extractionId",
      "itemId",
      "userId"
    ]);
    expect(JSON.stringify(payload)).not.toContain("%PDF");
    expect(JSON.stringify(payload)).not.toContain("signedUrl");
  });

  it("replaces only stale processing drawing extractions", () => {
    const now = new Date("2026-08-19T01:10:00.000Z");

    expect(
      aiRoutingDrawingExtractionQueueDecision({
        activeExtraction: {
          id: "aide-pending",
          status: "Pending",
          startedAt: null,
          createdAt: "2026-08-18T00:00:00.000Z"
        },
        now
      })
    ).toBe("reuse");
    expect(
      aiRoutingDrawingExtractionQueueDecision({
        activeExtraction: {
          id: "aide-recent",
          status: "Processing",
          startedAt: "2026-08-19T00:50:00.001Z",
          createdAt: "2026-08-19T00:49:00.000Z"
        },
        now
      })
    ).toBe("reuse");
    expect(
      aiRoutingDrawingExtractionQueueDecision({
        activeExtraction: {
          id: "aide-stale",
          status: "Processing",
          startedAt: "2026-08-19T00:50:00.000Z",
          createdAt: "2026-08-19T00:49:00.000Z"
        },
        now
      })
    ).toBe("replace-stale-processing");
    expect(
      aiRoutingDrawingExtractionQueueDecision({
        activeExtraction: null,
        now
      })
    ).toBe("create");
  });

  it("allows queued drawing extractions before hash metadata is known", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/database/supabase/migrations/20260818090237_fix-ai-drawing-extraction-pending-metadata.sql"
      ),
      "utf8"
    );

    expect(migration).toContain('ALTER COLUMN "contentHash" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "rendererVersion" DROP NOT NULL');
    expect(migration).toContain(
      'ALTER COLUMN "extractorSchemaVersion" DROP NOT NULL'
    );
    expect(migration).toContain('"contentHash" IS NULL OR "contentHash" ~');
    expect(migration).toContain("\"status\" <> 'Succeeded'");
  });

  it("detects the missing migration error shown before applying AI routing tables", () => {
    expect(
      isMissingAiRoutingSchemaError(
        new Error('relation "aiRoutingSample" does not exist')
      )
    ).toBe(true);
    expect(
      isMissingAiRoutingSchemaError(
        new Error('type "aiRoutingDatasetRole" does not exist')
      )
    ).toBe(true);
    expect(
      isMissingAiRoutingSchemaError(
        new Error('column "datasetRole" does not exist')
      )
    ).toBe(true);
    expect(
      isMissingAiRoutingSchemaError(
        new Error('relation "aiDrawingExtraction" does not exist')
      )
    ).toBe(true);

    expect(isMissingAiRoutingSchemaError(new Error("permission denied"))).toBe(
      false
    );
  });

  it("only approves samples built from active make methods", () => {
    expect(aiRoutingSampleStatusForMakeMethod("Approved", "Active")).toBe(
      "Approved"
    );
    expect(aiRoutingSampleStatusForMakeMethod("Approved", "Draft")).toBe(
      "Candidate"
    );
    expect(aiRoutingSampleStatusForMakeMethod("Approved", "Archived")).toBe(
      "Candidate"
    );
    expect(aiRoutingSampleStatusForMakeMethod("Candidate", "Active")).toBe(
      "Candidate"
    );
  });

  it("builds an approved sample from a U8 job route without a formal make method", () => {
    const sample = aiRoutingSampleFromJobRouteRows({
      companyId: "company-1",
      status: "Approved",
      item: {
        id: "part-1",
        readableId: "192793050101",
        readableIdWithRevision: "192793050101-A",
        name: "板类支架",
        description: "304 stainless sheet bracket",
        customFields: {}
      },
      jobMakeMethod: {
        id: "job-method-1",
        jobId: "job-1",
        itemId: "part-1"
      },
      operations: [
        {
          id: "job-op-10",
          order: 10,
          processId: "proc-issue",
          workCenterId: "wc-issue",
          description: "领料工作中心",
          process: { id: "proc-issue", name: "领料" },
          workCenter: { id: "wc-issue", name: "领料工作中心" }
        },
        {
          id: "job-op-20",
          order: 20,
          processId: "proc-laser",
          workCenterId: "wc-laser",
          description: "数控激光切割（下料）",
          process: { id: "proc-laser", name: "激光切割" },
          workCenter: { id: "wc-laser", name: "数控激光切割" }
        }
      ],
      documents: [{ id: "doc-1" }]
    });

    expect(sample.data).toMatchObject({
      id: "company-1:job-route:job-method-1",
      itemId: "part-1",
      readableId: "192793050101-A",
      name: "板类支架",
      makeMethodId: null,
      documentIds: ["doc-1"],
      status: "Approved",
      datasetRole: "Training",
      operations: [
        {
          id: "job-op-10",
          order: 10,
          processId: "proc-issue",
          processName: "领料",
          workCenterId: "wc-issue",
          workCenterName: "领料工作中心"
        },
        {
          id: "job-op-20",
          order: 20,
          processId: "proc-laser",
          processName: "激光切割"
        }
      ],
      materialTags: expect.arrayContaining(["304", "不锈钢"]),
      featureTags: expect.arrayContaining(["板件"]),
      processTags: expect.arrayContaining(["领料", "激光切割", "下料"]),
      resourceTags: expect.arrayContaining(["领料工作中心", "数控激光切割"])
    });
    expect(sample.operationSnapshot).toEqual(sample.data?.operations);
  });
  it("rejects generated draft process ids outside the current company", () => {
    const draftOperation = (order: number, processId: string | null) => ({
      order,
      processId,
      sourceSampleId: "sample-1",
      sourceOperationOrder: order
    });

    expect(() =>
      assertAiRoutingDraftProcessReferences({
        companyId: "company-1",
        draft: {
          suggestedOperations: [
            draftOperation(1, "proc-company"),
            draftOperation(2, "proc-other-company")
          ]
        },
        processes: [
          { id: "proc-company", companyId: "company-1" },
          { id: "proc-other-company", companyId: "company-2" }
        ]
      })
    ).toThrow("outside this company");

    expect(() =>
      assertAiRoutingDraftProcessReferences({
        companyId: "company-1",
        draft: { suggestedOperations: [draftOperation(1, "missing")] },
        processes: []
      })
    ).toThrow("outside this company");

    expect(() =>
      assertAiRoutingDraftProcessReferences({
        companyId: "company-1",
        draft: { suggestedOperations: [draftOperation(1, null)] },
        processes: []
      })
    ).toThrow("missing a process id");

    expect(() =>
      assertAiRoutingDraftProcessReferences({
        companyId: "company-1",
        draft: {
          suggestedOperations: [draftOperation(1, "proc-company")]
        },
        processes: [{ id: "proc-company", companyId: "company-1" }]
      })
    ).not.toThrow();
  });
  it("maps a succeeded drawing extraction row into PDF-only target evidence", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: {
        pageCount: 1,
        renderedPageCount: 1,
        contentHash: "c".repeat(64)
      },
      titleBlock: {
        partNumber: "1927930207",
        revision: null,
        material: "6061 aluminum",
        finish: null,
        heatTreatment: null
      },
      part: { class: "sheet-metal", stockForm: "sheet" },
      dimensions: [],
      features: {
        holes: [
          {
            id: "hole-1",
            label: "tap pilot hole",
            quantity: 1,
            diameter: 5,
            unit: "mm",
            thread: "M6",
            evidence: [
              {
                id: "ev-thread",
                pageNumber: 1,
                text: "M6 TAP",
                confidence: 0.91
              }
            ]
          }
        ],
        threads: [],
        slots: [],
        pockets: [],
        bends: [],
        welds: [],
        surfaces: []
      },
      notes: [],
      explicitUnknowns: [],
      warnings: []
    } satisfies AiRoutingDrawingExtraction;

    const target = aiRoutingTargetEvidenceFromExtractionRow({
      itemId: "part-1",
      readableId: "1927930207",
      readableIdWithRevision: "1927930207-A",
      name: "PDF target with hidden route custom fields",
      description: "Visible part metadata only",
      customFields: {
        processTags: ["hidden-target-process"],
        resourceTags: ["hidden-target-resource"]
      },
      extractionId: "aide-1",
      extraction: drawingExtraction
    });

    expect(target).toMatchObject({
      id: "aide-1",
      itemId: "part-1",
      readableId: "1927930207-A",
      materialTags: ["6061", "铝"]
    });
    expect(target.featureTags).toEqual(
      expect.arrayContaining(["板件", "孔", "螺纹"])
    );
    expect(target.drawingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "hole", evidenceId: "ev-thread" })
      ])
    );
    expect(JSON.stringify(target)).not.toContain("hidden-target-process");
    expect(JSON.stringify(target)).not.toContain("hidden-target-resource");
  });
  it("forwards whitelisted human weld evidence from item notes into target evidence", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: {
        pageCount: 1,
        renderedPageCount: 1,
        contentHash: "d".repeat(64)
      },
      titleBlock: {
        partNumber: "192766040302",
        revision: null,
        material: "SUS304",
        finish: "表面拉丝处理",
        heatTreatment: null
      },
      part: { class: "sheet-metal", stockForm: "sheet" },
      dimensions: [],
      features: {
        holes: [],
        threads: [],
        slots: [],
        pockets: [],
        bends: [
          {
            id: "bend-1",
            label: "90° bend",
            angle: 90,
            unit: "degree",
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
        welds: [],
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
      },
      notes: [],
      explicitUnknowns: [],
      warnings: []
    } satisfies AiRoutingDrawingExtraction;

    const target = aiRoutingTargetEvidenceFromExtractionRow({
      itemId: "part-192766040302",
      readableId: "192766040302",
      readableIdWithRevision: null,
      name: "防护罩1",
      description: null,
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
      },
      extractionId: "aide-human-weld",
      extraction: drawingExtraction
    });

    expect(target.processHints).toEqual(
      expect.arrayContaining(["激光切割", "折弯", "焊接", "打磨"])
    );
    expect(target.featureTags).toEqual(expect.arrayContaining(["焊接件"]));
    expect(target.humanEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "process_owner_review",
          label: "folded_edge_closure_requires_welding",
          processHints: ["焊接"]
        })
      ])
    );
    expect(JSON.stringify(target)).not.toContain("hidden-target-process");
    expect(JSON.stringify(target)).not.toContain("hidden-target-resource");
  });
  it("builds training drawing snapshots only from current succeeded extractions", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: {
        pageCount: 1,
        renderedPageCount: 1,
        contentHash: "d".repeat(64)
      },
      titleBlock: {
        partNumber: "1927930207",
        revision: null,
        material: "6061 aluminum",
        finish: null,
        heatTreatment: null
      },
      part: { class: "sheet-metal", stockForm: "sheet" },
      dimensions: [],
      features: {
        holes: [],
        threads: [],
        slots: [],
        pockets: [],
        bends: [],
        welds: [],
        surfaces: []
      },
      notes: [],
      explicitUnknowns: [],
      warnings: []
    } satisfies AiRoutingDrawingExtraction;

    const snapshots = aiRoutingTrainingDrawingSnapshotsFromRows({
      itemId: "part-1",
      documents: [
        {
          id: "doc-1",
          name: "drawing.pdf",
          path: "company/parts/part-1/drawing.pdf",
          extension: "pdf",
          type: "PDF",
          sourceDocument: "Part",
          sourceDocumentId: "part-1",
          active: true
        }
      ],
      extractions: [
        {
          id: "aide-1",
          itemId: "part-1",
          documentId: "doc-1",
          status: "Succeeded",
          contentHash: drawingExtraction.document.contentHash,
          rendererVersion: "pdfjs-dist@5.4.296",
          extractorSchemaVersion: drawingExtraction.schemaVersion,
          promptVersion: "ai-routing-drawing-extraction.v1",
          modelProvider: "openai",
          modelName: "gpt-5.6-terra",
          pageCount: 1,
          completedAt: "2026-08-18T00:00:00.000Z",
          extraction: drawingExtraction
        }
      ]
    });

    expect(snapshots).toEqual([
      {
        id: "doc-1",
        name: "drawing.pdf",
        path: "company/parts/part-1/drawing.pdf",
        extension: "pdf",
        type: "PDF",
        sourceDocument: "Part",
        sourceDocumentId: "part-1",
        aiDrawingExtraction: {
          id: "aide-1",
          documentId: "doc-1",
          contentHash: drawingExtraction.document.contentHash,
          rendererVersion: "pdfjs-dist@5.4.296",
          extractorSchemaVersion: drawingExtraction.schemaVersion,
          promptVersion: "ai-routing-drawing-extraction.v1",
          modelProvider: "openai",
          modelName: "gpt-5.6-terra",
          pageCount: 1,
          completedAt: "2026-08-18T00:00:00.000Z"
        }
      }
    ]);
    expect(JSON.stringify(snapshots)).not.toContain("features");
  });

  it("rejects stale or missing training drawing extractions", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: { pageCount: 1, contentHash: "e".repeat(64) },
      titleBlock: {
        partNumber: "1927930207",
        revision: null,
        material: null,
        finish: null,
        heatTreatment: null
      },
      part: { class: "unknown", stockForm: "unknown" },
      dimensions: [],
      features: {
        holes: [],
        threads: [],
        slots: [],
        pockets: [],
        bends: [],
        welds: [],
        surfaces: []
      },
      notes: [],
      explicitUnknowns: [],
      warnings: []
    } satisfies AiRoutingDrawingExtraction;
    const document = {
      id: "doc-1",
      name: "drawing.pdf",
      path: "company/parts/part-1/drawing.pdf",
      extension: "pdf",
      type: "PDF",
      sourceDocument: "Part",
      sourceDocumentId: "part-1",
      active: true
    };

    expect(() =>
      aiRoutingTrainingDrawingSnapshotsFromRows({
        itemId: "part-1",
        documents: [document],
        extractions: []
      })
    ).toThrow("requires a succeeded AI drawing extraction");

    expect(() =>
      aiRoutingTrainingDrawingSnapshotsFromRows({
        itemId: "part-1",
        documents: [document],
        extractions: [
          {
            id: "aide-stale",
            itemId: "part-1",
            documentId: "doc-1",
            status: "Succeeded",
            contentHash: "f".repeat(64),
            rendererVersion: "pdfjs-dist@5.4.296",
            extractorSchemaVersion: drawingExtraction.schemaVersion,
            promptVersion: null,
            modelProvider: null,
            modelName: null,
            pageCount: 1,
            completedAt: "2026-08-18T00:00:00.000Z",
            extraction: drawingExtraction
          }
        ]
      })
    ).toThrow("stale AI drawing extraction");
  });

  it("deduplicates active Part PDFs by path before requiring extraction", () => {
    const drawingExtraction = {
      schemaVersion: "ai-routing-drawing.v1",
      document: { pageCount: 1, contentHash: "a".repeat(64) },
      titleBlock: {
        partNumber: "1927930205",
        revision: null,
        material: null,
        finish: null,
        heatTreatment: null
      },
      part: { class: "unknown", stockForm: "unknown" },
      dimensions: [],
      features: {
        holes: [],
        threads: [],
        slots: [],
        pockets: [],
        bends: [],
        welds: [],
        surfaces: []
      },
      notes: [],
      explicitUnknowns: [],
      warnings: []
    } satisfies AiRoutingDrawingExtraction;

    const snapshots = aiRoutingTrainingDrawingSnapshotsFromRows({
      itemId: "part-1",
      documents: [
        {
          id: "doc-current",
          name: "1927930205.pdf",
          path: "company/parts/part-1/1927930205.pdf",
          extension: "pdf",
          type: "PDF",
          sourceDocument: "Part",
          sourceDocumentId: "part-1",
          active: true
        },
        {
          id: "doc-duplicate",
          name: "1927930205.pdf",
          path: "company/parts/part-1/1927930205.pdf",
          extension: "pdf",
          type: "PDF",
          sourceDocument: "Part",
          sourceDocumentId: "part-1",
          active: true
        }
      ],
      extractions: [
        {
          id: "aide-current",
          itemId: "part-1",
          documentId: "doc-current",
          status: "Succeeded",
          contentHash: drawingExtraction.document.contentHash,
          rendererVersion: "pdfjs-dist@5.4.296",
          extractorSchemaVersion: drawingExtraction.schemaVersion,
          promptVersion: null,
          modelProvider: "openai",
          modelName: "gpt-5.6-terra",
          pageCount: 1,
          completedAt: "2026-08-18T00:00:00.000Z",
          extraction: drawingExtraction
        }
      ]
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.id).toBe("doc-current");
    expect(snapshots[0]?.aiDrawingExtraction.id).toBe("aide-current");
  });
});

type MaterializationDraftRecord = {
  id: string;
  companyId: string;
  itemId: string;
  targetMakeMethodId: string | null;
  acceptedMakeMethodId: string | null;
  status: string;
};

type MaterializationFeedbackRecord = {
  id: string;
  companyId: string;
  draftId: string;
  itemId: string;
  confirmedRouteSnapshot: unknown;
  createdAt: string;
};

type MaterializationMakeMethodRecord = {
  id: string;
  companyId: string;
  itemId: string;
  status: string;
  version: number;
  tags?: string[] | null;
  customFields?: unknown;
  createdBy?: string;
};

type MaterializationOperationRecord = {
  id: string;
  companyId: string;
  makeMethodId: string;
  order: number;
  processId: string;
  workCenterId: string | null;
  description: string;
};

function materializationWorkCenterProcessPairKey(pair: {
  processId: string;
  workCenterId: string;
}) {
  return `${pair.processId}\u0000${pair.workCenterId}`;
}

function createAiRoutingMaterializationStore(args: {
  drafts: MaterializationDraftRecord[];
  feedback: MaterializationFeedbackRecord[];
  makeMethods: MaterializationMakeMethodRecord[];
  processIds?: string[];
  workCenterIds?: string[];
  workCenterProcessPairs?: Array<{ processId: string; workCenterId: string }>;
  failOperationInsert?: boolean;
}) {
  let drafts = structuredClone(args.drafts);
  let feedback = structuredClone(args.feedback);
  let makeMethods = structuredClone(args.makeMethods);
  let operations: MaterializationOperationRecord[] = [];
  const processIds = new Set(args.processIds ?? ["proc-laser", "proc-bend"]);
  const workCenterIds = new Set(args.workCenterIds ?? ["wc-laser"]);
  const workCenterProcessPairs = new Set(
    (
      args.workCenterProcessPairs ?? [
        { processId: "proc-laser", workCenterId: "wc-laser" }
      ]
    ).map(materializationWorkCenterProcessPairKey)
  );

  const tx = {
    getAcceptedDraftForUpdate: async ({
      companyId,
      itemId,
      draftId
    }: {
      companyId: string;
      itemId: string;
      draftId: string;
    }) =>
      drafts.find(
        (draft) =>
          draft.id === draftId &&
          draft.companyId === companyId &&
          draft.itemId === itemId
      ) ?? null,
    getLatestAcceptedFeedback: async ({
      companyId,
      itemId,
      draftId
    }: {
      companyId: string;
      itemId: string;
      draftId: string;
    }) =>
      feedback
        .filter(
          (row) =>
            row.companyId === companyId &&
            row.itemId === itemId &&
            row.draftId === draftId
        )
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        )[0] ?? null,
    getTargetMakeMethodForUpdate: async ({
      companyId,
      itemId,
      makeMethodId
    }: {
      companyId: string;
      itemId: string;
      makeMethodId: string;
    }) =>
      makeMethods.find(
        (method) =>
          method.id === makeMethodId &&
          method.companyId === companyId &&
          method.itemId === itemId
      ) ?? null,
    getNextMakeMethodVersion: async ({
      companyId,
      itemId
    }: {
      companyId: string;
      itemId: string;
    }) =>
      Math.max(
        0,
        ...makeMethods
          .filter(
            (method) =>
              method.companyId === companyId && method.itemId === itemId
          )
          .map((method) => method.version)
      ) + 1,
    getActiveProcessIds: async (_companyId: string, ids: string[]) =>
      new Set(ids.filter((id) => processIds.has(id))),
    getActiveWorkCenterIds: async (_companyId: string, ids: string[]) =>
      new Set(ids.filter((id) => workCenterIds.has(id))),
    getActiveWorkCenterProcessPairs: async (
      _companyId: string,
      pairs: Array<{ processId: string; workCenterId: string }>
    ) =>
      new Set(
        pairs
          .map(materializationWorkCenterProcessPairKey)
          .filter((key) => workCenterProcessPairs.has(key))
      ),
    insertDraftMakeMethod: async ({
      companyId,
      itemId,
      version,
      tags,
      customFields,
      createdBy
    }: {
      companyId: string;
      itemId: string;
      version: number;
      tags: string[] | null;
      customFields: unknown;
      createdBy: string;
    }) => {
      const inserted = {
        id: `method-ai-${makeMethods.length + 1}`,
        companyId,
        itemId,
        status: "Draft",
        version,
        tags,
        customFields,
        createdBy
      } satisfies MaterializationMakeMethodRecord;
      makeMethods.push(inserted);
      return inserted;
    },
    insertMethodOperations: async (
      rows: Omit<MaterializationOperationRecord, "id">[]
    ) => {
      if (args.failOperationInsert) {
        throw new Error("forced child insert failure");
      }
      operations.push(
        ...rows.map((row, index) => ({
          id: `operation-${operations.length + index + 1}`,
          ...structuredClone(row)
        }))
      );
    },
    linkDraftToAcceptedMakeMethod: async ({
      companyId,
      itemId,
      draftId,
      makeMethodId
    }: {
      companyId: string;
      itemId: string;
      draftId: string;
      makeMethodId: string;
    }) => {
      const draft = drafts.find(
        (row) =>
          row.id === draftId &&
          row.companyId === companyId &&
          row.itemId === itemId
      );
      if (!draft || draft.acceptedMakeMethodId) return false;
      draft.acceptedMakeMethodId = makeMethodId;
      return true;
    }
  };

  return {
    store: {
      transaction: async <T>(callback: (trx: typeof tx) => Promise<T>) => {
        const snapshot = {
          drafts: structuredClone(drafts),
          makeMethods: structuredClone(makeMethods),
          operations: structuredClone(operations)
        };
        try {
          return await callback(tx);
        } catch (error) {
          drafts = snapshot.drafts;
          makeMethods = snapshot.makeMethods;
          operations = snapshot.operations;
          throw error;
        }
      }
    },
    getDrafts: () => drafts,
    getMakeMethods: () => makeMethods,
    getOperations: () => operations
  };
}

const acceptedRouteSnapshot = {
  status: "Technologist reviewed",
  targetItemId: "part-1",
  formalRoutingAction: "not-published",
  suggestedOperations: [
    {
      order: 1,
      processId: "proc-laser",
      processName: "Laser cut",
      workCenterId: "wc-laser",
      workCenterName: "Laser cell",
      description: "Laser cut blank",
      operationType: "Inside",
      operationOrder: "After Previous",
      setupTime: 0,
      setupUnit: "Total Minutes",
      laborTime: 12,
      laborUnit: "Minutes/Piece",
      machineTime: 8,
      machineUnit: "Minutes/Piece",
      sourceSampleId: "sample-1",
      sourceOperationOrder: 10
    },
    {
      order: 2,
      processId: "proc-bend",
      processName: "Bend",
      workCenterId: null,
      workCenterName: null,
      description: "Bend formed edges",
      operationType: "Inside",
      operationOrder: "After Previous",
      setupTime: 0,
      setupUnit: "Total Minutes",
      laborTime: 10,
      laborUnit: "Minutes/Piece",
      machineTime: 5,
      machineUnit: "Minutes/Piece",
      sourceSampleId: "sample-2",
      sourceOperationOrder: 20
    }
  ],
  referenceSampleIds: ["sample-1", "sample-2"],
  warnings: []
};

describe("AI routing accepted draft materialization", () => {
  it("creates one new Draft make-method version from an accepted reviewed snapshot without changing the Active version", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: null,
          status: "Accepted"
        }
      ],
      feedback: [
        {
          id: "feedback-1",
          companyId: "company-a",
          itemId: "part-1",
          draftId: "draft-1",
          confirmedRouteSnapshot: acceptedRouteSnapshot,
          createdAt: "2026-08-20T00:00:00.000Z"
        }
      ],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1,
          tags: ["current"],
          customFields: { source: "current" }
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).resolves.toMatchObject({
      action: "Created",
      makeMethodId: "method-ai-2",
      itemId: "part-1",
      operationCount: 2,
      version: 2
    });

    expect(database.getMakeMethods()).toEqual([
      expect.objectContaining({ id: "method-active", status: "Active" }),
      expect.objectContaining({
        id: "method-ai-2",
        status: "Draft",
        version: 2,
        createdBy: "user-1"
      })
    ]);
    expect(database.getDrafts()[0]?.acceptedMakeMethodId).toBe("method-ai-2");
    expect(database.getOperations()).toEqual([
      expect.objectContaining({
        makeMethodId: "method-ai-2",
        order: 1,
        processId: "proc-laser",
        workCenterId: "wc-laser",
        description: "Laser cut blank"
      }),
      expect.objectContaining({
        makeMethodId: "method-ai-2",
        order: 2,
        processId: "proc-bend",
        workCenterId: null,
        description: "Bend formed edges"
      })
    ]);
  });

  it("rejects non-accepted drafts without creating a method version", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: null,
          status: "Draft"
        }
      ],
      feedback: [],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).rejects.toThrow(/accepted/i);
    expect(database.getMakeMethods()).toHaveLength(1);
  });

  it("reuses an already linked Draft method on duplicate submission", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: "method-ai-existing",
          status: "Accepted"
        }
      ],
      feedback: [],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1
        },
        {
          id: "method-ai-existing",
          companyId: "company-a",
          itemId: "part-1",
          status: "Draft",
          version: 2
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).resolves.toMatchObject({
      action: "Reused",
      makeMethodId: "method-ai-existing",
      operationCount: 0,
      version: 2
    });
    expect(database.getMakeMethods()).toHaveLength(2);
    expect(database.getOperations()).toHaveLength(0);
  });

  it("rolls back method creation, operation inserts, and draft linking when a child insert fails", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      failOperationInsert: true,
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: null,
          status: "Accepted"
        }
      ],
      feedback: [
        {
          id: "feedback-1",
          companyId: "company-a",
          itemId: "part-1",
          draftId: "draft-1",
          confirmedRouteSnapshot: acceptedRouteSnapshot,
          createdAt: "2026-08-20T00:00:00.000Z"
        }
      ],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).rejects.toThrow(/child insert/);
    expect(database.getMakeMethods()).toHaveLength(1);
    expect(database.getOperations()).toHaveLength(0);
    expect(database.getDrafts()[0]?.acceptedMakeMethodId).toBeNull();
  });

  it("validates reviewed process and work-center references before inserting the Draft method", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      processIds: ["proc-laser"],
      workCenterIds: [],
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: null,
          status: "Accepted"
        }
      ],
      feedback: [
        {
          id: "feedback-1",
          companyId: "company-a",
          itemId: "part-1",
          draftId: "draft-1",
          confirmedRouteSnapshot: acceptedRouteSnapshot,
          createdAt: "2026-08-20T00:00:00.000Z"
        }
      ],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).rejects.toThrow(/process.*proc-bend|work center.*wc-laser/i);
    expect(database.getMakeMethods()).toHaveLength(1);
    expect(database.getOperations()).toHaveLength(0);
  });

  it("rejects reviewed work-center assignments without a supporting process capability", async () => {
    const { materializeAcceptedAiRoutingDraftWithStore } = await import(
      "./ai-routing.server"
    );
    const database = createAiRoutingMaterializationStore({
      workCenterProcessPairs: [],
      drafts: [
        {
          id: "draft-1",
          companyId: "company-a",
          itemId: "part-1",
          targetMakeMethodId: "method-active",
          acceptedMakeMethodId: null,
          status: "Accepted"
        }
      ],
      feedback: [
        {
          id: "feedback-1",
          companyId: "company-a",
          itemId: "part-1",
          draftId: "draft-1",
          confirmedRouteSnapshot: acceptedRouteSnapshot,
          createdAt: "2026-08-20T00:00:00.000Z"
        }
      ],
      makeMethods: [
        {
          id: "method-active",
          companyId: "company-a",
          itemId: "part-1",
          status: "Active",
          version: 1
        }
      ]
    });

    await expect(
      materializeAcceptedAiRoutingDraftWithStore(database.store as never, {
        companyId: "company-a",
        userId: "user-1",
        itemId: "part-1",
        draftId: "draft-1"
      })
    ).rejects.toThrow(/unsupported.*work center\/process/i);
    expect(database.getMakeMethods()).toHaveLength(1);
    expect(database.getOperations()).toHaveLength(0);
  });
});
