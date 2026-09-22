#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mssql = require("mssql");
const { buildBomTree } = require("./lib/u8-bom-tree.cjs");

const CARBON_ROOT = path.resolve(__dirname, "..");
const SOURCE_BATCH_SIZE = 500;

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, index).trim()] = value;
  }
  return env;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentList(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(...process.argv[index + 1].split(","));
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--as-of must use YYYY-MM-DD.");
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) throw new Error("--as-of is not a valid date.");
  return value;
}

function text(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function dateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function queryBatches(values, execute) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += SOURCE_BATCH_SIZE) {
    result.push(...(await execute(values.slice(offset, offset + SOURCE_BATCH_SIZE))));
  }
  return result;
}

function bindTextList(request, values, prefix) {
  return values.map((value, index) => {
    const name = prefix + index;
    request.input(name, mssql.NVarChar(80), value);
    return "@" + name;
  });
}

function bindIntList(request, values, prefix) {
  return values.map((value, index) => {
    const name = prefix + index;
    request.input(name, mssql.Int, Number(value));
    return "@" + name;
  });
}

function itemFromRow(row, prefix, partIdColumn, codeColumn) {
  return {
    partId: String(row[partIdColumn]),
    code: text(row[codeColumn]),
    name: text(row[prefix + "Name"], text(row[codeColumn])),
    specification: text(row[prefix + "Spec"]),
    unitCode: text(row[prefix + "UnitCode"]),
    unitName: text(row[prefix + "UnitName"], "EA"),
    classCode: text(row[prefix + "ClassCode"]),
    className: text(row[prefix + "ClassName"]),
    unitWeight: row[prefix + "Weight"] === null || row[prefix + "Weight"] === undefined ? null : String(row[prefix + "Weight"]),
    engineerFigureNo: text(row[prefix + "EngineerFigureNo"]),
    isManufactured: row[prefix + "IsManufactured"] === true,
    isPurchased: row[prefix + "IsPurchased"] === true
  };
}

function addItem(itemsByPartId, item) {
  if (!item.code) throw new Error("U8 PartId " + item.partId + " has no inventory code.");
  const existing = itemsByPartId.get(item.partId);
  if (existing && existing.code !== item.code) {
    throw new Error("U8 PartId " + item.partId + " maps to multiple inventory codes.");
  }
  itemsByPartId.set(item.partId, existing ?? item);
}

function normalizedBom(row) {
  return {
    bomId: String(row.BomId),
    parentPartId: String(row.ParentId),
    parentCode: text(row.ParentCode),
    version: row.Version === null || row.Version === undefined ? null : String(row.Version),
    versionDescription: text(row.VersionDesc),
    effectiveFrom: dateValue(row.VersionEffDate),
    effectiveTo: dateValue(row.VersionEndDate),
    status: Number(row.Status)
  };
}

function normalizedEdge(row) {
  return {
    bomId: String(row.BomId),
    bomVersion: row.Version === null || row.Version === undefined ? null : String(row.Version),
    opComponentId: String(row.OpComponentId),
    parentPartId: String(row.ParentId),
    parentCode: text(row.ParentCode),
    childPartId: String(row.ChildPartId),
    childCode: text(row.ChildCode),
    sortSeq: Number(row.SortSeq),
    opSeq: text(row.OpSeq),
    baseQtyN: text(row.BaseQtyN),
    baseQtyD: text(row.BaseQtyD),
    componentScrap: text(row.CompScrap, "0"),
    parentScrap: text(row.ParentScrap, "0"),
    remark: text(row.Remark),
    effectiveFrom: dateValue(row.EffBegDate),
    effectiveTo: dateValue(row.EffEndDate)
  };
}

