import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}
type CsvRow = Record<string, string>;
type JsonRecord = Record<string, unknown>;

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  const [headers = [], ...body] = rows.filter((entry) => entry.some((cell) => cell.length > 0));
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function numberValue(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: string | undefined) {
  return /^(true|1|yes)$/i.test(value ?? "");
}

function unique<T>(values: Iterable<T>) {
  return Array.from(new Set(values));
}

function groupSummary(rows: CsvRow[], keyOf: (row: CsvRow) => string) {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = keyOf(row) || "(empty)";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => ({
      key,
      rows: groupRows.length,
      parts: unique(groupRows.map((row) => row.partCode || row.partId)).length,
      qty: Number(groupRows.reduce((sum, row) => sum + numberValue(row.quantity), 0).toFixed(6))
    }))
    .sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key, "zh-Hans-CN"));
}

function topNames(rows: CsvRow[], limit = 20) {
  return groupSummary(rows, (row) => row.materialName).slice(0, limit);
}

function rowsForPart(rows: CsvRow[]) {
  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = row.partCode || row.partId;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function compactRawRow(row: CsvRow) {
  return {
    partCode: row.partCode,
    partName: row.partName,
    materialCode: row.materialCode,
    materialName: row.materialName,
    level: Number(row.level || 0),
    operationSequence: row.operationSequence || "(empty)",
    quantity: numberValue(row.quantity),
    isPurchased: truthy(row.isPurchased),
    isManufactured: truthy(row.isManufactured),
    category: row.category,
    opComponentId: row.opComponentId
  };
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
const workDir = resolve(root, ".codex/work");
const sourceFiles = {
  partsCsv: resolve(workDir, "u8-laser-parts-20260824.csv"),
  rawMaterialsCsv: resolve(workDir, "u8-laser-raw-materials-20260824.csv"),
  summaryJson: resolve(workDir, "u8-laser-query-20260824-summary.json"),
  recursiveJson: resolve(workDir, "u8-laser-query-20260824-recursive.json"),
  reportMd: resolve(workDir, "u8-laser-query-20260824.md")
};
const outputJsonPath = resolve(workDir, "u8-laser-material-evidence-analysis-20260824.json");
const outputMdPath = resolve(workDir, "u8-laser-material-evidence-analysis-20260824.md");

const parts = parseCsv(readFileSync(sourceFiles.partsCsv, "utf8"));
const rawMaterials = parseCsv(readFileSync(sourceFiles.rawMaterialsCsv, "utf8"));
const sourceSummary = JSON.parse(readFileSync(sourceFiles.summaryJson, "utf8")) as JsonRecord;

const partGroups = rowsForPart(rawMaterials);
const plateRows = rawMaterials.filter((row) => row.category === "板材/平板");
const platePurchased0020Rows = plateRows.filter((row) => truthy(row.isPurchased) && row.operationSequence === "0020");
const nonPlateRows = rawMaterials.filter((row) => row.category !== "板材/平板");
const partCodes = unique(parts.map((row) => row.partCode || row.partId));
const partsWithPlateRows = unique(plateRows.map((row) => row.partCode || row.partId));
const partsWithPlatePurchased0020 = unique(platePurchased0020Rows.map((row) => row.partCode || row.partId));
const partsWithoutPlateRows = partCodes.filter((partCode) => !(partGroups.get(partCode) ?? []).some((row) => row.category === "板材/平板"));
const partsWithMultiLevelRawMaterials = unique(rawMaterials.filter((row) => Number(row.level || 0) > 1).map((row) => row.partCode || row.partId));
const manufacturedRows = rawMaterials.filter((row) => truthy(row.isManufactured));
const non0020Rows = rawMaterials.filter((row) => row.operationSequence !== "0020");
const blankOrMissingOperationRows = rawMaterials.filter((row) => !row.operationSequence);
const blankSpecRawMaterialRows = rawMaterials.filter((row) => !(row.specification ?? "").trim());
const blankSpecParts = parts.filter((row) => !(row.specification ?? "").trim());
const rawNameText = rawMaterials.map((row) => row.materialName).join("\n");
const plateNameRows = rawMaterials.filter((row) => /平板|拉丝板|钢板|板材|卷板|不锈钢板/i.test(row.materialName));
const billetNameRows = rawMaterials.filter((row) => /毛坯/i.test(row.materialName));
const tubeRows = rawMaterials.filter((row) => row.category === "管材" || /管|tube/i.test(row.materialName));
const rodRows = rawMaterials.filter((row) => row.category === "棒材" || /棒|圆棒|bar/i.test(row.materialName));
const purchasedRatio = rawMaterials.length ? manufacturedRows.length / rawMaterials.length : 0;

const analysis = {
  generatedAt: new Date().toISOString(),
  sourceFiles,
  sourceSelection: sourceSummary.selection ?? null,
  verification: {
    partRowsFromCsv: parts.length,
    rawMaterialRowsFromCsv: rawMaterials.length,
    uniquePartCodesFromCsv: partCodes.length,
    uniqueRawMaterialCodesFromCsv: unique(rawMaterials.map((row) => row.materialCode)).length,
    purchasedRowsFromCsv: rawMaterials.filter((row) => truthy(row.isPurchased)).length,
    manufacturedRowsFromCsv: manufacturedRows.length,
    sourceSummaryCounts: sourceSummary.counts ?? null,
    countsMatchSourceSummary: {
      parts: parts.length === (sourceSummary.counts as JsonRecord | undefined)?.parts,
      rawMaterialRows: rawMaterials.length === (sourceSummary.counts as JsonRecord | undefined)?.rawMaterialRows,
      uniqueRawMaterialCodes: unique(rawMaterials.map((row) => row.materialCode)).length === (sourceSummary.counts as JsonRecord | undefined)?.uniqueRawMaterialCodes
    }
  },
  materialEvidence: {
    categorySummary: groupSummary(rawMaterials, (row) => row.category),
    operationSequenceSummary: groupSummary(rawMaterials, (row) => row.operationSequence),
    topRawMaterialNames: topNames(rawMaterials),
    plateRows: plateRows.length,
    platePartCoverage: {
      partsWithPlateRows: partsWithPlateRows.length,
      totalParts: partCodes.length,
      ratio: Number((partsWithPlateRows.length / Math.max(partCodes.length, 1)).toFixed(4))
    },
    platePurchased0020Coverage: {
      rows: platePurchased0020Rows.length,
      parts: partsWithPlatePurchased0020.length,
      totalParts: partCodes.length,
      ratio: Number((partsWithPlatePurchased0020.length / Math.max(partCodes.length, 1)).toFixed(4))
    },
    freeTextSignals: {
      plateLikeNameRows: plateNameRows.length,
      billetNameRows: billetNameRows.length,
      tubeRows: tubeRows.length,
      rodRows: rodRows.length,
      mentionsSUS304: /SUS304|304/.test(rawNameText),
      mentionsSUS316: /SUS316|316/.test(rawNameText),
      mentions6061: /6061/.test(rawNameText)
    }
  },
  edgeCases: {
    partsWithoutPlateRows,
    partsWithMultiLevelRawMaterials,
    manufacturedRawMaterialRows: manufacturedRows.map(compactRawRow),
    non0020Rows: non0020Rows.map(compactRawRow),
    blankOrMissingOperationRows: blankOrMissingOperationRows.map(compactRawRow),
    nonPlateRawMaterialRows: nonPlateRows.map(compactRawRow).slice(0, 60),
    billetNameRows: billetNameRows.map(compactRawRow),
    blankSpecCounts: {
      partRows: blankSpecParts.length,
      rawMaterialRows: blankSpecRawMaterialRows.length
    }
  },
  candidateEvidenceRules: [
    {
      key: "u8_leaf_plate_raw_material_at_laser_operation",
      status: "candidate_positive_signal_only",
      evidence: "In the 100 positive laser-route sample, plate/flat leaf raw material appears in 99/100 parts and purchased plate leaf raw material tied to operation sequence 0020 appears in most parts.",
      proposedCondition: "recursive leaf raw material category is 板材/平板 or approved plate-like name token, operationSequence=0020, and purchased flag is true",
      allowedUseNow: "audit/planning only",
      blockedUseNow: "do not change AI Routing production route generation until this U8 evidence is connected to target evidence and validated against larger positive plus negative/control samples"
    },
    {
      key: "u8_non_plate_laser_edge_cases",
      status: "known_edge_case",
      evidence: "管材, 棒材, 封头, 外购成品件, and one 其他 row exist in the positive laser sample.",
      implication: "A plate-only rule cannot explain all laser routes; non-plate materials need separate, narrower evidence paths or human review."
    },
    {
      key: "free_text_billet_or_sheet_name",
      status: "blocked_as_direct_rule",
      evidence: "U8 cInvStd/spec fields are mostly blank, and material type is inferred from cInvName text. 毛坯 appears in a laser-positive sample but also in source-reviewed no-laser examples outside this packet.",
      implication: "Do not use raw free-text tokens such as 毛坯/拉丝板 directly as generation rules without an approved curated mapping."
    }
  ],
  decision: {
    routeGenerationChangeRecommendedNow: false,
    reason: "This packet is a positive-only laser sample. It supports a future positive evidence source based on U8 recursive leaf raw materials, but it does not prove a safe negative rule and does not yet connect U8 raw-material evidence into AI Routing target evidence.",
    materializationGate: "closed",
    sampleRoleWriteGate: "closed",
    nextGate: [
      "Run the same analysis on the planned 1000 laser-route sample and compare stability of plate/flat raw-material coverage, operationSequence=0020 linkage, and non-plate edge cases.",
      "Add a no-laser/control sample set for sheet/plate-like and 毛坯-like raw materials, including 1927930206 and 192769010102 families, before writing negative suppression rules.",
      "If evidence holds, design an explicit U8 raw-material evidence adapter that feeds target evidence separately from drawing text, then write RED tests before production behavior changes."
    ]
  }
};

const md = `# U8 激光原料证据分析（100 样本）

## 核对

- 零件 CSV 行数：${analysis.verification.partRowsFromCsv}
- 叶子原料 CSV 行数：${analysis.verification.rawMaterialRowsFromCsv}
- 去重零件编码：${analysis.verification.uniquePartCodesFromCsv}
- 去重原料编码：${analysis.verification.uniqueRawMaterialCodesFromCsv}
- 采购属性原料行：${analysis.verification.purchasedRowsFromCsv}
- 自制属性原料行：${analysis.verification.manufacturedRowsFromCsv}

## 主要结论

- 板材/平板叶子原料覆盖 ${analysis.materialEvidence.platePartCoverage.partsWithPlateRows}/${analysis.materialEvidence.platePartCoverage.totalParts} 个激光零件，零件覆盖率 ${Math.round(analysis.materialEvidence.platePartCoverage.ratio * 1000) / 10}%。
- 采购属性、BOM 工序号 0020、板材/平板同时成立的覆盖为 ${analysis.materialEvidence.platePurchased0020Coverage.parts}/${analysis.materialEvidence.platePurchased0020Coverage.totalParts} 个零件。
- 该样本是激光正样本；它支持“板材/平板叶子原料是强正向证据”，但不能单独证明“没有板材/平板就不能激光”或“毛坯一定不能激光”。
- 管材、棒材、封头、外购成品件在激光样本中也存在，后续需要作为边界案例处理。

## 候选规则状态

1. 候选正向证据：递归叶子原料为板材/平板，且与 0020 激光工序对应，且采购属性为 true。
2. 暂不允许进入生产 route generation：需要 1000 正样本稳定性 + no-laser/control 样本验证。
3. 禁止直接从自由文本 “毛坯”/“拉丝板” 写路线规则；这些只能作为人工审计或 curated mapping 的输入。

## 下一步门禁

- 等 1000 样本到位后复跑同一分析器。
- 补一组无激光/控制样本，覆盖板材、平板、毛坯、拉丝板、管材、棒材。
- 只有在 U8 原料证据进入 AI Routing target evidence 后，才进入 TDD route-generation 变更。

生产/materialization gate：closed。
`;

writeFileSync(outputJsonPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
writeFileSync(outputMdPath, md, "utf8");
console.log(JSON.stringify({
  outputJsonPath,
  outputMdPath,
  partRows: analysis.verification.partRowsFromCsv,
  rawMaterialRows: analysis.verification.rawMaterialRowsFromCsv,
  platePartCoverage: analysis.materialEvidence.platePartCoverage,
  platePurchased0020Coverage: analysis.materialEvidence.platePurchased0020Coverage,
  routeGenerationChangeRecommendedNow: analysis.decision.routeGenerationChangeRecommendedNow
}, null, 2));