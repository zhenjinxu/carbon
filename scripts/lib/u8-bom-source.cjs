"use strict";

const crypto = require("crypto");
const mssql = require("mssql");
const { buildBomTree, selectRootBoms } = require("./u8-bom-tree.cjs");

const SOURCE_BATCH_SIZE = 500;

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
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function queryBatches(values, execute) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += SOURCE_BATCH_SIZE) {
    result.push(...(await execute(values.slice(offset, offset + SOURCE_BATCH_SIZE))));
  }
  return result;
}

function bindIntList(request, values, prefix) {
  return values.map((value, index) => {
    const name = prefix + index;
    request.input(name, mssql.Int, Number(value));
    return "@" + name;
  });
}

async function loadPreferredBoms(pool, partIds, asOfDate) {
  const unique = [...new Set(partIds.map(String))];
  if (unique.length === 0) return [];
  return queryBatches(unique, async (batch) => {
    const request = pool.request();
    request.input("asOfDate", mssql.Date, asOfDate);
    const parameters = bindIntList(request, batch, "part");
    const result = await request.query(
      [
        "WITH ranked AS (",
        "SELECT bp.ParentId, p.InvCode AS ParentCode, b.BomId, b.Version,",
        "b.VersionDesc, b.VersionEffDate, b.VersionEndDate, b.Status,",
        "ROW_NUMBER() OVER (PARTITION BY bp.ParentId ORDER BY",
        "COALESCE(b.VersionEffDate, '19000101') DESC,",
        "COALESCE(b.Version, 0) DESC, b.BomId DESC) AS rn",
        "FROM dbo.bom_parent bp",
        "JOIN dbo.bom_bom b ON b.BomId = bp.BomId",
        "JOIN dbo.bas_part p ON p.PartId = bp.ParentId",
        "WHERE b.Status = 3",
        "AND (b.VersionEffDate IS NULL OR CAST(b.VersionEffDate AS date) <= @asOfDate)",
        "AND (b.VersionEndDate IS NULL OR CAST(b.VersionEndDate AS date) >= @asOfDate)",
        "AND bp.ParentId IN (" + parameters.join(",") + ")",
        ") SELECT * FROM ranked WHERE rn = 1"
      ].join(" ")
    );
    return result.recordset;
  });
}

async function loadOrderDetails(pool, productionOrders) {
  const orderByMoDId = new Map(
    productionOrders.map((order) => [String(order.sourceMoDId), order])
  );
  const sourceMoDIds = [...orderByMoDId.keys()];
  const rows = await queryBatches(sourceMoDIds, async (batch) => {
    const request = pool.request();
    const parameters = bindIntList(request, batch, "order");
    const result = await request.query(
      [
        "SELECT m.MoDId, m.PartId AS RootPartId, m.InvCode AS RootCode,",
        "m.BomId AS AssignedBomId, b.Status AS AssignedBomStatus,",
        "b.Version AS AssignedBomVersion, b.VersionDesc AS AssignedBomVersionDesc,",
        "b.VersionEffDate AS AssignedBomEffDate, b.VersionEndDate AS AssignedBomEndDate,",
        "i.cInvName AS RootName, i.cInvStd AS RootSpec,",
        "i.cComUnitCode AS RootUnitCode, cu.cComUnitName AS RootUnitName,",
        "i.bSelf AS RootIsManufactured, i.bPurchase AS RootIsPurchased,",
        "p.Free1, p.Free2, p.Free3, p.Free4, p.Free5,",
        "p.Free6, p.Free7, p.Free8, p.Free9, p.Free10",
        "FROM dbo.mom_orderdetail m",
        "LEFT JOIN dbo.bom_bom b ON b.BomId = m.BomId",
        "JOIN dbo.bas_part p ON p.PartId = m.PartId",
        "LEFT JOIN dbo.Inventory i ON i.cInvCode = m.InvCode",
        "LEFT JOIN dbo.ComputationUnit cu ON cu.cComunitCode = i.cComUnitCode",
        "WHERE m.MoDId IN (" + parameters.join(",") + ")"
      ].join(" ")
    );
    return result.recordset;
  });

  if (rows.length !== productionOrders.length) {
    const found = new Set(rows.map((row) => String(row.MoDId)));
    const missing = sourceMoDIds.filter((id) => !found.has(id));
    throw new Error(
      "U8 production orders are missing for MoDId: " + missing.join(", ")
    );
  }

  return rows.map((row) => ({
    ...row,
    sourceJobId: orderByMoDId.get(String(row.MoDId)).sourceJobId,
    rootItemId: orderByMoDId.get(String(row.MoDId)).rootItemId,
    sourceMoDId: String(row.MoDId),
    rootPartId: String(row.RootPartId),
    rootCode: text(row.RootCode)
  }));
}

