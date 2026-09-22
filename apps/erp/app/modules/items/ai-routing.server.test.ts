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
