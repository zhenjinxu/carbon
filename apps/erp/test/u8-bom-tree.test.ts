import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type BomEdge = {
  bomId: string;
  opComponentId: string;
  parentPartId: string;
  parentCode: string;
  childPartId: string;
  childCode: string;
  sortSeq: number;
  opSeq?: string;
  baseQtyN: string;
  baseQtyD: string;
};

type BuildBomTree = (input: {
  roots: {
    rootPartId: string;
    rootCode: string;
    rootBomId: string;
    sourceJobIds?: string[];
  }[];
  edgesByBomId: Record<string, BomEdge[]>;
  childBomByPartId: Record<string, string | null>;
  maxDepth?: number;
}) => {
  roots: {
    rootCode: string;
    children: BomTreeNode[];
  }[];
  rows: BomTreeNode[];
};

type BomTreeNode = {
  rootCode: string;
  parentCode: string;
  childCode: string;
  level: number;
  directQuantity: string;
  cumulativeQuantity: string;
  partPath: string[];
  edgePath: string[];
  branchKey: string;
  children: BomTreeNode[];
};

let buildBomTree: BuildBomTree | undefined;
let selectRootBoms: ((input: unknown) => unknown[]) | undefined;

try {
  ({ buildBomTree, selectRootBoms } = require("../../../scripts/lib/u8-bom-tree.cjs"));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "MODULE_NOT_FOUND"
  ) {
    throw error;
  }
}

function edge(
  bomId: string,
  opComponentId: string,
  parentPartId: string,
  parentCode: string,
  childPartId: string,
  childCode: string,
  quantity: string,
  denominator = "1",
  sortSeq = 1
): BomEdge {
  return {
    bomId,
    opComponentId,
    parentPartId,
    parentCode,
    childPartId,
    childCode,
    sortSeq,
    baseQtyN: quantity,
    baseQtyD: denominator
  };
}

describe("U8 BOM tree", () => {
  it("exports direct parents and preserves repeated descendants on separate branches", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    const result = buildBomTree({
      roots: [
        {
          rootPartId: "root",
          rootCode: "13110202010100",
          rootBomId: "bom-root",
          sourceJobIds: ["job-1"]
        }
      ],
      edgesByBomId: {
        "bom-root": [
          edge("bom-root", "e-a", "root", "13110202010100", "a", "13110202010101", "1", "1", 1),
          edge("bom-root", "e-b", "root", "13110202010100", "b", "13110202010102", "1", "1", 2),
          edge("bom-root", "e-c", "root", "13110202010100", "c", "13110202010103", "1", "1", 3),
          edge("bom-root", "e-d", "root", "13110202010100", "d", "13110202010104", "1", "1", 4)
        ],
        "bom-a": [
          edge("bom-a", "e-a-x", "a", "13110202010101", "x", "371302010101", "1")
        ],
        "bom-b": [
          edge("bom-b", "e-b-y", "b", "13110202010102", "y", "372236000403", "2")
        ],
        "bom-c": [
          edge("bom-c", "e-c-y", "c", "13110202010103", "y", "372236000403", "4.2")
        ],
        "bom-d": [
          edge("bom-d", "e-d-y", "d", "13110202010104", "y", "372236000403", "1.8")
        ]
      },
      childBomByPartId: {
        a: "bom-a",
        b: "bom-b",
        c: "bom-c",
        d: "bom-d",
        x: null,
        y: null
      }
    });

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.children).toHaveLength(4);

    const repeated = result.rows.filter(
      (row) => row.childCode === "372236000403"
    );
    expect(repeated).toHaveLength(3);
    expect(repeated.map((row) => row.parentCode)).toEqual([
      "13110202010102",
      "13110202010103",
      "13110202010104"
    ]);
    expect(repeated.map((row) => row.cumulativeQuantity)).toEqual([
      "2",
      "4.2",
      "1.8"
    ]);
    expect(repeated.map((row) => row.edgePath)).toEqual([
      ["e-b", "e-b-y"],
      ["e-c", "e-c-y"],
      ["e-d", "e-d-y"]
    ]);
    expect(new Set(repeated.map((row) => row.branchKey)).size).toBe(3);
  });

  it("uses BaseQtyN divided by BaseQtyD and multiplies quantities precisely", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    const result = buildBomTree({
      roots: [
        { rootPartId: "root", rootCode: "ROOT", rootBomId: "root-bom" }
      ],
      edgesByBomId: {
        "root-bom": [
          edge("root-bom", "e-1", "root", "ROOT", "a", "A", "3", "2")
        ],
        "a-bom": [edge("a-bom", "e-2", "a", "A", "b", "B", "0.2")]
      },
      childBomByPartId: { a: "a-bom", b: null }
    });

    expect(result.rows.map((row) => row.directQuantity)).toEqual([
      "1.5",
      "0.2"
    ]);
    expect(result.rows.map((row) => row.cumulativeQuantity)).toEqual([
      "1.5",
      "0.3"
    ]);
  });

  it("keeps duplicate source edges when their OpComponentId differs", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    const result = buildBomTree({
      roots: [{ rootPartId: "root", rootCode: "ROOT", rootBomId: "bom" }],
      edgesByBomId: {
        bom: [
          edge("bom", "edge-1", "root", "ROOT", "child", "CHILD", "1", "1", 1),
          edge("bom", "edge-2", "root", "ROOT", "child", "CHILD", "2", "1", 2)
        ]
      },
      childBomByPartId: { child: null }
    });

    expect(result.rows.map((row) => row.edgePath)).toEqual([
      ["edge-1"],
      ["edge-2"]
    ]);
    expect(result.rows.map((row) => row.directQuantity)).toEqual(["1", "2"]);
  });

  it("rejects a zero denominator", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    expect(() =>
      buildBomTree({
        roots: [{ rootPartId: "root", rootCode: "ROOT", rootBomId: "bom" }],
        edgesByBomId: {
          bom: [edge("bom", "edge", "root", "ROOT", "child", "CHILD", "1", "0")]
        },
        childBomByPartId: { child: null }
      })
    ).toThrow(/BaseQtyD.*zero/i);
  });

  it("rejects a BOM cycle with the full part path", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    expect(() =>
      buildBomTree({
        roots: [{ rootPartId: "root", rootCode: "ROOT", rootBomId: "root-bom" }],
        edgesByBomId: {
          "root-bom": [
            edge("root-bom", "e-1", "root", "ROOT", "a", "A", "1")
          ],
          "a-bom": [edge("a-bom", "e-2", "a", "A", "root", "ROOT", "1")]
        },
        childBomByPartId: { a: "a-bom", root: "root-bom" }
      })
    ).toThrow(/ROOT.*A.*ROOT/);
  });

  it("rejects trees deeper than the configured maximum", () => {
    expect(buildBomTree).toBeTypeOf("function");
    if (!buildBomTree) return;

    expect(() =>
      buildBomTree({
        roots: [{ rootPartId: "root", rootCode: "ROOT", rootBomId: "root-bom" }],
        edgesByBomId: {
          "root-bom": [
            edge("root-bom", "e-1", "root", "ROOT", "a", "A", "1")
          ],
          "a-bom": [edge("a-bom", "e-2", "a", "A", "b", "B", "1")]
        },
        childBomByPartId: { a: "a-bom", b: null },
        maxDepth: 1
      })
    ).toThrow(/maximum depth 1/i);
  });
});