async function loadBomEdges(pool, bomIds, asOfDate) {
  const unique = [...new Set(bomIds.map(String))];
  if (unique.length === 0) return [];
  return queryBatches(unique, async (batch) => {
    const request = pool.request();
    request.input("asOfDate", mssql.Date, asOfDate);
    const parameters = bindIntList(request, batch, "bom");
    const result = await request.query(
      [
        "SELECT b.BomId, b.Version, b.VersionDesc, b.VersionEffDate,",
        "b.VersionEndDate, b.Status, bp.ParentId, p1.InvCode AS ParentCode,",
        "i1.cInvName AS ParentName, i1.cInvStd AS ParentSpec,",
        "i1.cComUnitCode AS ParentUnitCode, cu1.cComUnitName AS ParentUnitName,",
        "i1.bSelf AS ParentIsManufactured, i1.bPurchase AS ParentIsPurchased,",
        "op.OpComponentId, op.SortSeq, op.OpSeq, op.ComponentId AS ChildPartId,",
        "p2.InvCode AS ChildCode, i2.cInvName AS ChildName,",
        "i2.cInvStd AS ChildSpec, i2.cComUnitCode AS ChildUnitCode,",
        "cu2.cComUnitName AS ChildUnitName,",
        "i2.bSelf AS ChildIsManufactured, i2.bPurchase AS ChildIsPurchased,",
        "CONVERT(varchar(80), op.BaseQtyN) AS BaseQtyN,",
        "CONVERT(varchar(80), op.BaseQtyD) AS BaseQtyD,",
        "CONVERT(varchar(80), op.CompScrap) AS CompScrap,",
        "CONVERT(varchar(80), bp.ParentScrap) AS ParentScrap,",
        "op.EffBegDate, op.EffEndDate",
        "FROM dbo.bom_bom b",
        "JOIN dbo.bom_parent bp ON bp.BomId = b.BomId",
        "JOIN dbo.bas_part p1 ON p1.PartId = bp.ParentId",
        "JOIN dbo.bom_opcomponent op ON op.BomId = b.BomId",
        "JOIN dbo.bas_part p2 ON p2.PartId = op.ComponentId",
        "LEFT JOIN dbo.Inventory i1 ON i1.cInvCode = p1.InvCode",
        "LEFT JOIN dbo.Inventory i2 ON i2.cInvCode = p2.InvCode",
        "LEFT JOIN dbo.ComputationUnit cu1 ON cu1.cComunitCode = i1.cComUnitCode",
        "LEFT JOIN dbo.ComputationUnit cu2 ON cu2.cComunitCode = i2.cComUnitCode",
        "WHERE b.BomId IN (" + parameters.join(",") + ")",
        "AND (op.EffBegDate IS NULL OR CAST(op.EffBegDate AS date) <= @asOfDate)",
        "AND (op.EffEndDate IS NULL OR CAST(op.EffEndDate AS date) >= @asOfDate)",
        "ORDER BY b.BomId, op.SortSeq, op.OpComponentId"
      ].join(" ")
    );
    return result.recordset;
  });
}

function itemFromOrder(row) {
  return {
    partId: String(row.RootPartId),
    code: text(row.RootCode),
    name: text(row.RootName, text(row.RootCode)),
    specification: text(row.RootSpec),
    unitCode: text(row.RootUnitCode),
    unitName: text(row.RootUnitName, "件"),
    isManufactured: row.RootIsManufactured === true,
    isPurchased: row.RootIsPurchased === true,
    freeValues: [
      row.Free1,
      row.Free2,
      row.Free3,
      row.Free4,
      row.Free5,
      row.Free6,
      row.Free7,
      row.Free8,
      row.Free9,
      row.Free10
    ].map((value) => text(value, ""))
  };
}