async function loadRoots(pool, codes) {
  const uniqueCodes = [...new Set(codes.map(String))];
  const rows = await queryBatches(uniqueCodes, async (batch) => {
    const request = pool.request();
    const parameters = bindTextList(request, batch, "code");
    const result = await request.query([
      "SELECT p.PartId, p.InvCode, p.LLC, p.cBasEngineerFigNo AS RootEngineerFigureNo,",
      "i.cInvName AS RootName, i.cInvStd AS RootSpec, i.cComUnitCode AS RootUnitCode,",
      "cu.cComUnitName AS RootUnitName, i.cInvCCode AS RootClassCode, ic.cInvCName AS RootClassName,",
      "i.iInvWeight AS RootWeight, i.bSelf AS RootIsManufactured, i.bPurchase AS RootIsPurchased",
      "FROM dbo.bas_part p",
      "LEFT JOIN dbo.Inventory i ON i.cInvCode = p.InvCode",
      "LEFT JOIN dbo.InventoryClass ic ON ic.cInvCCode = i.cInvCCode",
      "LEFT JOIN dbo.ComputationUnit cu ON cu.cComunitCode = i.cComUnitCode",
      "WHERE p.InvCode IN (" + parameters.join(",") + ")",
      "ORDER BY p.InvCode, p.PartId"
    ].join(" "));
    return result.recordset;
  });

  const byCode = new Map();
  for (const row of rows) {
    const code = text(row.InvCode);
    const values = byCode.get(code) ?? [];
    values.push(row);
    byCode.set(code, values);
  }
  const missing = uniqueCodes.filter((code) => !byCode.has(code));
  if (missing.length > 0) throw new Error("U8 root item code(s) not found: " + missing.join(", "));
  const duplicates = [...byCode.entries()].filter(([, values]) => values.length > 1);
  if (duplicates.length > 0) {
    throw new Error("U8 root item code(s) map to multiple bas_part rows: " + duplicates.map(([code]) => code).join(", "));
  }
  return uniqueCodes.map((code) => byCode.get(code)[0]);
}

async function loadPreferredBoms(pool, partIds, asOfDate) {
  const unique = [...new Set(partIds.map(String))];
  if (unique.length === 0) return [];
  return queryBatches(unique, async (batch) => {
    const request = pool.request();
    request.input("asOfDate", mssql.Date, asOfDate);
    const parameters = bindIntList(request, batch, "part");
    const result = await request.query([
      "WITH ranked AS (",
      "SELECT bp.ParentId, p.InvCode AS ParentCode, b.BomId, b.Version, b.VersionDesc, b.VersionEffDate, b.VersionEndDate, b.Status,",
      "ROW_NUMBER() OVER (PARTITION BY bp.ParentId ORDER BY COALESCE(b.VersionEffDate, '19000101') DESC, COALESCE(b.Version, 0) DESC, b.BomId DESC) AS rn",
      "FROM dbo.bom_parent bp",
      "JOIN dbo.bom_bom b ON b.BomId = bp.BomId",
      "JOIN dbo.bas_part p ON p.PartId = bp.ParentId",
      "WHERE b.Status = 3",
      "AND (b.VersionEffDate IS NULL OR CAST(b.VersionEffDate AS date) <= @asOfDate)",
      "AND (b.VersionEndDate IS NULL OR CAST(b.VersionEndDate AS date) >= @asOfDate)",
      "AND bp.ParentId IN (" + parameters.join(",") + ")",
      ") SELECT * FROM ranked WHERE rn = 1"
    ].join(" "));
    return result.recordset;
  });
}

