"use strict";

const Decimal = require("decimal.js");

function asKey(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(label + " is required.");
  }
  return String(value);
}

function asDecimal(value, label) {
  let result;
  try {
    result = new Decimal(value);
  } catch {
    throw new Error(label + " must be a valid decimal.");
  }
  if (!result.isFinite()) {
    throw new Error(label + " must be finite.");
  }
  return result;
}

function decimalString(value) {
  return value.toSignificantDigits(28).toString();
}

function getCollection(collection, key) {
  if (collection instanceof Map) return collection.get(key);
  return collection[key];
}

function hasCollectionKey(collection, key) {
  if (collection instanceof Map) return collection.has(key);
  return Object.prototype.hasOwnProperty.call(collection, key);
}

function compareEdges(left, right) {
  const leftOrder = Number(left.sortSeq);
  const rightOrder = Number(right.sortSeq);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left.opComponentId).localeCompare(String(right.opComponentId));
}

function validateEdge(edge, bomId, expectedParentPartId) {
  const edgeBomId = asKey(edge.bomId, "BOM edge bomId");
  const opComponentId = asKey(
    edge.opComponentId,
    "BOM edge OpComponentId"
  );
  const parentPartId = asKey(edge.parentPartId, "BOM edge parentPartId");
  const parentCode = asKey(edge.parentCode, "BOM edge parentCode");
  const childPartId = asKey(edge.childPartId, "BOM edge childPartId");
  const childCode = asKey(edge.childCode, "BOM edge childCode");

  if (edgeBomId !== bomId) {
    throw new Error(
      "BOM edge " + opComponentId + " belongs to " + edgeBomId +
        ", not " + bomId + "."
    );
  }
  if (parentPartId !== expectedParentPartId) {
    throw new Error(
      "BOM edge " + opComponentId + " parent " + parentPartId +
        " does not match expected parent " + expectedParentPartId + "."
    );
  }

  const numerator = asDecimal(
    edge.baseQtyN,
    "BOM edge " + opComponentId + " BaseQtyN"
  );
  const denominator = asDecimal(
    edge.baseQtyD,
    "BOM edge " + opComponentId + " BaseQtyD"
  );
  if (denominator.isZero()) {
    throw new Error(
      "BOM edge " + opComponentId + " BaseQtyD cannot be zero."
    );
  }
  const directQuantity = numerator.dividedBy(denominator);
  if (directQuantity.isNegative()) {
    throw new Error(
      "BOM edge " + opComponentId + " quantity cannot be negative."
    );
  }

  return {
    ...edge,
    bomId: edgeBomId,
    opComponentId,
    parentPartId,
    parentCode,
    childPartId,
    childCode,
    directQuantity
  };
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function selectRootBoms({ orders, fallbackBomByPartId }) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error("At least one current production order is required.");
  }

  const grouped = new Map();
  for (const order of orders) {
    const sourceJobId = asKey(order.sourceJobId, "Production order job ID");
    const sourceMoDId = asKey(order.sourceMoDId, "Production order MoDId");
    const rootPartId = asKey(order.rootPartId, "Production order PartId");
    const rootCode = asKey(order.rootCode, "Production order item code");
    const assignedBomId =
      order.assignedBomId === null || order.assignedBomId === undefined
        ? null
        : String(order.assignedBomId);
    const useAssigned =
      assignedBomId !== null && Number(order.assignedBomStatus) === 3;

    const fallback = getCollection(fallbackBomByPartId, rootPartId);
    const fallbackBomId =
      fallback && typeof fallback === "object"
        ? fallback.bomId
        : fallback;
    const rootBomId = useAssigned
      ? assignedBomId
      : fallbackBomId === null || fallbackBomId === undefined
        ? null
        : String(fallbackBomId);
    const selection = useAssigned ? "assigned" : "fallback";

    if (!rootBomId) {
      throw new Error(
        "No approved BOM is available for production root " +
          rootCode + " (PartId " + rootPartId + ")."
      );
    }

    const key = rootPartId + "\u0000" + rootBomId;
    let root = grouped.get(key);
    if (!root) {
      root = {
        rootPartId,
        rootCode,
        rootBomId,
        selection,
        sourceJobIds: [],
        sourceMoDIds: [],
        assignedBomIds: []
      };
      grouped.set(key, root);
    } else if (root.selection !== selection) {
      root.selection = "mixed";
    }

    root.sourceJobIds.push(sourceJobId);
    root.sourceMoDIds.push(sourceMoDId);
    if (assignedBomId) root.assignedBomIds.push(assignedBomId);
  }

  return [...grouped.values()]
    .map((root) => ({
      ...root,
      sourceJobIds: [...new Set(root.sourceJobIds)].sort(compareText),
      sourceMoDIds: [...new Set(root.sourceMoDIds)].sort(compareText),
      assignedBomIds: [...new Set(root.assignedBomIds)].sort(compareText)
    }))
    .sort(
      (left, right) =>
        compareText(left.rootCode, right.rootCode) ||
        compareText(left.rootBomId, right.rootBomId)
    );
}