function itemFromEdge(row, side) {
  const prefix = side === "parent" ? "Parent" : "Child";
  const partIdColumn = side === "parent" ? "ParentId" : "ChildPartId";
  return {
    partId: String(row[partIdColumn]),
    code: text(row[prefix + "Code"]),
    name: text(row[prefix + "Name"], text(row[prefix + "Code"])),
    specification: text(row[prefix + "Spec"]),
    unitCode: text(row[prefix + "UnitCode"]),
    unitName: text(row[prefix + "UnitName"], "件"),
    isManufactured: row[prefix + "IsManufactured"] === true,
    isPurchased: row[prefix + "IsPurchased"] === true,
    freeValues: []
  };
}

function addItem(itemsByPartId, item) {
  if (!item.code) {
    throw new Error("U8 PartId " + item.partId + " has no inventory code.");
  }
  const existing = itemsByPartId.get(item.partId);
  if (existing && existing.code !== item.code) {
    throw new Error(
      "U8 PartId " + item.partId + " maps to multiple item codes."
    );
  }
  itemsByPartId.set(item.partId, existing ?? item);
}

function normalizedEdge(row) {
  return {
    bomId: String(row.BomId),
    bomVersion: row.Version === null ? null : String(row.Version),
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
    effectiveFrom: dateValue(row.EffBegDate),
    effectiveTo: dateValue(row.EffEndDate)
  };
}

function normalizedBom(row) {
  return {
    bomId: String(row.BomId),
    parentPartId: String(row.ParentId),
    parentCode: text(row.ParentCode),
    version: row.Version === null ? null : String(row.Version),
    versionDescription: text(row.VersionDesc),
    effectiveFrom: dateValue(row.VersionEffDate),
    effectiveTo: dateValue(row.VersionEndDate),
    status: Number(row.Status)
  };
}
function indexPreferredBoms(rows) {
  return new Map(
    rows.map((row) => {
      const bom = normalizedBom(row);
      return [bom.parentPartId, bom];
    })
  );

}
function makeSourceSignature({ roots, bomById, edgesByBomId, itemsByPartId, childBomByPartId }) {
  const boms = [...bomById.values()].sort((a, b) =>
    compareText(a.bomId, b.bomId)
  );
  const edges = [...edgesByBomId.values()]
    .flat()
    .sort((a, b) => compareText(a.opComponentId, b.opComponentId));
  const items = [...itemsByPartId.values()].sort((a, b) =>
    compareText(a.partId, b.partId)
  );
  const selections = [...childBomByPartId.entries()]
    .map(([partId, bomId]) => ({ partId, bomId }))
    .sort((a, b) => compareText(a.partId, b.partId));
  return hash({ roots, boms, edges, items, selections });
}