async function loadBomEdges(pool, bomIds, asOfDate) {
  const unique = [...new Set(bomIds.map(String))];
  if (unique.length === 0) return [];
  return queryBatches(unique, async (batch) => {
    const request = pool.request();
    request.input("asOfDate", mssql.Date, asOfDate);
    const parameters = bindIntList(request, batch, "bom");
    const result = await request.query([
      "SELECT b.BomId, b.Version, b.VersionDesc, b.VersionEffDate, b.VersionEndDate, b.Status,",
      "bp.ParentId, p1.InvCode AS ParentCode,",
      "i1.cInvName AS ParentName, i1.cInvStd AS ParentSpec, i1.cComUnitCode AS ParentUnitCode,",
      "cu1.cComUnitName AS ParentUnitName, i1.cInvCCode AS ParentClassCode, ic1.cInvCName AS ParentClassName,",
      "i1.iInvWeight AS ParentWeight, p1.cBasEngineerFigNo AS ParentEngineerFigureNo,",
      "i1.bSelf AS ParentIsManufactured, i1.bPurchase AS ParentIsPurchased,",
      "op.OpComponentId, op.SortSeq, op.OpSeq, op.ComponentId AS ChildPartId,",
      "p2.InvCode AS ChildCode, i2.cInvName AS ChildName, i2.cInvStd AS ChildSpec,",
      "i2.cComUnitCode AS ChildUnitCode, cu2.cComUnitName AS ChildUnitName,",
      "i2.cInvCCode AS ChildClassCode, ic2.cInvCName AS ChildClassName, i2.iInvWeight AS ChildWeight,",
      "p2.cBasEngineerFigNo AS ChildEngineerFigureNo, i2.bSelf AS ChildIsManufactured, i2.bPurchase AS ChildIsPurchased,",
      "CONVERT(varchar(80), op.BaseQtyN) AS BaseQtyN, CONVERT(varchar(80), op.BaseQtyD) AS BaseQtyD,",
      "CONVERT(varchar(80), op.CompScrap) AS CompScrap, CONVERT(varchar(80), bp.ParentScrap) AS ParentScrap,",
      "op.Remark, op.EffBegDate, op.EffEndDate",
      "FROM dbo.bom_bom b",
      "JOIN dbo.bom_parent bp ON bp.BomId = b.BomId",
      "JOIN dbo.bas_part p1 ON p1.PartId = bp.ParentId",
      "JOIN dbo.bom_opcomponent op ON op.BomId = b.BomId",
      "JOIN dbo.bas_part p2 ON p2.PartId = op.ComponentId",
      "LEFT JOIN dbo.Inventory i1 ON i1.cInvCode = p1.InvCode",
      "LEFT JOIN dbo.Inventory i2 ON i2.cInvCode = p2.InvCode",
      "LEFT JOIN dbo.InventoryClass ic1 ON ic1.cInvCCode = i1.cInvCCode",
      "LEFT JOIN dbo.InventoryClass ic2 ON ic2.cInvCCode = i2.cInvCCode",
      "LEFT JOIN dbo.ComputationUnit cu1 ON cu1.cComunitCode = i1.cComUnitCode",
      "LEFT JOIN dbo.ComputationUnit cu2 ON cu2.cComunitCode = i2.cComUnitCode",
      "WHERE b.BomId IN (" + parameters.join(",") + ")",
      "AND (op.EffBegDate IS NULL OR CAST(op.EffBegDate AS date) <= @asOfDate)",
      "AND (op.EffEndDate IS NULL OR CAST(op.EffEndDate AS date) >= @asOfDate)",
      "ORDER BY b.BomId, op.SortSeq, op.OpComponentId"
    ].join(" "));
    return result.recordset;
  });
}

function flattenRoot(treeRoot, graph) {
  const rows = [];
  function visit(nodes) {
    nodes.forEach((node, index) => {
      const item = graph.itemsByPartId.get(node.childPartId);
      const edge = graph.edgeById.get(node.opComponentId);
      const childBomId = graph.childBomByPartId.get(node.childPartId) ?? null;
      rows.push({
        ...node,
        siblingSeq: index + 1,
        hasChildBom: childBomId !== null && childBomId !== undefined,
        childBomId,
        item,
        edge: edge
          ? {
              bomId: edge.bomId,
              opComponentId: edge.opComponentId,
              opSeq: edge.opSeq,
              sortSeq: edge.sortSeq,
              remark: edge.remark,
              componentScrap: edge.componentScrap,
              parentScrap: edge.parentScrap
            }
          : null
      });
      visit(node.children || []);
    });
  }
  visit(treeRoot.children || []);
  return rows;
}

