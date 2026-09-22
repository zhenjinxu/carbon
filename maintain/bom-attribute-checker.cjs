#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { createRequire } = require("node:module");

const EXCEL_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xls"]);

const FIELD_MAPPINGS = [
  {
    carbonField: "methodMaterial.customFields.u8.level",
    table: "methodMaterial",
    category: "bomStructure",
    confidence: "high",
    aliases: ["层级", "级次", "level", "lv"],
    note: "BOM display/tree level. Store as source metadata; Carbon hierarchy is represented by makeMethod/methodMaterial links."
  },
  {
    carbonField: "item.readableId",
    table: "item",
    category: "itemIdentity",
    confidence: "high",
    aliases: [
      "子件编码",
      "物料编码",
      "存货编码",
      "erp编码",
      "图号",
      "图号/erp编码",
      "零件编号",
      "件号",
      "part no.",
      "part number",
      "item code",
      "item number",
      "childinvcode",
      "child code",
      "invcode"
    ],
    note: "Carbon uses item.readableId for the business-visible item/part number."
  },
  {
    carbonField: "item.readableId",
    table: "item",
    category: "parentIdentity",
    confidence: "high",
    aliases: ["母件编码", "父件编码", "上级编码", "parentinvcode", "parent code", "parent item", "parent part"],
    note: "Parent item code should resolve to the makeMethod that owns the BOM material row."
  },
  {
    carbonField: "item.readableId",
    table: "item",
    category: "rootIdentity",
    confidence: "high",
    aliases: ["根件编码", "根物料编码", "rootinvcode", "root item", "root part"],
    note: "Root item code is source context for the import batch."
  },
  {
    carbonField: "item.name",
    table: "item",
    category: "itemDescription",
    confidence: "high",
    aliases: ["子件名称", "物料名称", "存货名称", "零件名称", "名称", "品名", "description", "desc", "childinvname", "item name", "part name"],
    note: "U8 cInvName normally maps to Carbon item.name."
  },
  {
    carbonField: "item.description",
    table: "item",
    category: "itemSpecification",
    confidence: "medium",
    aliases: ["规格型号", "规格", "型号", "规格尺寸", "cInvStd", "spec", "specification", "model", "childinvstd"],
    note: "Carbon has item.description and custom fields. Use a dedicated custom field if specification must be separately filterable."
  },
  {
    carbonField: "item.unitOfMeasureCode",
    table: "item",
    category: "unit",
    confidence: "high",
    aliases: ["单位", "计量单位", "主计量单位", "childunit", "uom", "unit", "unit of measure", "unitOfMeasureCode"],
    note: "Must resolve to unitOfMeasure.code before import."
  },
  {
    carbonField: "methodMaterial.quantity",
    table: "methodMaterial",
    category: "bomQuantity",
    confidence: "high",
    aliases: ["直接用量", "用量", "基本用量", "数量", "directqty", "direct quantity", "qty", "quantity", "baseqty"],
    note: "Direct BOM component quantity. Preserve denominator/source values in customFields when present."
  },
  {
    carbonField: "methodMaterial.customFields.u8.cumulativeQuantity",
    table: "methodMaterial",
    category: "bomQuantity",
    confidence: "medium",
    aliases: ["累计用量", "累计数量", "cumqty", "cumulative quantity"],
    note: "Cumulative quantity is derived from the multi-level path; do not use it as the direct BOM quantity."
  },
  {
    carbonField: "methodMaterial.methodOperationId",
    table: "methodMaterial",
    category: "operationLink",
    confidence: "medium",
    aliases: ["投料工序序号", "工序序号", "工序", "opseq", "operation sequence", "operation"],
    note: "Resolve source OpSeq to the Carbon methodOperation row for operation-level material consumption."
  },
  {
    carbonField: "methodMaterial.customFields.u8.sortSeq",
    table: "methodMaterial",
    category: "sourceOrdering",
    confidence: "medium",
    aliases: ["bom行序号", "行序号", "排序", "sortseq", "sort sequence", "line no", "line number"],
    note: "Keep the U8/display ordering. Add a real order column only if Carbon does not already expose the needed ordering."
  },
  {
    carbonField: "externalIntegrationMapping.externalId",
    table: "externalIntegrationMapping",
    category: "sourceIdentity",
    confidence: "high",
    aliases: ["bom明细id", "opcomponentid", "bomdetailid", "component line id", "source line id"],
    note: "Use as U8 source identity for idempotency, not as Carbon primary key."
  },
  {
    carbonField: "makeMethod.customFields.u8.bomId",
    table: "makeMethod",
    category: "sourceIdentity",
    confidence: "high",
    aliases: ["bomid", "bom id", "bom版本", "bom version"],
    note: "Preserve source BOM identity on the owning makeMethod or in externalIntegrationMapping."
  },
  {
    carbonField: "methodMaterial.customFields.u8.edgePath",
    table: "methodMaterial",
    category: "sourceTrace",
    confidence: "medium",
    aliases: ["bom边路径", "edgepath", "edge path"],
    note: "Useful for diagnostics and detecting repeated children on different BOM paths."
  },
  {
    carbonField: "methodMaterial.customFields.u8.itemPath",
    table: "methodMaterial",
    category: "sourceTrace",
    confidence: "medium",
    aliases: ["物料路径", "itempath", "item path"],
    note: "Useful for diagnostics only; normalized Carbon relations should remain authoritative."
  },
  {
    carbonField: "item.revision",
    table: "item",
    category: "revision",
    confidence: "high",
    aliases: ["版本", "版次", "revision", "rev"],
    note: "Carbon item revisions are first-class item rows."
  },
  {
    carbonField: "item.active",
    table: "item",
    category: "status",
    confidence: "medium",
    aliases: ["启用", "是否启用", "停用", "active", "status"],
    note: "Normalize source status to Carbon active/disabled semantics."
  },
  {
    carbonField: "item.defaultMethodType",
    table: "item",
    category: "methodType",
    confidence: "medium",
    aliases: ["制造方式", "采购制造", "默认方法", "default method", "defaultMethodType", "method type"],
    note: "Map to Carbon methodType enum after value normalization."
  },
  {
    carbonField: "item.replenishmentSystem",
    table: "itemReplenishment",
    category: "replenishment",
    confidence: "medium",
    aliases: ["补货方式", "补给方式", "replenishment", "replenishment system"],
    note: "Carbon stores replenishment information across item and itemReplenishment rows."
  },
  {
    carbonField: "item.itemTrackingType",
    table: "item",
    category: "tracking",
    confidence: "medium",
    aliases: ["追踪方式", "批次序列", "批号管理", "序列号管理", "tracking type", "itemTrackingType"],
    note: "Map to Carbon itemTrackingType enum."
  },
  {
    carbonField: "supplierPart.supplierId",
    table: "supplierPart",
    category: "supplier",
    confidence: "medium",
    aliases: ["供应商", "供应商编码", "供应商名称", "supplier", "vendor", "vendor code", "vendor name"],
    note: "Resolve supplier first; supplier-specific part numbers belong in supplierPart."
  },
  {
    carbonField: "supplierPart.supplierPartId",
    table: "supplierPart",
    category: "supplier",
    confidence: "medium",
    aliases: ["供应商料号", "供应商物料号", "supplier part", "supplier part number", "vendor part"],
    note: "Supplier-facing item number."
  },
  {
    carbonField: "material.grade",
    table: "material",
    category: "materialProperty",
    confidence: "medium",
    aliases: ["牌号", "材质牌号", "grade", "material grade"],
    note: "For actual material records, resolve to materialGrade where possible."
  },
  {
    carbonField: "material.materialSubstanceId",
    table: "material",
    category: "materialProperty",
    confidence: "medium",
    aliases: ["材质", "材料", "材料名称", "material", "substance", "material substance"],
    note: "Resolve structured materials to materialSubstance/materialForm where possible."
  },
  {
    carbonField: "material.finish",
    table: "material",
    category: "materialProperty",
    confidence: "medium",
    aliases: ["表面处理", "处理", "finish", "surface finish"],
    note: "Resolve to materialFinish if it is a material master attribute; otherwise store on part customFields."
  },
  {
    carbonField: "material.dimensions",
    table: "material",
    category: "materialProperty",
    confidence: "medium",
    aliases: ["尺寸", "材料尺寸", "dimensions", "dimension"],
    note: "Resolve to materialDimension if the row represents material stock."
  }
];