describe("U8 production-order BOM selection", () => {
  it("prefers approved assigned BOMs, falls back deterministically, and groups jobs", () => {
    expect(selectRootBoms).toBeTypeOf("function");
    if (!selectRootBoms) return;

    const roots = selectRootBoms({
      orders: [
        {
          sourceJobId: "job-2",
          sourceMoDId: "2",
          rootPartId: "part-a",
          rootCode: "A",
          assignedBomId: "bom-a",
          assignedBomStatus: 3
        },
        {
          sourceJobId: "job-1",
          sourceMoDId: "1",
          rootPartId: "part-a",
          rootCode: "A",
          assignedBomId: "bom-a",
          assignedBomStatus: 3
        },
        {
          sourceJobId: "job-3",
          sourceMoDId: "3",
          rootPartId: "part-b",
          rootCode: "B",
          assignedBomId: "missing-bom",
          assignedBomStatus: null
        }
      ],
      fallbackBomByPartId: {
        "part-b": { bomId: "bom-b" }
      }
    });

    expect(roots).toEqual([
      {
        rootPartId: "part-a",
        rootCode: "A",
        rootBomId: "bom-a",
        selection: "assigned",
        sourceJobIds: ["job-1", "job-2"],
        sourceMoDIds: ["1", "2"],
        assignedBomIds: ["bom-a"]
      },
      {
        rootPartId: "part-b",
        rootCode: "B",
        rootBomId: "bom-b",
        selection: "fallback",
        sourceJobIds: ["job-3"],
        sourceMoDIds: ["3"],
        assignedBomIds: ["missing-bom"]
      }
    ]);
  });

  it("rejects a production root without an assigned or fallback BOM", () => {
    expect(selectRootBoms).toBeTypeOf("function");
    if (!selectRootBoms) return;

    expect(() =>
      selectRootBoms({
        orders: [
          {
            sourceJobId: "job-1",
            sourceMoDId: "1",
            rootPartId: "part-a",
            rootCode: "A",
            assignedBomId: null,
            assignedBomStatus: null
          }
        ],
        fallbackBomByPartId: {}
      })
    ).toThrow(/no approved BOM.*A/i);
  });
});
