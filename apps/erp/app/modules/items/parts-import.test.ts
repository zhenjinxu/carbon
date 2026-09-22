import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  annotateWholeBomWorkbook,
  buildWholeBomFailures,
  expectedWholeBomDrawingRows,
  matchWholeBomDrawingFileNames,
  parsePartsWorkbook,
  parseWholeBomWorkbook
} from "./parts-import";
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

function wholeBomWorkbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "整机BOM(多级)"
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

describe("parseWholeBomWorkbook", () => {
  it("parses the multi-level whole-machine BOM into unique items and direct child edges", () => {
    const plan = parseWholeBomWorkbook(
      wholeBomWorkbookBuffer([
        ["1930010001 辊筒输送机 整机BOM表"],
        ["数据来源"],
        [
          "层级",
          "序号",
          "图号/ERP编码",
          "名称",
          "部件内数量",
          "整机数量",
          "材料/类别",
          "单重(kg)",
          "总重(kg)",
          "图纸类别",
          "规格/标准",
          "备注",
          "合并图页",
          "导入失败原因"
        ],
        [
          "整机",
          "",
          "1930010001",
          "辊筒输送机",
          "",
          1,
          "装配图",
          "",
          10,
          "总装图",
          "比例1:10",
          "",
          1,
          ""
        ],
        ["1", "1", "A-100", "一级装配", 2, 2, "装配图", 4, 8, "装配图"],
        ["2", "1", "B-200", "二级装配", 3, 6, "装配图", 1, 6, "装配图"],
        ["3", "1", "C-300", "零件", 4, 24, "304", 0.1, 2.4, "零件图"],
        ["3", "2", "STD-1", "标准件", 1, 6, "A2-70", 0, 0, "标准件"]
      ])
    );

    expect(plan.rootCode).toBe("1930010001");
    expect(plan.items.map((item) => item.code)).toEqual([
      "1930010001",
      "A-100",
      "B-200",
      "C-300",
      "STD-1"
    ]);
    expect(
      plan.edges.map((edge) => [edge.parentCode, edge.childCode, edge.quantity])
    ).toEqual([
      ["1930010001", "A-100", 2],
      ["A-100", "B-200", 3],
      ["B-200", "C-300", 4],
      ["B-200", "STD-1", 1]
    ]);
    expect(plan.items.find((item) => item.code === "C-300")?.methodType).toBe(
      "Make to Order"
    );
    expect(plan.items.find((item) => item.code === "STD-1")?.methodType).toBe(
      "Purchase to Order"
    );
  });

  it("rejects skipped hierarchy levels and conflicting duplicate item names", () => {
    expect(() =>
      parseWholeBomWorkbook(
        wholeBomWorkbookBuffer([
          ["层级", "图号/ERP编码", "名称", "部件内数量"],
          ["整机", "ROOT", "Root", 1],
          ["2", "CHILD", "Child", 1]
        ])
      )
    ).toThrow(/层级/);

    expect(() =>
      parseWholeBomWorkbook(
        wholeBomWorkbookBuffer([
          ["层级", "图号/ERP编码", "名称", "部件内数量"],
          ["整机", "ROOT", "Root", 1],
          ["1", "DUP", "First", 1],
          ["1", "DUP", "Second", 1]
        ])
      )
    ).toThrow(/DUP/);
  });

  it("matches uploaded PDF drawings against expected BOM drawing rows", () => {
    const plan = parseWholeBomWorkbook(
      wholeBomWorkbookBuffer([
        ["层级", "图号/ERP编码", "名称", "部件内数量", "图纸类别", "合并图页"],
        ["整机", "ROOT", "Root", 1, "总装图", 1],
        ["1", "ASM-1", "Assembly", 1, "装配图", 2],
        ["2", "PART-1", "Part", 2, "零件图", 3],
        ["2", "BUY-1", "Purchased", 4, "外购", "—"],
        ["2", "STD-1", "Standard", 8, "标准件", "—"]
      ])
    );

    expect(expectedWholeBomDrawingRows(plan).map((row) => row.code)).toEqual([
      "ROOT",
      "ASM-1",
      "PART-1"
    ]);
    expect(
      matchWholeBomDrawingFileNames(plan, [
        "ROOT.pdf",
        "PART-1.PDF",
        "OTHER-MODEL.pdf",
        "not-a-pdf.txt"
      ])
    ).toEqual({
      matched: [
        { code: "ROOT", fileName: "ROOT.pdf" },
        { code: "PART-1", fileName: "PART-1.PDF" }
      ],
      missingExpected: [
        {
          code: "ASM-1",
          name: "Assembly",
          rowNumber: 3,
          drawingCategory: "装配图",
          drawingPage: "2"
        }
      ],
      unmatched: ["OTHER-MODEL.pdf"]
    });
  });
  it("matches PDF drawings selected from a folder by basename, part code, or part name", () => {
    const plan = parseWholeBomWorkbook(
      wholeBomWorkbookBuffer([
        ["层级", "图号/ERP编码", "名称", "部件内数量", "图纸类别", "合并图页"],
        ["整机", "ROOT", "Root Machine", 1, "总装图", 1],
        ["1", "ASM-1", "一级装配", 1, "装配图", 2],
        ["2", "PART-1", "连接板", 2, "零件图", 3]
      ])
    );

    expect(
      matchWholeBomDrawingFileNames(plan, [
        "1930010001图纸/ROOT.pdf",
        "1930010001图纸/一级装配.PDF",
        "1930010001图纸/子目录/PART-1 连接板.pdf"
      ])
    ).toEqual({
      matched: [
        { code: "ROOT", fileName: "1930010001图纸/ROOT.pdf" },
        { code: "ASM-1", fileName: "1930010001图纸/一级装配.PDF" },
        {
          code: "PART-1",
          fileName: "1930010001图纸/子目录/PART-1 连接板.pdf"
        }
      ],
      missingExpected: [],
      unmatched: []
    });
  });
  it("builds existing-item failure annotations and writes them to the workbook failure column", () => {
    const source = wholeBomWorkbookBuffer([
      ["title"],
      ["层级", "图号/ERP编码", "名称", "部件内数量", "导入失败原因"],
      ["整机", "ROOT", "Root", 1, ""],
      ["1", "EXISTING", "Existing", 2, ""],
      ["1", "NEW", "New", 3, ""]
    ]);
    const plan = parseWholeBomWorkbook(source);
    const failures = buildWholeBomFailures(plan, new Set(["EXISTING"]));
    const annotated = annotateWholeBomWorkbook(source, failures);
    const workbook = XLSX.read(annotated, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[workbook.SheetNames[0] ?? ""],
      { header: 1, raw: false, defval: "" }
    );

    expect(failures).toEqual([
      { code: "EXISTING", rowNumber: 4, reason: "物品编码已存在，已跳过创建" }
    ]);
    expect(rows[3]?.[4]).toBe("物品编码已存在，已跳过创建");
    expect(rows[4]?.[4]).toBe("");
  });
});
