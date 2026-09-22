import * as XLSX from "xlsx";

export type PartImportRow = {
  code: string;
  description: string;
};

export type WholeBomItem = {
  rowNumber: number;
  level: number;
  code: string;
  name: string;
  description: string | null;
  quantity: number;
  wholeMachineQuantity: number | null;
  drawingCategory: string | null;
  materialCategory: string | null;
  specification: string | null;
  remark: string | null;
  drawingPage: string | null;
  methodType: "Make to Order" | "Purchase to Order";
  replenishmentSystem: "Make" | "Buy";
  attributes: Record<string, unknown>;
};

export type WholeBomEdge = {
  rowNumber: number;
  parentCode: string;
  childCode: string;
  quantity: number;
  order: number;
};

export type WholeBomImportPlan = {
  sheetName: string;
  headerRowNumber: number;
  failureColumnIndex: number;
  rootCode: string;
  items: WholeBomItem[];
  rows: WholeBomItem[];
  edges: WholeBomEdge[];
};

export type WholeBomFailure = {
  code: string;
  rowNumber: number;
  reason: string;
};

export type WholeBomExpectedDrawing = {
  code: string;
  name: string;
  rowNumber: number;
  drawingCategory: string | null;
  drawingPage: string | null;
};

export type WholeBomDrawingMatch = {
  matched: Array<{ code: string; fileName: string }>;
  missingExpected: WholeBomExpectedDrawing[];
  unmatched: string[];
};

const PART_CODE_HEADER = "物料";
const PART_DESCRIPTION_HEADER = "说明";
const WHOLE_BOM_HEADERS = {
  level: "层级",
  code: "图号/ERP编码",
  name: "名称",
  quantity: "部件内数量",
  wholeMachineQuantity: "整机数量",
  materialCategory: "材料/类别",
  unitWeight: "单重(kg)",
  totalWeight: "总重(kg)",
  drawingCategory: "图纸类别",
  specification: "规格/标准",
  remark: "备注",
  drawingPage: "合并图页",
  failureReason: "导入失败原因"
} as const;

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function asNullableText(value: unknown) {
  const text = asText(value);
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHeader(value: unknown) {
  return asText(value).replace(/\s+/g, "");
}

function getHeaderIndex(headers: string[], header: string) {
  return headers.findIndex((value) => normalizeHeader(value) === header);
}

function parseBomLevel(value: unknown, rowNumber: number) {
  const text = asText(value);
  if (text === "整机") return 0;
  if (!/^\d+$/.test(text)) {
    throw new Error(`第 ${rowNumber} 行层级无效`);
  }
  return Number(text);
}

function methodTypeForBomRow(row: {
  drawingCategory: string | null;
  materialCategory: string | null;
}) {
  const category = `${row.drawingCategory ?? ""} ${row.materialCategory ?? ""}`;
  return /标准件|外购/.test(category) ? "Purchase to Order" : "Make to Order";
}

function isBlankDrawingPage(value: string | null) {
  return !value || /^[-—–]+$/.test(value);
}

function drawingFileCode(fileName: string) {
  const trimmed = fileName.trim();
  return /\.pdf$/i.test(trimmed) ? trimmed.replace(/\.pdf$/i, "") : null;
}

function findWholeBomSheet(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: ""
    });
    const headerRowIndex = rows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return (
        headers.includes(WHOLE_BOM_HEADERS.level) &&
        headers.includes(WHOLE_BOM_HEADERS.code) &&
        headers.includes(WHOLE_BOM_HEADERS.name)
      );
    });
    if (headerRowIndex >= 0) {
      return { sheetName, rows, headerRowIndex };
    }
  }
  throw new Error(
    "Excel must contain a multi-level BOM sheet with 层级、图号/ERP编码 and 名称 columns"
  );
}