function buildBomTree({
  roots,
  edgesByBomId,
  childBomByPartId,
  maxDepth = 50
}) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error("At least one BOM root is required.");
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error("Maximum depth must be a positive integer.");
  }

  const rows = [];

  function expand({
    root,
    bomId,
    parentPartId,
    partPath,
    codePath,
    edgePath,
    cumulativeQuantity,
    level
  }) {
    if (level > maxDepth) {
      throw new Error(
        "BOM tree exceeded maximum depth " + maxDepth +
          " at " + codePath.join(" -> ") + "."
      );
    }

    const sourceEdges = getCollection(edgesByBomId, bomId) ?? [];
    if (!Array.isArray(sourceEdges)) {
      throw new Error("BOM " + bomId + " edges must be an array.");
    }

    const children = [];
    for (const rawEdge of [...sourceEdges].sort(compareEdges)) {
      const edge = validateEdge(rawEdge, bomId, parentPartId);
      if (partPath.includes(edge.childPartId)) {
        throw new Error(
          "BOM cycle detected: " +
            [...codePath, edge.childCode].join(" -> ")
        );
      }

      const childPartPath = [...partPath, edge.childPartId];
      const childCodePath = [...codePath, edge.childCode];
      const childEdgePath = [...edgePath, edge.opComponentId];
      const childCumulative = cumulativeQuantity.times(edge.directQuantity);
      const branchKey =
        root.rootBomId + ":" + childEdgePath.join("/");
      const node = {
        rootPartId: root.rootPartId,
        rootCode: root.rootCode,
        rootBomId: root.rootBomId,
        sourceJobIds: [...(root.sourceJobIds ?? [])],
        bomId,
        opComponentId: edge.opComponentId,
        parentPartId: edge.parentPartId,
        parentCode: edge.parentCode,
        childPartId: edge.childPartId,
        childCode: edge.childCode,
        level,
        sortSeq: Number(edge.sortSeq),
        opSeq: edge.opSeq ?? null,
        baseQtyN: String(edge.baseQtyN),
        baseQtyD: String(edge.baseQtyD),
        directQuantity: decimalString(edge.directQuantity),
        cumulativeQuantity: decimalString(childCumulative),
        partPath: childPartPath,
        codePath: childCodePath,
        edgePath: childEdgePath,
        branchKey,
        children: []
      };

      rows.push(node);
      children.push(node);

      if (!hasCollectionKey(childBomByPartId, edge.childPartId)) {
        throw new Error(
          "BOM selection is missing for child PartId " +
            edge.childPartId + "."
        );
      }
      const childBomId = getCollection(
        childBomByPartId,
        edge.childPartId
      );
      if (childBomId !== null && childBomId !== undefined) {
        node.children = expand({
          root,
          bomId: String(childBomId),
          parentPartId: edge.childPartId,
          partPath: childPartPath,
          codePath: childCodePath,
          edgePath: childEdgePath,
          cumulativeQuantity: childCumulative,
          level: level + 1
        });
      }
    }
    return children;
  }

  const rootTrees = roots.map((rawRoot) => {
    const root = {
      ...rawRoot,
      rootPartId: asKey(rawRoot.rootPartId, "BOM root PartId"),
      rootCode: asKey(rawRoot.rootCode, "BOM root code"),
      rootBomId: asKey(rawRoot.rootBomId, "BOM root BomId")
    };
    return {
      ...root,
      sourceJobIds: [...(root.sourceJobIds ?? [])],
      children: expand({
        root,
        bomId: root.rootBomId,
        parentPartId: root.rootPartId,
        partPath: [root.rootPartId],
        codePath: [root.rootCode],
        edgePath: [],
        cumulativeQuantity: new Decimal(1),
        level: 1
      })
    };
  });

  return { roots: rootTrees, rows };
}

module.exports = {
  buildBomTree,
  selectRootBoms
};