async function loadU8BomGraph({ pool, productionOrders, asOfDate, maxDepth = 50 }) {
  const orderRows = await loadOrderDetails(pool, productionOrders);
  const rootPartIds = [...new Set(orderRows.map((row) => String(row.RootPartId)))];
  const preferredRootRows = await loadPreferredBoms(pool, rootPartIds, asOfDate);
  const preferredByPartId = indexPreferredBoms(preferredRootRows);

  const rootSelections = selectRootBoms({
    orders: orderRows.map((row) => ({
      sourceJobId: row.sourceJobId,
      sourceMoDId: row.sourceMoDId,
      rootPartId: row.rootPartId,
      rootCode: row.rootCode,
      assignedBomId: row.AssignedBomId,
      assignedBomStatus: row.AssignedBomStatus
    })),
    fallbackBomByPartId: preferredByPartId
  });

  const itemsByPartId = new Map();
  for (const row of orderRows) addItem(itemsByPartId, itemFromOrder(row));

  const bomById = new Map();
  for (const row of orderRows) {
    if (Number(row.AssignedBomStatus) === 3) {
      bomById.set(String(row.AssignedBomId), {
        bomId: String(row.AssignedBomId),
        parentPartId: String(row.RootPartId),
        parentCode: text(row.RootCode),
        version: row.AssignedBomVersion === null ? null : String(row.AssignedBomVersion),
        versionDescription: text(row.AssignedBomVersionDesc),
        effectiveFrom: dateValue(row.AssignedBomEffDate),
        effectiveTo: dateValue(row.AssignedBomEndDate),
        status: Number(row.AssignedBomStatus)
      });
    }
  }
  for (const row of preferredRootRows) {
    bomById.set(String(row.BomId), normalizedBom(row));
  }

  const childBomByPartId = new Map(
    rootPartIds.map((partId) => [
      partId,
      preferredByPartId.get(partId)
        ? preferredByPartId.get(partId).bomId
        : rootSelections.find((root) => root.rootPartId === partId)?.rootBomId ?? null
    ])
  );
  const queue = [
    ...new Set([
      ...rootSelections.map((root) => root.rootBomId),
      ...[...childBomByPartId.values()].filter(Boolean)
    ])
  ];
  const processed = new Set();
  const edgesByBomId = new Map();

  while (queue.length > 0) {
    const batch = queue.splice(0, SOURCE_BATCH_SIZE).filter(
      (bomId) => !processed.has(String(bomId))
    );
    if (batch.length === 0) continue;
    for (const bomId of batch) {
      processed.add(String(bomId));
      edgesByBomId.set(String(bomId), []);
    }

    const rows = await loadBomEdges(pool, batch, asOfDate);
    for (const row of rows) {
      const bomId = String(row.BomId);
      const edges = edgesByBomId.get(bomId);
      edges.push(normalizedEdge(row));
      bomById.set(bomId, normalizedBom(row));
      addItem(itemsByPartId, itemFromEdge(row, "parent"));
      addItem(itemsByPartId, itemFromEdge(row, "child"));
    }

    const unresolvedPartIds = [
      ...new Set(rows.map((row) => String(row.ChildPartId)))
    ].filter((partId) => !childBomByPartId.has(partId));
    const preferredRows = await loadPreferredBoms(
      pool,
      unresolvedPartIds,
      asOfDate
    );
    const preferred = new Map(
      preferredRows.map((row) => [String(row.ParentId), row])
    );
    for (const partId of unresolvedPartIds) {
      const row = preferred.get(partId);
      const bomId = row ? String(row.BomId) : null;
      childBomByPartId.set(partId, bomId);
      if (row) {
        bomById.set(bomId, normalizedBom(row));
        if (!processed.has(bomId)) queue.push(bomId);
      }
    }
  }

  const codeToPartIds = new Map();
  for (const item of itemsByPartId.values()) {
    const ids = codeToPartIds.get(item.code) ?? new Set();
    ids.add(item.partId);
    codeToPartIds.set(item.code, ids);
  }
  const ambiguous = [...codeToPartIds.entries()].filter(
    ([, partIds]) => partIds.size > 1
  );
  if (ambiguous.length > 0) {
    throw new Error(
      "U8 BOM contains item codes mapped to multiple PartIds: " +
        ambiguous
          .slice(0, 20)
          .map(([code, ids]) => code + "=[" + [...ids].join(",") + "]")
          .join("; ")
    );
  }

  const tree = buildBomTree({
    roots: rootSelections,
    edgesByBomId,
    childBomByPartId,
    maxDepth
  });
  const sourceSignature = makeSourceSignature({
    roots: rootSelections,
    bomById,
    edgesByBomId,
    itemsByPartId,
    childBomByPartId
  });

  return {
    asOfDate,
    roots: rootSelections,
    tree,
    bomById,
    edgesByBomId,
    itemsByPartId,
    childBomByPartId,
    sourceSignature,
    summary: {
      jobs: productionOrders.length,
      roots: rootSelections.length,
      fallbackRoots: rootSelections.filter(
        (root) => root.selection !== "assigned"
      ).length,
      boms: bomById.size,
      directEdges: [...edgesByBomId.values()].reduce(
        (total, edges) => total + edges.length,
        0
      ),
      parts: itemsByPartId.size,
      branchRows: tree.rows.length,
      maxDepth: tree.rows.reduce(
        (maximum, row) => Math.max(maximum, row.level),
        0
      )
    }
  };
}

module.exports = {
  indexPreferredBoms,
  itemFromEdge,
  loadU8BomGraph,
  makeSourceSignature
};