export function parsePartsWorkbook(
  input: ArrayBuffer | Uint8Array
): PartImportRow[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!firstSheet) throw new Error("Excel workbook has no sheets");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    defval: ""
  });
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map(asText);
  const codeIndex = headers.indexOf(PART_CODE_HEADER);
  const descriptionIndex = headers.indexOf(PART_DESCRIPTION_HEADER);
  if (codeIndex < 0 || descriptionIndex < 0) {
    throw new Error(
      `Excel must contain the ${PART_CODE_HEADER} and ${PART_DESCRIPTION_HEADER} columns`
    );
  }

  const seen = new Map<string, string>();
  for (const row of dataRows) {
    const code = asText(row[codeIndex]);
    const description = asText(row[descriptionIndex]);
    if (!code && !description) continue;
    if (!code)
      throw new Error("Every non-empty row must contain a part number");
    if (!description)
      throw new Error(`Part ${code} is missing its description`);
    const previous = seen.get(code);
    if (previous !== undefined) {
      if (previous !== description) {
        throw new Error(
          `Duplicate part number ${code} has conflicting descriptions`
        );
      }
      continue;
    }
    seen.set(code, description);
  }

  const result = [...seen.entries()].map(([code, description]) => ({
    code,
    description
  }));
  if (result.length === 0) throw new Error("Excel contains no part rows");
  return result;
}

export function parseWholeBomWorkbook(
  input: ArrayBuffer | Uint8Array
): WholeBomImportPlan {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const { sheetName, rows, headerRowIndex } = findWholeBomSheet(workbook);
  const headers = (rows[headerRowIndex] ?? []).map(asText);
  const indexes = {
    level: getHeaderIndex(headers, WHOLE_BOM_HEADERS.level),
    code: getHeaderIndex(headers, WHOLE_BOM_HEADERS.code),
    name: getHeaderIndex(headers, WHOLE_BOM_HEADERS.name),
    quantity: getHeaderIndex(headers, WHOLE_BOM_HEADERS.quantity),
    wholeMachineQuantity: getHeaderIndex(
      headers,
      WHOLE_BOM_HEADERS.wholeMachineQuantity
    ),
    materialCategory: getHeaderIndex(
      headers,
      WHOLE_BOM_HEADERS.materialCategory
    ),
    unitWeight: getHeaderIndex(headers, WHOLE_BOM_HEADERS.unitWeight),
    totalWeight: getHeaderIndex(headers, WHOLE_BOM_HEADERS.totalWeight),
    drawingCategory: getHeaderIndex(headers, WHOLE_BOM_HEADERS.drawingCategory),
    specification: getHeaderIndex(headers, WHOLE_BOM_HEADERS.specification),
    remark: getHeaderIndex(headers, WHOLE_BOM_HEADERS.remark),
    drawingPage: getHeaderIndex(headers, WHOLE_BOM_HEADERS.drawingPage),
    failureReason: getHeaderIndex(headers, WHOLE_BOM_HEADERS.failureReason)
  };
  if (indexes.level < 0 || indexes.code < 0 || indexes.name < 0) {
    throw new Error("Excel must contain 层级、图号/ERP编码 and 名称 columns");
  }

  const stack: WholeBomItem[] = [];
  const rowsByCode = new Map<string, WholeBomItem>();
  const parsedRows: WholeBomItem[] = [];
  const edges: WholeBomEdge[] = [];
  const childCountsByParent = new Map<string, number>();

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;
    const code = asText(row[indexes.code]);
    const name = asText(row[indexes.name]);
    const levelText = asText(row[indexes.level]);
    if (!code && !name && !levelText) continue;
    if (!code) throw new Error(`第 ${rowNumber} 行缺少图号/ERP编码`);
    if (!name) throw new Error(`第 ${rowNumber} 行缺少名称`);
    const level = parseBomLevel(row[indexes.level], rowNumber);
    const drawingCategory =
      indexes.drawingCategory >= 0
        ? asNullableText(row[indexes.drawingCategory])
        : null;
    const materialCategory =
      indexes.materialCategory >= 0
        ? asNullableText(row[indexes.materialCategory])
        : null;
    const methodType = methodTypeForBomRow({
      drawingCategory,
      materialCategory
    });
    const item: WholeBomItem = {
      rowNumber,
      level,
      code,
      name,
      description:
        indexes.specification >= 0
          ? asNullableText(row[indexes.specification])
          : null,
      quantity:
        indexes.quantity >= 0 ? (asNumber(row[indexes.quantity], 1) ?? 1) : 1,
      wholeMachineQuantity:
        indexes.wholeMachineQuantity >= 0
          ? asNumber(row[indexes.wholeMachineQuantity])
          : null,
      drawingCategory,
      materialCategory,
      specification:
        indexes.specification >= 0
          ? asNullableText(row[indexes.specification])
          : null,
      remark: indexes.remark >= 0 ? asNullableText(row[indexes.remark]) : null,
      drawingPage:
        indexes.drawingPage >= 0
          ? asNullableText(row[indexes.drawingPage])
          : null,
      methodType,
      replenishmentSystem: methodType === "Purchase to Order" ? "Buy" : "Make",
      attributes: Object.fromEntries(
        headers
          .map((header, index) => [header, row[index] ?? null] as const)
          .filter(([header]) => header.length > 0)
      )
    };

    const existing = rowsByCode.get(code);
    if (existing && existing.name !== name) {
      throw new Error(`图号/ERP编码 ${code} 在第 ${rowNumber} 行名称不一致`);
    }
    if (!existing) rowsByCode.set(code, item);

    if (level > 0) {
      const parent = stack[level - 1];
      if (!parent) {
        throw new Error(`第 ${rowNumber} 行层级缺少上级节点`);
      }
      const order = (childCountsByParent.get(parent.code) ?? 0) + 1;
      childCountsByParent.set(parent.code, order);
      edges.push({
        rowNumber,
        parentCode: parent.code,
        childCode: code,
        quantity: item.quantity,
        order
      });
    }

    stack[level] = item;
    stack.length = level + 1;
    parsedRows.push(item);
  }

  if (parsedRows.length === 0) throw new Error("Excel contains no BOM rows");
  const roots = parsedRows.filter((row) => row.level === 0);
  if (roots.length !== 1)
    throw new Error("整机 BOM 必须且只能有一个整机根节点");

  return {
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    failureColumnIndex:
      indexes.failureReason >= 0 ? indexes.failureReason : headers.length,
    rootCode: roots[0]!.code,
    items: [...rowsByCode.values()],
    rows: parsedRows,
    edges
  };
}