FIELD_MAPPINGS.push(
  {
    carbonField: "methodMaterial.customFields.u8.sourceLineNumber",
    table: "methodMaterial",
    category: "sourceOrdering",
    confidence: "high",
    aliases: ["序号", "行号", "no", "number"],
    note: "Template/display line number. Keep as source metadata; do not use as a stable Carbon identity."
  },
  {
    carbonField: "methodMaterial.quantity",
    table: "methodMaterial",
    category: "bomQuantity",
    confidence: "high",
    aliases: ["部件内数量", "部件数量", "组件内数量", "within assembly quantity"],
    note: "Quantity consumed by the immediate parent assembly; this is normally Carbon methodMaterial.quantity."
  },
  {
    carbonField: "methodMaterial.customFields.u8.wholeMachineQuantity",
    table: "methodMaterial",
    category: "bomQuantity",
    confidence: "medium",
    aliases: ["整机数量", "整机用量", "whole machine quantity", "total assembly quantity"],
    note: "Quantity rolled up to the root assembly. Preserve for checking; direct BOM import should still use the parent-level quantity."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.materialOrCategory",
    table: "part",
    category: "sourceAttribute",
    confidence: "medium",
    aliases: ["材料/类别", "材料类别", "材料/等级", "材料等级"],
    note: "Mixed material/category text from the template. Normalize into material tables only after values are curated."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.unitWeightKg",
    table: "part",
    category: "weight",
    confidence: "medium",
    aliases: ["单重(kg)", "单重kg", "单重", "unit weight", "unit weight kg"],
    note: "Source unit weight in kg. Promote to a numeric column only if costing/planning uses it as governed data."
  },
  {
    carbonField: "methodMaterial.customFields.u8.totalWeightKg",
    table: "methodMaterial",
    category: "weight",
    confidence: "medium",
    aliases: ["总重(kg)", "总重kg", "总重", "total weight", "total weight kg"],
    note: "Extended weight from the BOM row/root quantity. Treat as derived/checking data unless business confirms otherwise."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.drawingCategory",
    table: "part",
    category: "drawing",
    confidence: "medium",
    aliases: ["图纸类别", "drawing category", "drawing type"],
    note: "Template drawing class such as 总装图/装配图/零件图/外购/标准件."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.specificationOrStandard",
    table: "part",
    category: "sourceAttribute",
    confidence: "medium",
    aliases: ["规格/标准", "规格标准", "标准", "standard", "specification standard"],
    note: "Mixed specification/standard text. Map to item.description or material tables only after value semantics are separated."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.notes",
    table: "part",
    category: "sourceAttribute",
    confidence: "medium",
    aliases: ["备注", "note", "notes", "remark", "remarks"],
    note: "Source notes. Keep separate from governed Carbon descriptions unless reviewed."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.mergedDrawingPage",
    table: "part",
    category: "drawing",
    confidence: "medium",
    aliases: ["合并图页", "图页", "drawing page", "merged drawing page"],
    note: "Drawing packet page reference from the Excel template."
  },
  {
    carbonField: "part.customFields.u8BomAttributes.itemCategory",
    table: "part",
    category: "sourceAttribute",
    confidence: "medium",
    aliases: ["类别", "分类", "item category", "category"],
    note: "Template item class such as 标准件/加工件/外购. Use governed enums only after business categories are finalized."
  },  {
    carbonField: "importReport.errorReason",
    table: "importReport",
    category: "diagnostic",
    confidence: "high",
    aliases: ["导入失败原因", "失败原因", "error reason", "import error"],
    note: "Import diagnostic output. Do not persist as item master data."
  }
);
const NORMALIZED_LOOKUP = new Map();
for (const mapping of FIELD_MAPPINGS) {
  for (const alias of mapping.aliases) {
    NORMALIZED_LOOKUP.set(normalizeHeader(alias), mapping);
  }
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._\-\\/|,，:：;；()（）\[\]【】{}<>《》"'`]+/g, "")
    .replace(/\u00a0/g, "");
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function detectHeaderRow(rows) {
  let best = { rowIndex: 0, headers: [], score: -1 };

  rows.forEach((row, rowIndex) => {
    const headers = Array.isArray(row) ? row.map(cellText) : [];
    const nonEmpty = headers.filter(Boolean);
    if (nonEmpty.length < 2) return;

    let score = nonEmpty.length;
    for (const header of nonEmpty) {
      const normalized = normalizeHeader(header);
      if (NORMALIZED_LOOKUP.has(normalized)) score += 4;
      if (/编码|物料|零件|bom|数量|单位|层级|工序/i.test(header)) score += 1;
    }

    if (score > best.score) {
      best = { rowIndex, headers, score };
    }
  });

  return best;
}

function inferUnknownTarget(header) {
  const normalized = normalizeHeader(header);
  if (/工序|operation|opseq|process/.test(normalized)) {
    return "methodOperation.customFields.u8BomAttributes";
  }
  if (/用量|数量|qty|quantity|bom|母件|父件|子件/.test(normalized)) {
    return "methodMaterial.customFields.u8BomAttributes";
  }
  if (/材料|材质|尺寸|牌号|material|finish|grade|dimension/.test(normalized)) {
    return "material.customFields.u8BomAttributes";
  }
  return "part.customFields.u8BomAttributes";
}

function analyzeHeaders(headers, options = {}) {
  const samplesByHeader = options.samplesByHeader ?? new Map();
  const seen = new Set();
  const known = [];
  const unknown = [];

  for (const rawHeader of headers) {
    const excelHeader = cellText(rawHeader);
    if (!excelHeader) continue;
    const normalized = normalizeHeader(excelHeader);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const mapping = NORMALIZED_LOOKUP.get(normalized);
    if (mapping) {
      known.push({
        excelHeader,
        carbonField: mapping.carbonField,
        table: mapping.table,
        category: mapping.category,
        confidence: mapping.confidence,
        note: mapping.note,
        samples: samplesByHeader.get(excelHeader) ?? []
      });
      continue;
    }

    const storage = inferUnknownTarget(excelHeader);
    unknown.push({
      excelHeader,
      normalized,
      samples: samplesByHeader.get(excelHeader) ?? [],
      recommendation: {
        storage,
        action: "Keep in customFields first; promote to a migrated column/table only when it needs constraints, joins, permissions, or high-frequency indexed filtering.",
        migrationNeededNow: false
      }
    });
  }

  return {
    known,
    unknown,
    coverage: headers.filter((h) => cellText(h)).length === 0
      ? 0
      : known.length / headers.filter((h) => cellText(h)).length
  };
}

function collectSamples(rows, headerRowIndex, headers, limit = 5) {
  const samplesByHeader = new Map();
  headers.forEach((header, index) => {
    const key = cellText(header);
    if (!key) return;
    const values = [];
    for (const row of rows.slice(headerRowIndex + 1)) {
      const value = cellText(Array.isArray(row) ? row[index] : "");
      if (value && !values.includes(value)) values.push(value);
      if (values.length >= limit) break;
    }
    samplesByHeader.set(key, values);
  });
  return samplesByHeader;
}

function buildStorageRecommendation(unknownFields) {
  const fieldNames = unknownFields.map((field) => field.excelHeader);
  return {
    primaryChoice: "jsonbCustomFields",
    avoidSpareColumns: true,
    recommendedNamespace: "customFields.u8BomAttributes",
    promoteWhen: [
      "The attribute participates in foreign keys or tenant-scoped relationships.",
      "The attribute needs database CHECK/UNIQUE constraints or enum governance.",
      "Users filter/sort/report on it frequently at production scale.",
      "The attribute is repeatable or belongs to a child collection rather than one item row."
    ],
    sqlHints: [
      "Use existing JSONB customFields for exploratory and low-frequency heterogeneous attributes.",
      "Add a GIN index on customFields only after query patterns are known: CREATE INDEX ... USING GIN (\"customFields\" jsonb_path_ops).",
      "For hot JSON keys, prefer a generated column or expression index instead of dozens of reserved spare columns.",
      "For repeatable or relational attributes, create a company-scoped extension table with id, companyId, foreign keys, audit columns, RLS, and indexes."
    ],
    unknownFieldNames: fieldNames
  };
}

function loadXlsx() {
  const attempts = [
    () => require("xlsx"),
    () => createRequire(path.resolve(__dirname, "../apps/erp/package.json"))("xlsx"),
    () => createRequire(path.resolve(process.cwd(), "apps/erp/package.json"))("xlsx")
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Cannot load the xlsx package. Run from the Carbon workspace with dependencies installed. Attempts: ${errors.join(" | ")}`);
}

function listExcelFiles(directory) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) throw new Error(`Directory does not exist: ${resolved}`);
  return fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(resolved, entry.name))
    .filter((file) => EXCEL_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .filter((file) => !path.basename(file).startsWith("~$"))
    .sort((a, b) => a.localeCompare(b));
}

async function chooseExcelFile(directory, index) {
  const files = listExcelFiles(directory);
  if (files.length === 0) throw new Error(`No Excel files found in ${path.resolve(directory)}`);
  if (index !== undefined) {
    const selected = files[Number(index) - 1];
    if (!selected) throw new Error(`Selection index ${index} is outside 1..${files.length}`);
    return selected;
  }
  if (files.length === 1 || !process.stdin.isTTY) return files[0];

  files.forEach((file, i) => console.log(`${i + 1}. ${path.basename(file)}`));
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Select Excel file number: ");
  rl.close();
  const selected = files[Number(answer.trim()) - 1];
  if (!selected) throw new Error(`Invalid selection: ${answer}`);
  return selected;
}

function analyzeWorkbook(filePath, options = {}) {
  const XLSX = loadXlsx();
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetNames = options.sheet ? [options.sheet] : workbook.SheetNames;
  const sheets = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false
    });
    const detected = detectHeaderRow(rows);
    const samplesByHeader = collectSamples(rows, detected.rowIndex, detected.headers);
    const analysis = analyzeHeaders(detected.headers, { samplesByHeader });
    sheets.push({
      sheetName,
      rowCount: rows.length,
      headerRow: detected.rowIndex + 1,
      headers: detected.headers.filter(Boolean),
      ...analysis,
      storageRecommendation: buildStorageRecommendation(analysis.unknown)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    filePath: path.resolve(filePath),
    workbookSheets: workbook.SheetNames,
    sheets,
    recommendation: buildStorageRecommendation(sheets.flatMap((sheet) => sheet.unknown))
  };
}

function markdownTable(headers, rows) {
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`)
  ].join("\n");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Carbon BOM Excel Attribute Check`);
  lines.push("");
  lines.push(`- File: ${report.filePath}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Workbook sheets: ${report.workbookSheets.join(", ")}`);
  lines.push("");

  for (const sheet of report.sheets) {
    lines.push(`## Sheet: ${sheet.sheetName}`);
    lines.push("");
    lines.push(`- Header row: ${sheet.headerRow}`);
    lines.push(`- Rows scanned: ${sheet.rowCount}`);
    lines.push(`- Mapping coverage: ${Math.round(sheet.coverage * 100)}%`);
    lines.push("");

    lines.push("### Known Field Mappings");
    lines.push("");
    if (sheet.known.length === 0) {
      lines.push("No known Carbon mappings were detected.");
    } else {
      lines.push(markdownTable(
        ["Excel header", "Carbon field", "Table", "Confidence", "Samples", "Note"],
        sheet.known.map((field) => [
          field.excelHeader,
          field.carbonField,
          field.table,
          field.confidence,
          field.samples.join(", "),
          field.note
        ])
      ));
    }
    lines.push("");

    lines.push("### Unknown / Extension Fields");
    lines.push("");
    if (sheet.unknown.length === 0) {
      lines.push("No unknown fields were detected.");
    } else {
      lines.push(markdownTable(
        ["Excel header", "Suggested storage", "Samples", "Migration now?"],
        sheet.unknown.map((field) => [
          field.excelHeader,
          field.recommendation.storage,
          field.samples.join(", "),
          field.recommendation.migrationNeededNow ? "yes" : "no"
        ])
      ));
    }
    lines.push("");
  }

  lines.push("## Database Recommendation");
  lines.push("");
  lines.push("Use Carbon's existing JSONB `customFields` and custom field UI for uncertain BOM attributes first. Do not pre-create dozens of spare columns on every table. Promote fields through normal Carbon migrations only when query, constraint, relationship, or performance evidence exists.");
  lines.push("");
  for (const hint of report.recommendation.sqlHints) lines.push(`- ${hint}`);
  lines.push("");
  lines.push("## Suggested Implementation Path");
  lines.push("");
  lines.push("1. Import stable identity and BOM structure into `item`, `part`/`material`, `makeMethod`, `methodMaterial`, and `externalIntegrationMapping`.");
  lines.push("2. Store uncertain or source-specific attributes under `customFields.u8BomAttributes` with a field dictionary.");
  lines.push("3. Add migrated columns only for approved, durable fields that need constraints, indexes, or first-class UI behavior.");
  lines.push("4. Add extension tables for repeatable or relational attributes instead of packing arrays into item rows.");
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { format: "markdown" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") args.file = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--sheet") args.sheet = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--format") args.format = argv[++i];
    else if (arg === "--index") args.index = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage:\n  node maintain/bom-attribute-checker.cjs --file <workbook.xlsx> [--sheet <name>] [--format markdown|json] [--out <path>]\n  node maintain/bom-attribute-checker.cjs --dir <directory> [--index <n>] [--out <path>]\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const filePath = args.file ?? await chooseExcelFile(args.dir ?? process.cwd(), args.index);
  const report = analyzeWorkbook(filePath, { sheet: args.sheet });
  const content = args.format === "json" ? JSON.stringify(report, null, 2) : renderMarkdown(report);

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, content, "utf8");
    console.log(`Wrote ${path.resolve(args.out)}`);
  } else {
    console.log(content);
  }
}

module.exports = {
  FIELD_MAPPINGS,
  normalizeHeader,
  detectHeaderRow,
  analyzeHeaders,
  buildStorageRecommendation,
  collectSamples,
  listExcelFiles,
  analyzeWorkbook,
  renderMarkdown,
  parseArgs
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
