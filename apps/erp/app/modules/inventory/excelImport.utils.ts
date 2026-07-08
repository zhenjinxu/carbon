import * as XLSX from "xlsx";

/**
 * Parsed receipt header data from Excel template
 */
export interface ExcelReceiptHeader {
  receiptId?: string;
  postingDate?: string;
  sourceDocumentReadableId?: string;
  contractNumber?: string;
  receivingDepartment?: string;
  receiverContactName?: string;
  receiverContactPhone?: string;
  senderContactName?: string;
  senderContactPhone?: string;
  shippingMethodName?: string;
  qualityInspectionResult?: string;
  qualityInspectionNotes?: string;
  packagingCondition?: string;
  packagingNotes?: string;
  acceptanceConclusion?: string;
  acceptanceNotes?: string;
  receiverSignature?: string;
  senderSignature?: string;
  warehouseKeeperSignature?: string;
  signatureDate?: string;
}

/**
 * Parsed receipt line item from Excel template
 */
export interface ExcelReceiptLine {
  sequence?: number;
  itemName?: string;
  specification?: string;
  unit?: string;
  expectedQuantity?: number;
  receivedQuantity?: number;
  unitPrice?: number;
  amount?: number;
  notes?: string;
}

/**
 * Full parsed result from Excel import
 */
export interface ExcelImportResult {
  header: ExcelReceiptHeader;
  lines: ExcelReceiptLine[];
}

/**
 * Converts an Excel date serial number to ISO date string (YYYY-MM-DD)
 */
function excelDateToISO(value: unknown): string | undefined {
  if (typeof value !== "number") return undefined;
  const date = XLSX.SSF.parse_date_code(value);
  if (!date) return undefined;
  const y = String(date.y).padStart(4, "0");
  const m = String(date.m).padStart(2, "0");
  const d = String(date.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Reads a cell value from a worksheet safely
 */
function getCell(ws: XLSX.WorkSheet, ref: string): unknown {
  return ws[ref]?.v;
}

/**
 * Reads a cell as string
 */
function getCellStr(ws: XLSX.WorkSheet, ref: string): string | undefined {
  const v = getCell(ws, ref);
  return v != null ? String(v).trim() : undefined;
}

/**
 * Reads a cell as number
 */
function getCellNum(ws: XLSX.WorkSheet, ref: string): number | undefined {
  const v = getCell(ws, ref);
  return typeof v === "number" ? v : undefined;
}

/**
 * Parses inspection checkbox text to extract selected option
 * e.g. "□ 全部合格 □ 部分合格 □ 全部不合格" -> "All Qualified"
 */
function parseCheckboxGroup(
  value: string | undefined,
  mapping: Record<string, string>
): string | undefined {
  if (!value) return undefined;
  for (const [pattern, result] of Object.entries(mapping)) {
    if (value.includes(pattern)) return result;
  }
  return undefined;
}

/**
 * Parses the deliv_note.xlsx template structure
 *
 * Template layout:
 * - Row 2: 单据编号(B2), 收货日期(F2)
 * - Row 3: 关联订单号(B3), 合同号(F3)
 * - Rows 5-9: 收货方/发货方信息
 * - Row 10: 行明细表头
 * - Rows 11-17: 行明细数据
 * - Row 20-22: 验收情况
 * - Row 24-25: 签字确认
 */
export function parseReceiptExcel(buffer: ArrayBuffer): ExcelImportResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  if (!ws) {
    throw new Error("No worksheet found in Excel file");
  }

  // Parse header fields
  const header: ExcelReceiptHeader = {
    receiptId: getCellStr(ws, "B2"),
    postingDate: excelDateToISO(getCell(ws, "F2")),
    sourceDocumentReadableId: getCellStr(ws, "B3"),
    contractNumber: getCellStr(ws, "F3"),
    receivingDepartment: getCellStr(ws, "B6"),
    receiverContactName: getCellStr(ws, "B7"),
    receiverContactPhone: getCellStr(ws, "B8"),
    senderContactName: getCellStr(ws, "E6"),
    senderContactPhone: getCellStr(ws, "E7"),
    shippingMethodName: getCellStr(ws, "E9"),
    receiverSignature: getCellStr(ws, "B24"),
    senderSignature: getCellStr(ws, "E24"),
    warehouseKeeperSignature: getCellStr(ws, "G24"),
    signatureDate: excelDateToISO(getCell(ws, "B25")),
    qualityInspectionResult: parseCheckboxGroup(getCellStr(ws, "B20"), {
      全部合格: "All Qualified",
      部分合格: "Partially Qualified",
      全部不合格: "All Unqualified"
    }),
    qualityInspectionNotes: (() => {
      const v = getCellStr(ws, "B20");
      if (!v) return undefined;
      // Extract text after checkbox options as notes
      const match = v.match(/[,，]\s*不合格说明[：:]\s*(.+)/);
      return match?.[1]?.trim() || undefined;
    })(),
    packagingCondition: parseCheckboxGroup(getCellStr(ws, "B21"), {
      包装完好: "Intact",
      包装破损: "Damaged"
    }),
    packagingNotes: (() => {
      const v = getCellStr(ws, "B21");
      if (!v) return undefined;
      const match = v.match(/[,，]\s*说明[：:]\s*(.+)/);
      return match?.[1]?.trim() || undefined;
    })(),
    acceptanceConclusion: parseCheckboxGroup(getCellStr(ws, "B22"), {
      同意收货: "Accept",
      拒收: "Reject",
      部分收货: "Partial Acceptance"
    })
  };

  // Parse line items (rows 11 onwards, until sequence number is empty)
  const lines: ExcelReceiptLine[] = [];
  for (let row = 11; row <= 100; row++) {
    const seq = getCellNum(ws, `A${row}`);
    const itemName = getCellStr(ws, `B${row}`);
    if (!itemName) break; // Stop when no more items

    lines.push({
      sequence: typeof seq === "number" ? seq : row - 10,
      itemName,
      specification: getCellStr(ws, `C${row}`),
      unit: getCellStr(ws, `D${row}`),
      expectedQuantity: getCellNum(ws, `E${row}`),
      receivedQuantity: getCellNum(ws, `F${row}`),
      unitPrice: getCellNum(ws, `G${row}`),
      amount: getCellNum(ws, `H${row}`),
      notes: getCellStr(ws, `I${row}`)
    });
  }

  return { header, lines };
}
