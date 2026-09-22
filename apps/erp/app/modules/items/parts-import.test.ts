import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parsePartsWorkbook } from "./parts-import";
import { u8MethodOperationId } from "./parts-import-identity.server";

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Sheet1"
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("parsePartsWorkbook", () => {
  it("parses the two-column Chinese parts template and trims values", () => {
    expect(
      parsePartsWorkbook(
        workbookBuffer([
          ["物料", "说明"],
          ["  P-001 ", "  Pump body "],
          ["P-002", "Valve"]
        ])
      )
    ).toEqual([
      { code: "P-001", description: "Pump body" },
      { code: "P-002", description: "Valve" }
    ]);
  });

  it("uses U8 operation id in the imported routing operation identity", () => {
    const first = u8MethodOperationId("company-1", {
      routeId: "route-1",
      opSeq: "0010",
      operationId: "operation-1"
    });
    const second = u8MethodOperationId("company-1", {
      routeId: "route-1",
      opSeq: "0010",
      operationId: "operation-2"
    });

    expect(second).not.toBe(first);
    expect(
      u8MethodOperationId("company-1", {
        routeId: "route-1",
        opSeq: "0010",
        operationId: "operation-1"
      })
    ).toBe(first);
  });
  it("rejects missing or conflicting duplicate part numbers", () => {
    expect(() =>
      parsePartsWorkbook(
        workbookBuffer([
          ["物料", "说明"],
          ["P-001", "A"],
          ["P-001", "B"]
        ])
      )
    ).toThrow(/duplicate/i);
    expect(() =>
      parsePartsWorkbook(
        workbookBuffer([
          ["编号", "说明"],
          ["P-001", "A"]
        ])
      )
    ).toThrow(/物料/);
  });
});