export function buildWholeBomFailures(
  plan: WholeBomImportPlan,
  existingCodes: Set<string>
): WholeBomFailure[] {
  return plan.rows
    .filter((row) => existingCodes.has(row.code))
    .map((row) => ({
      code: row.code,
      rowNumber: row.rowNumber,
      reason: "物品编码已存在，已跳过创建"
    }));
}

export function expectedWholeBomDrawingRows(
  plan: WholeBomImportPlan
): WholeBomExpectedDrawing[] {
  const seen = new Set<string>();
  return plan.rows
    .filter(
      (row) =>
        row.methodType === "Make to Order" &&
        row.drawingCategory !== null &&
        !isBlankDrawingPage(row.drawingPage)
    )
    .flatMap((row) => {
      if (seen.has(row.code)) return [];
      seen.add(row.code);
      return [
        {
          code: row.code,
          name: row.name,
          rowNumber: row.rowNumber,
          drawingCategory: row.drawingCategory,
          drawingPage: row.drawingPage
        }
      ];
    });
}

export function matchWholeBomDrawingFileNames(
  plan: WholeBomImportPlan,
  fileNames: string[]
): WholeBomDrawingMatch {
  const expected = expectedWholeBomDrawingRows(plan);
  const expectedCodes = new Set(expected.map((row) => row.code));
  const matchedCodes = new Set<string>();
  const matched: WholeBomDrawingMatch["matched"] = [];
  const unmatched: string[] = [];

  for (const fileName of fileNames) {
    const code = drawingFileCode(fileName);
    if (!code) continue;
    if (expectedCodes.has(code)) {
      matched.push({ code, fileName });
      matchedCodes.add(code);
    } else {
      unmatched.push(fileName);
    }
  }

  return {
    matched,
    missingExpected: expected.filter((row) => !matchedCodes.has(row.code)),
    unmatched
  };
}

export function annotateWholeBomWorkbook(
  input: ArrayBuffer | Uint8Array,
  failures: WholeBomFailure[]
) {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const { sheetName, rows, headerRowIndex } = findWholeBomSheet(workbook);
  const headers = (rows[headerRowIndex] ?? []).map(asText);
  let failureColumnIndex = getHeaderIndex(
    headers,
    WHOLE_BOM_HEADERS.failureReason
  );
  if (failureColumnIndex < 0) {
    failureColumnIndex = headers.length;
    rows[headerRowIndex]![failureColumnIndex] = WHOLE_BOM_HEADERS.failureReason;
  }

  const failuresByRow = new Map(
    failures.map((failure) => [failure.rowNumber, failure])
  );
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const failure = failuresByRow.get(rowIndex + 1);
    row[failureColumnIndex] = failure?.reason ?? "";
    rows[rowIndex] = row;
  }
  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  }) as Uint8Array;
}