async function loadGraph(pool, rootCodes, asOfDate, maxDepth) {
  const rootRows = await loadRoots(pool, rootCodes);
  const rootPartIds = rootRows.map((row) => String(row.PartId));
  const preferredRootRows = await loadPreferredBoms(pool, rootPartIds, asOfDate);
  const preferredByPartId = new Map(preferredRootRows.map((row) => [String(row.ParentId), normalizedBom(row)]));

  const itemsByPartId = new Map();
  for (const row of rootRows) addItem(itemsByPartId, itemFromRow(row, "Root", "PartId", "InvCode"));

  const rootSelections = rootRows.map((row) => {
    const rootItem = itemsByPartId.get(String(row.PartId));
    const bom = preferredByPartId.get(String(row.PartId));
    if (!bom) throw new Error("No approved/effective BOM is available for root " + rootItem.code + ".");
    return { rootPartId: rootItem.partId, rootCode: rootItem.code, rootBomId: bom.bomId, selection: "preferred-approved-effective", sourceJobIds: [] };
  });

  const bomById = new Map(preferredRootRows.map((row) => [String(row.BomId), normalizedBom(row)]));
  const childBomByPartId = new Map(rootSelections.map((selection) => [selection.rootPartId, selection.rootBomId]));
  const edgesByBomId = new Map();
  const edgeById = new Map();
  const queue = rootSelections.map((selection) => selection.rootBomId);
  const processed = new Set();

  while (queue.length > 0) {
    const batch = queue.splice(0, SOURCE_BATCH_SIZE).filter((bomId) => !processed.has(String(bomId)));
    if (batch.length === 0) continue;
    for (const bomId of batch) {
      processed.add(String(bomId));
      edgesByBomId.set(String(bomId), []);
    }

    const edgeRows = await loadBomEdges(pool, batch, asOfDate);
    for (const row of edgeRows) {
      const edge = normalizedEdge(row);
      edgesByBomId.get(edge.bomId).push(edge);
      edgeById.set(edge.opComponentId, edge);
      bomById.set(edge.bomId, normalizedBom(row));
      addItem(itemsByPartId, itemFromRow(row, "Parent", "ParentId", "ParentCode"));
      addItem(itemsByPartId, itemFromRow(row, "Child", "ChildPartId", "ChildCode"));
    }

    const unresolvedPartIds = [...new Set(edgeRows.map((row) => String(row.ChildPartId)))].filter((partId) => !childBomByPartId.has(partId));
    const preferredRows = await loadPreferredBoms(pool, unresolvedPartIds, asOfDate);
    const preferred = new Map(preferredRows.map((row) => [String(row.ParentId), normalizedBom(row)]));
    for (const partId of unresolvedPartIds) {
      const bom = preferred.get(partId);
      childBomByPartId.set(partId, bom ? bom.bomId : null);
      if (bom) {
        bomById.set(bom.bomId, bom);
        if (!processed.has(bom.bomId)) queue.push(bom.bomId);
      }
    }
  }

  const tree = buildBomTree({ roots: rootSelections, edgesByBomId, childBomByPartId, maxDepth });
  const graph = { itemsByPartId, bomById, edgesByBomId, edgeById, childBomByPartId };
  const roots = tree.roots.map((treeRoot) => {
    const root = itemsByPartId.get(treeRoot.rootPartId);
    return {
      root,
      selectedBom: bomById.get(treeRoot.rootBomId),
      rows: flattenRoot(treeRoot, graph)
    };
  }).sort((left, right) => compareText(left.root.code, right.root.code));

  return {
    roots,
    graphSummary: {
      roots: roots.length,
      boms: bomById.size,
      parts: itemsByPartId.size,
      branchRows: roots.reduce((total, root) => total + root.rows.length, 0),
      maxDepth: roots.reduce((maximum, root) => Math.max(maximum, ...root.rows.map((row) => row.level), 0), 0)
    },
    sourceSignature: sha256({
      roots: roots.map((root) => ({ code: root.root.code, bomId: root.selectedBom.bomId, rows: root.rows.length })),
      boms: [...bomById.values()].sort((a, b) => compareText(a.bomId, b.bomId)),
      edges: [...edgeById.values()].sort((a, b) => compareText(a.opComponentId, b.opComponentId))
    })
  };
}

async function main() {
  const env = { ...loadEnv(path.join(CARBON_ROOT, ".env.u8.local")), ...process.env };
  for (const key of ["U8_SERVER", "U8_DATABASE", "U8_USER", "U8_PASSWORD"]) {
    if (!env[key]) throw new Error(key + " is not configured.");
  }
  const rootCodes = argumentList("--root-code");
  if (rootCodes.length === 0) rootCodes.push("13110202010100");
  const asOfDate = validateDate(argument("--as-of") || localDate());
  const maxDepth = Number(argument("--max-depth") || 50);
  if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new Error("--max-depth must be a positive integer.");

  const outputPath = path.resolve(CARBON_ROOT, argument("--output") || path.join(".codex", "work", "u8-bom-template-export.json"));
  const config = {
    server: env.U8_SERVER,
    database: env.U8_DATABASE,
    user: env.U8_USER,
    password: env.U8_PASSWORD,
    port: Number(env.U8_PORT || 1433),
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000,
    requestTimeout: 300000
  };

  const pool = await new mssql.ConnectionPool(config).connect();
  try {
    const graph = await loadGraph(pool, rootCodes, asOfDate, maxDepth);
    const output = {
      generatedAt: new Date().toISOString(),
      readOnlyBoundary: "SELECT-only U8 BOM export; no U8 or Carbon database writes.",
      asOfDate,
      rootCodes,
      source: { database: env.U8_DATABASE },
      ...graph
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({
      outputPath,
      readOnlyBoundary: output.readOnlyBoundary,
      asOfDate,
      summary: output.graphSummary,
      roots: output.roots.map((root) => ({
        code: root.root.code,
        name: root.root.name,
        bomId: root.selectedBom.bomId,
        version: root.selectedBom.version,
        rows: root.rows.length,
        maxLevel: root.rows.reduce((maximum, row) => Math.max(maximum, row.level), 0)
      }))
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
