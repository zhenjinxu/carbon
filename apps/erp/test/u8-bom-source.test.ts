import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type PreferredBom = {
  bomId: string;
  parentPartId: string;
  parentCode: string;
  version: string | null;
  status: number;
};

let indexPreferredBoms:
  | ((rows: Record<string, unknown>[]) => Map<string, PreferredBom>)
  | undefined;
let itemFromEdge:
  | ((
      row: Record<string, unknown>,
      side: "parent" | "child"
    ) => { partId: string; code: string })
  | undefined;

try {
  ({ indexPreferredBoms, itemFromEdge } = require("../../../scripts/lib/u8-bom-source.cjs"));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "MODULE_NOT_FOUND"
  ) {
    throw error;
  }
}

describe("U8 BOM source normalization", () => {
  it("normalizes SQL Server BOM column names before root selection", () => {
    expect(indexPreferredBoms).toBeTypeOf("function");
    if (!indexPreferredBoms) return;

    const indexed = indexPreferredBoms([
      {
        ParentId: 1001611746,
        ParentCode: "192793360100",
        BomId: 1000271598,
        Version: 10,
        Status: 3
      }
    ]);

    expect(indexed.get("1001611746")).toMatchObject({
      bomId: "1000271598",
      parentPartId: "1001611746",
      parentCode: "192793360100",
      version: "10",
      status: 3
    });
  });

  it("uses ParentId for parent rows and ChildPartId for child rows", () => {
    expect(itemFromEdge).toBeTypeOf("function");
    if (!itemFromEdge) return;

    const row = {
      ParentId: 100,
      ParentCode: "PARENT",
      ParentName: "Parent",
      ParentUnitName: "EA",
      ChildPartId: 200,
      ChildCode: "CHILD",
      ChildName: "Child",
      ChildUnitName: "EA"
    };

    expect(itemFromEdge(row, "parent")).toMatchObject({
      partId: "100",
      code: "PARENT"
    });
    expect(itemFromEdge(row, "child")).toMatchObject({
      partId: "200",
      code: "CHILD"
    });
});
});
