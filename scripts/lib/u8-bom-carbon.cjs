"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");

const TARGET_BATCH_SIZE = 300;
const INTEGRATION = "u8-bom";
const ITEM_UPDATE_WHERE = [
  "item.name IS DISTINCT FROM EXCLUDED.name",
  "item.description IS DISTINCT FROM EXCLUDED.description",
  'item."replenishmentSystem" IS DISTINCT FROM EXCLUDED."replenishmentSystem"',
  'item."defaultMethodType" IS DISTINCT FROM EXCLUDED."defaultMethodType"',
  'item."unitOfMeasureCode" IS DISTINCT FROM EXCLUDED."unitOfMeasureCode"',
  "item.notes IS DISTINCT FROM " +
    "(COALESCE(item.notes, '{}'::jsonb) || EXCLUDED.notes)"
].join(" OR ");


function hash(...parts) {
  return crypto
    .createHash("sha1")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 24);
}

function stableId(prefix, ...parts) {
  return prefix + "_" + hash(...parts);
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function qident(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

async function insertBatch(
  client,
  table,
  columns,
  rows,
  conflict,
  updateExpressions = [],
  updateWhere = ""
) {
  if (rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += TARGET_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + TARGET_BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return "$" + values.length;
      });
      return "(" + placeholders.join(", ") + ")";
    });
    const update =
      updateExpressions.length === 0
        ? " DO NOTHING"
        : " DO UPDATE SET " +
          updateExpressions.join(", ") +
          (updateWhere ? " WHERE " + updateWhere : "");
    const sql =
      "INSERT INTO " + qident(table) +
      " (" + columns.map(qident).join(", ") + ") VALUES " +
      tuples.join(", ") + " ON CONFLICT " + conflict + update;
    await client.query(sql, values);
  }
}

async function ensureItemRelatedRecords(client, itemIds, companyId, userId) {
  if (itemIds.length === 0) {
    return {
      itemCosts: 0,
      itemReplenishments: 0,
      itemUnitSalePrices: 0,
      itemPlanningRows: 0
    };
  }

  const params = [companyId, itemIds, userId];
  const statements = [
    {
      key: "itemCosts",
      sql: [
        'INSERT INTO "itemCost" ("itemId", "costingMethod", "createdBy", "companyId")',
        "SELECT item.id, 'FIFO', $3, $1",
        "FROM item",
        'WHERE item."companyId" = $1 AND item.id = ANY($2::text[])',
        'AND NOT EXISTS (SELECT 1 FROM "itemCost" existing',
        'WHERE existing."itemId" = item.id)'
      ].join(" ")
    },
    {
      key: "itemReplenishments",
      sql: [
        'INSERT INTO "itemReplenishment" ("itemId", "createdBy", "companyId")',
        "SELECT item.id, $3, $1",
        "FROM item",
        'WHERE item."companyId" = $1 AND item.id = ANY($2::text[])',
        'AND NOT EXISTS (SELECT 1 FROM "itemReplenishment" existing',
        'WHERE existing."itemId" = item.id)'
      ].join(" ")
    },
    {
      key: "itemUnitSalePrices",
      sql: [
        'INSERT INTO "itemUnitSalePrice" ("itemId", "currencyCode", "createdBy", "companyId")',
        'SELECT item.id, COALESCE(company."baseCurrencyCode", \'USD\'), $3, $1',
        "FROM item",
        'JOIN company ON company.id = item."companyId"',
        'WHERE item."companyId" = $1 AND item.id = ANY($2::text[])',
        'AND NOT EXISTS (SELECT 1 FROM "itemUnitSalePrice" existing',
        'WHERE existing."itemId" = item.id',
        'AND existing."currencyCode" = COALESCE(company."baseCurrencyCode", \'USD\'))'
      ].join(" ")
    },
    {
      key: "itemPlanningRows",
      sql: [
        'INSERT INTO "itemPlanning" ("itemId", "locationId", "createdBy", "companyId")',
        "SELECT item.id, location.id, $3, $1",
        "FROM item",
        'JOIN location ON location."companyId" = item."companyId"',
        'WHERE item."companyId" = $1 AND item.id = ANY($2::text[])',
        'AND NOT EXISTS (SELECT 1 FROM "itemPlanning" existing',
        'WHERE existing."itemId" = item.id',
        'AND existing."locationId" = location.id)'
      ].join(" ")
    }
  ];

  const inserted = {};
  for (const { key, sql } of statements) {
    const result = await client.query(sql, params);
    inserted[key] = result.rowCount ?? 0;
  }
  return inserted;
}

function unitIdentity(item, companyId) {
  const name = item.unitName || "件";
  const code = "WODI_" + hash(name).slice(0, 10);
  return {
    id: stableId("uom", companyId, code),
    code,
    name
  };
}

function itemPolicy(item, childBomByPartId) {
  const hasBom = Boolean(childBomByPartId.get(item.partId));
  const isManufactured = hasBom || item.isManufactured;
  let replenishmentSystem = "Buy";
  if (isManufactured && item.isPurchased) {
    replenishmentSystem = "Buy and Make";
  } else if (isManufactured) {
    replenishmentSystem = "Make";
  }
  return {
    replenishmentSystem,
    defaultMethodType: isManufactured
      ? "Make to Order"
      : "Pull from Inventory"
  };
}

async function loadCurrentProductionOrders(client, companyId) {
  const result = await client.query(
    [
      'SELECT j.id AS "sourceJobId", j."itemId" AS "rootItemId",',
      'uwo."sourceMoDId"',
      'FROM job j',
      'JOIN "u8WorkOrder" uwo ON uwo."jobId" = j.id',
      'WHERE j."companyId" = $1',
      "AND j.source = 'U8 ERP'",
      "AND j.status IN ('Planned', 'Ready', 'In Progress', 'Paused')",
      'ORDER BY uwo."sourceMoDId", j.id'
    ].join(" "),
    [companyId]
  );
  return result.rows;
}

async function assertImportActor(client, companyId, userId) {
  const result = await client.query(
    [
      "SELECT c.id AS company_id, u.id AS user_id,",
      'EXISTS (SELECT 1 FROM "userToCompany" utc',
      'WHERE utc."companyId" = c.id AND utc."userId" = u.id) AS member',
      'FROM company c CROSS JOIN public."user" u',
      "WHERE c.id = $1 AND u.id = $2"
    ].join(" "),
    [companyId, userId]
  );
  if (result.rows.length !== 1) {
    throw new Error("The Carbon company or audit user does not exist.");
  }
  if (result.rows[0].member !== true) {
    throw new Error("The audit user is not a member of the target company.");
  }
}

async function acquireImportLock(client, companyId) {
  const result = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
    ["u8-bom-parts-import:" + companyId]
  );
  if (result.rows[0]?.locked !== true) {
    throw new Error("Another U8 BOM part import is already running.");
  }
}

async function releaseImportLock(client, companyId) {
  await client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    ["u8-bom-parts-import:" + companyId]
  );
}

async function loadMappings(client, companyId) {
  const result = await client.query(
    [
      'SELECT id, "entityType", "entityId", "externalId", metadata',
      'FROM "externalIntegrationMapping"',
      'WHERE "companyId" = $1 AND integration = $2'
    ].join(" "),
    [companyId, INTEGRATION]
  );
  return result.rows;
}

function isCompatibleExistingItem(existing, source, rootItemIds) {
  const notes = existing.notes ?? {};
  const knownU8 =
    rootItemIds.has(existing.id) ||
    (Boolean(source.code) && notes?.u8?.itemCode === source.code) ||
    (Boolean(source.partId) &&
      notes?.u8Bom?.partId === source.partId);
  if (knownU8) return true;

  const hasWodiMESProvenance = Boolean(notes?.wodiMES?.sourceId);
  const existingName = String(existing.name ?? "").trim();
  const sourceName = String(source.name ?? "").trim();
  return hasWodiMESProvenance && existingName === sourceName;
}

async function analyzeCarbonTarget(
  client,
  { graph, productionOrders, companyId }
) {
  const sourceItems = [...graph.itemsByPartId.values()];
  const codes = sourceItems.map((item) => item.code);
  const partIds = sourceItems.map((item) => item.partId);
  const itemResult = await client.query(
    [
      'SELECT id, "readableId", name, revision, notes',
      "FROM item",
      'WHERE "companyId" = $1 AND type = \'Part\'',
      "AND COALESCE(revision, '0') = '0'",
      'AND "readableId" = ANY($2::text[])'
    ].join(" "),
    [companyId, codes]
  );
  const partResult = await client.query(
    'SELECT id FROM part WHERE "companyId" = $1 AND id = ANY($2::text[])',
    [companyId, codes]
  );
  const mappings = await loadMappings(client, companyId);
  const itemMappingByExternalId = new Map(
    mappings
      .filter((mapping) => mapping.entityType === "item")
      .map((mapping) => [String(mapping.externalId), mapping])
  );
  const existingByCode = new Map(
    itemResult.rows.map((item) => [item.readableId, item])
  );
  const rootItemIds = new Set(
    productionOrders.map((order) => order.rootItemId)
  );
  const collisions = [];

  for (const source of sourceItems) {
    const existing = existingByCode.get(source.code);
    const mapping = itemMappingByExternalId.get(source.partId);
    if (mapping && existing && mapping.entityId !== existing.id) {
      collisions.push(
        source.code + ": U8 PartId mapping points to " + mapping.entityId +
          " but the business key resolves to " + existing.id
      );
      continue;
    }
    if (mapping && !existing) {
      collisions.push(
        source.code + ": mapped Carbon item no longer exists"
      );
      continue;
    }
    if (!mapping && existing) {
      const knownU8 = isCompatibleExistingItem(existing, source, rootItemIds);
      if (!knownU8) {
        collisions.push(
          source.code + ": existing item is not identified as a U8 item"
        );
      }
    }
  }

  const methodMappings = mappings.filter(
    (mapping) => mapping.entityType === "makeMethod"
  );
  const materialMappings = mappings.filter(
    (mapping) => mapping.entityType === "methodMaterial"
  );
  const existingPartCodes = new Set(partResult.rows.map((part) => part.id));

  return {
    sourceItems: sourceItems.length,
    sourcePartIds: partIds.length,
    existingItems: itemResult.rows.length,
    newItems: sourceItems.length - itemResult.rows.length,
    existingPartMasters: partResult.rows.length,
    newPartMasters: sourceItems.filter(
      (item) => !existingPartCodes.has(item.code)
    ).length,
    mappedMethods: methodMappings.length,
    mappedMaterials: materialMappings.length,
    collisions
  };
}

function mappingRows(entityType, entities, companyId, userId) {
  const now = new Date();
  return entities.map((entity) => [
    entityType,
    entity.entityId,
    INTEGRATION,
    String(entity.externalId),
    json(entity.metadata),
    now,
    userId,
    companyId
  ]);
}

async function upsertMappings(
  client,
  entityType,
  entities,
  companyId,
  userId
) {
  await insertBatch(
    client,
    "externalIntegrationMapping",
    [
      "entityType",
      "entityId",
      "integration",
      "externalId",
      "metadata",
      "lastSyncedAt",
      "createdBy",
      "companyId"
    ],
    mappingRows(entityType, entities, companyId, userId),
    '("entityType", "entityId", "integration", "companyId")',
    [
      '"externalId" = EXCLUDED."externalId"',
      "metadata = EXCLUDED.metadata",
      '"lastSyncedAt" = EXCLUDED."lastSyncedAt"',
      '"updatedAt" = NOW()'
    ]
  );
}

function allocateVersion(desiredValue, usedVersions) {
  let desired = Number(desiredValue);
  if (!Number.isFinite(desired) || desired <= 0) desired = 1;
  desired = Math.round(desired * 100) / 100;
  while (usedVersions.has(desired.toFixed(2))) {
    desired = Math.round((desired + 1) * 100) / 100;
  }
  usedVersions.add(desired.toFixed(2));
  return desired;
}

async function importCarbonBom(
  client,
  { graph, productionOrders, companyId, userId }
) {
  const analysis = await analyzeCarbonTarget(client, {
    graph,
    productionOrders,
    companyId
  });
  if (analysis.collisions.length > 0) {
    throw new Error(
      "Carbon item collisions must be resolved before import: " +
        analysis.collisions.slice(0, 20).join("; ")
    );
  }

  const sourceItems = [...graph.itemsByPartId.values()].sort((a, b) =>
    compareText(a.code, b.code)
  );
  const units = new Map();
  for (const item of sourceItems) {
    const unit = unitIdentity(item, companyId);
    units.set(unit.code, unit);
  }
  await insertBatch(
    client,
    "unitOfMeasure",
    ["id", "code", "name", "companyId", "createdBy"],
    [...units.values()].map((unit) => [
      unit.id,
      unit.code,
      unit.name,
      companyId,
      userId
    ]),
    '("code", "companyId")',
    ["name = EXCLUDED.name"]
  );

  const itemRows = sourceItems.map((item) => {
    const unit = unitIdentity(item, companyId);
    const policy = itemPolicy(item, graph.childBomByPartId);
    return [
      stableId("item", companyId, INTEGRATION, item.partId),
      item.code,
      item.name,
      item.specification,
      "Part",
      policy.replenishmentSystem,
      policy.defaultMethodType,
      "Inventory",
      unit.code,
      companyId,
      userId,
      "0",
      json({
        u8Bom: {
          partId: item.partId,
          itemCode: item.code,
          sourceUnitCode: item.unitCode,
          freeValues: item.freeValues
        }
      }),
      userId
    ];
  });
  await insertBatch(
    client,
    "item",
    [
      "id",
      "readableId",
      "name",
      "description",
      "type",
      "replenishmentSystem",
      "defaultMethodType",
      "itemTrackingType",
      "unitOfMeasureCode",
      "companyId",
      "createdBy",
      "revision",
      "notes",
      "updatedBy"
    ],
    itemRows,
    '("readableId", "revision", "companyId", "type")',
    [
      "name = EXCLUDED.name",
      "description = EXCLUDED.description",
      '"replenishmentSystem" = EXCLUDED."replenishmentSystem"',
      '"defaultMethodType" = EXCLUDED."defaultMethodType"',
      '"unitOfMeasureCode" = EXCLUDED."unitOfMeasureCode"',
      "notes = COALESCE(item.notes, '{}'::jsonb) || EXCLUDED.notes",
      '"updatedBy" = EXCLUDED."updatedBy"',
      '"updatedAt" = NOW()'
    ],
    ITEM_UPDATE_WHERE
  );

  const itemResult = await client.query(
    [
      'SELECT id, "readableId", "defaultMethodType", "unitOfMeasureCode"',
      "FROM item",
      'WHERE "companyId" = $1 AND type = \'Part\'',
      "AND COALESCE(revision, '0') = '0'",
      'AND "readableId" = ANY($2::text[])'
    ].join(" "),
    [companyId, sourceItems.map((item) => item.code)]
  );
  const itemByCode = new Map(
    itemResult.rows.map((item) => [item.readableId, item])
  );
  if (itemByCode.size !== sourceItems.length) {
    throw new Error("Carbon item upsert count does not match U8 source parts.");
  }

  await insertBatch(
    client,
    "part",
    ["id", "companyId", "createdBy", "customFields", "updatedBy"],
    sourceItems.map((item) => [
      item.code,
      companyId,
      userId,
      json({ u8Bom: { partId: item.partId } }),
      userId
    ]),
    '("id", "companyId")',
    [
      "\"customFields\" = COALESCE(part.\"customFields\", '{}'::jsonb) || EXCLUDED.\"customFields\"",
      '"updatedBy" = EXCLUDED."updatedBy"',
      '"updatedAt" = NOW()'
    ]
  );

  await upsertMappings(
    client,
    "item",
    sourceItems.map((item) => ({
      entityId: itemByCode.get(item.code).id,
      externalId: item.partId,
      metadata: {
        u8Bom: {
          itemCode: item.code,
          unitCode: item.unitCode
        }
      }
    })),
    companyId,
    userId
  );

  const itemIds = [...itemByCode.values()].map((item) => item.id);
  const relatedRecords = await ensureItemRelatedRecords(
    client,
    itemIds,
    companyId,
    userId
  );
  const methodResult = await client.query(
    [
      "SELECT mm.*,",
      '(SELECT count(*) FROM "methodMaterial" material WHERE material."makeMethodId" = mm.id) AS material_count,',
      '(SELECT count(*) FROM "methodOperation" operation WHERE operation."makeMethodId" = mm.id) AS operation_count',
      'FROM "makeMethod" mm WHERE mm."companyId" = $1',
      'AND mm."itemId" = ANY($2::text[])',
      'ORDER BY mm."itemId", mm.version, mm.id'
    ].join(" "),
    [companyId, itemIds]
  );
  const mappings = await loadMappings(client, companyId);
  const methodMappingByBomId = new Map(
    mappings
      .filter((mapping) => mapping.entityType === "makeMethod")
      .map((mapping) => [String(mapping.externalId), mapping])
  );
  const mappedMethodIds = new Set(
    [...methodMappingByBomId.values()].map((mapping) => mapping.entityId)
  );
  const methodsById = new Map(
    methodResult.rows.map((method) => [method.id, method])
  );
  const methodsByItemId = new Map();
  for (const method of methodResult.rows) {
    const rows = methodsByItemId.get(method.itemId) ?? [];
    rows.push(method);
    methodsByItemId.set(method.itemId, rows);
  }
  const usedVersionsByItem = new Map();
  for (const [itemId, methods] of methodsByItemId) {
    usedVersionsByItem.set(
      itemId,
      new Set(methods.map((method) => Number(method.version).toFixed(2)))
    );
  }

  const boms = [...graph.bomById.values()].sort(
    (left, right) =>
      compareText(left.parentCode, right.parentCode) ||
      compareText(left.version ?? "", right.version ?? "") ||
      compareText(left.bomId, right.bomId)
  );
  const claimedMethodIds = new Set();
  const methodPlan = [];
  for (const bom of boms) {
    const item = graph.itemsByPartId.get(bom.parentPartId);
    const itemId = itemByCode.get(item.code).id;
    const existingMethods = methodsByItemId.get(itemId) ?? [];
    const mapping = methodMappingByBomId.get(bom.bomId);
    let method = mapping ? methodsById.get(mapping.entityId) : null;
    if (mapping && !method) {
      throw new Error(
        "Mapped Carbon make method is missing for U8 BomId " + bom.bomId
      );
    }
    if (method && method.itemId !== itemId) {
      throw new Error(
        "U8 BomId " + bom.bomId + " is mapped to another Carbon item."
      );
    }

    if (!method) {
      method = existingMethods.find(
        (candidate) =>
          candidate.status === "Draft" &&
          Number(candidate.material_count) === 0 &&
          Number(candidate.operation_count) === 0 &&
          !mappedMethodIds.has(candidate.id) &&
          !claimedMethodIds.has(candidate.id)
      );
    }
    const methodId =
      method?.id ?? stableId("make", companyId, INTEGRATION, bom.bomId);
    claimedMethodIds.add(methodId);

    const usedVersions = usedVersionsByItem.get(itemId) ?? new Set();
    usedVersionsByItem.set(itemId, usedVersions);
    if (method) {
      usedVersions.delete(Number(method.version).toFixed(2));
    }
    const version = allocateVersion(bom.version, usedVersions);
    const activeBomId = graph.childBomByPartId.get(bom.parentPartId);
    const status = String(activeBomId) === bom.bomId ? "Active" : "Archived";

    const unmanagedActive = existingMethods.find(
      (candidate) =>
        candidate.status === "Active" &&
        candidate.id !== methodId &&
        !mappedMethodIds.has(candidate.id)
    );
    if (status === "Active" && unmanagedActive) {
      throw new Error(
        "Carbon item " + item.code +
          " has an active non-U8 make method; refusing to replace it."
      );
    }

    methodPlan.push({
      id: methodId,
      itemId,
      bom,
      version,
      status
    });
  }

  await insertBatch(
    client,
    "makeMethod",
    [
      "id",
      "itemId",
      "companyId",
      "createdBy",
      "version",
      "status",
      "customFields",
      "updatedBy"
    ],
    methodPlan.map((method) => [
      method.id,
      method.itemId,
      companyId,
      userId,
      method.version,
      method.status,
      json({
        u8Bom: {
          bomId: method.bom.bomId,
          sourceVersion: method.bom.version,
          effectiveFrom: method.bom.effectiveFrom,
          effectiveTo: method.bom.effectiveTo
        }
      }),
      userId
    ]),
    '("id")',
    [
      '"itemId" = EXCLUDED."itemId"',
      "version = EXCLUDED.version",
      "status = EXCLUDED.status",
      "\"customFields\" = COALESCE(\"makeMethod\".\"customFields\", '{}'::jsonb) || EXCLUDED.\"customFields\"",
      '"updatedBy" = EXCLUDED."updatedBy"',
      '"updatedAt" = NOW()'
    ]
  );

  const methodByBomId = new Map(
    methodPlan.map((method) => [method.bom.bomId, method])
  );
  await upsertMappings(
    client,
    "makeMethod",
    methodPlan.map((method) => ({
      entityId: method.id,
      externalId: method.bom.bomId,
      metadata: {
        u8Bom: {
          itemCode: method.bom.parentCode,
          version: method.bom.version
        }
      }
    })),
    companyId,
    userId
  );

  const currentMappings = await loadMappings(client, companyId);
  const materialMappingByEdgeId = new Map(
    currentMappings
      .filter((mapping) => mapping.entityType === "methodMaterial")
      .map((mapping) => [String(mapping.externalId), mapping])
  );
  const materialPlan = [];
  for (const [bomId, sourceEdges] of graph.edgesByBomId.entries()) {
    const parentMethod = methodByBomId.get(String(bomId));
    if (!parentMethod) {
      throw new Error("Carbon make method is missing for U8 BomId " + bomId);
    }
    const sorted = [...sourceEdges].sort(
      (left, right) =>
        Number(left.sortSeq) - Number(right.sortSeq) ||
        compareText(left.opComponentId, right.opComponentId)
    );
    sorted.forEach((edge, index) => {
      const child = graph.itemsByPartId.get(edge.childPartId);
      const childItem = itemByCode.get(child.code);
      const childBomId = graph.childBomByPartId.get(edge.childPartId);
      const childMethod = childBomId
        ? methodByBomId.get(String(childBomId))
        : null;
      const quantity = new Decimal(edge.baseQtyN).dividedBy(edge.baseQtyD);
      const mapping = materialMappingByEdgeId.get(edge.opComponentId);
      materialPlan.push({
        id:
          mapping?.entityId ??
          stableId("mmat", companyId, INTEGRATION, edge.opComponentId),
        edge,
        makeMethodId: parentMethod.id,
        itemId: childItem.id,
        materialMakeMethodId: childMethod?.id ?? null,
        methodType: childItem.defaultMethodType,
        unitOfMeasureCode: childItem.unitOfMeasureCode,
        quantity: quantity.toSignificantDigits(28).toString(),
        order: index + 1
      });
    });
  }

  await insertBatch(
    client,
    "methodMaterial",
    [
      "id",
      "makeMethodId",
      "methodType",
      "materialMakeMethodId",
      "itemType",
      "itemId",
      "quantity",
      "unitOfMeasureCode",
      "companyId",
      "createdBy",
      "order",
      "customFields",
      "updatedBy",
      "sourcingType",
      "storageUnitIds"
    ],
    materialPlan.map((material) => [
      material.id,
      material.makeMethodId,
      material.methodType,
      material.materialMakeMethodId,
      "Part",
      material.itemId,
      material.quantity,
      material.unitOfMeasureCode,
      companyId,
      userId,
      material.order,
      json({
        u8Bom: {
          bomId: material.edge.bomId,
          opComponentId: material.edge.opComponentId,
          parentPartId: material.edge.parentPartId,
          parentCode: material.edge.parentCode,
          childPartId: material.edge.childPartId,
          childCode: material.edge.childCode,
          sourceSortSeq: material.edge.sortSeq,
          opSeq: material.edge.opSeq,
          baseQtyN: material.edge.baseQtyN,
          baseQtyD: material.edge.baseQtyD,
          componentScrap: material.edge.componentScrap,
          parentScrap: material.edge.parentScrap,
          effectiveFrom: material.edge.effectiveFrom,
          effectiveTo: material.edge.effectiveTo
        }
      }),
      userId,
      "Specified",
      json({})
    ]),
    '("id")',
    [
      '"makeMethodId" = EXCLUDED."makeMethodId"',
      '"methodType" = EXCLUDED."methodType"',
      '"materialMakeMethodId" = EXCLUDED."materialMakeMethodId"',
      '"itemId" = EXCLUDED."itemId"',
      "quantity = EXCLUDED.quantity",
      '"unitOfMeasureCode" = EXCLUDED."unitOfMeasureCode"',
      '"order" = EXCLUDED."order"',
      "\"customFields\" = COALESCE(\"methodMaterial\".\"customFields\", '{}'::jsonb) || EXCLUDED.\"customFields\"",
      '"updatedBy" = EXCLUDED."updatedBy"',
      '"updatedAt" = NOW()'
    ]
  );

  await upsertMappings(
    client,
    "methodMaterial",
    materialPlan.map((material) => ({
      entityId: material.id,
      externalId: material.edge.opComponentId,
      metadata: {
        u8Bom: {
          bomId: material.edge.bomId,
          parentCode: material.edge.parentCode,
          childCode: material.edge.childCode
        }
      }
    })),
    companyId,
    userId
  );

  const sourceBomIds = new Set(boms.map((bom) => bom.bomId));
  const sourceEdgeIds = new Set(
    materialPlan.map((material) => material.edge.opComponentId)
  );
  const staleMappings = currentMappings.filter(
    (mapping) =>
      mapping.entityType === "methodMaterial" &&
      sourceBomIds.has(String(mapping.metadata?.u8Bom?.bomId)) &&
      !sourceEdgeIds.has(String(mapping.externalId))
  );
  if (staleMappings.length > 0) {
    const staleIds = staleMappings.map((mapping) => mapping.entityId);
    await client.query(
      'DELETE FROM "methodMaterial" WHERE "companyId" = $1 AND id = ANY($2::text[])',
      [companyId, staleIds]
    );
    await client.query(
      [
        'DELETE FROM "externalIntegrationMapping"',
        'WHERE "companyId" = $1 AND integration = $2',
        'AND "entityType" = \'methodMaterial\'',
        'AND "entityId" = ANY($3::text[])'
      ].join(" "),
      [companyId, INTEGRATION, staleIds]
    );
  }

  return {
    analysis,
    items: sourceItems.length,
    partMasters: sourceItems.length,
    methods: methodPlan.length,
    materials: materialPlan.length,
    relatedRecords,
    staleMaterialsRemoved: staleMappings.length,
    existingMethods: methodPlan.filter((method) =>
      methodsById.has(method.id)
    ).length,
    newMethods: methodPlan.filter((method) => !methodsById.has(method.id))
      .length
  };
}

module.exports = {
  acquireImportLock,
  analyzeCarbonTarget,
  assertImportActor,
  ensureItemRelatedRecords,
  importCarbonBom,
  insertBatch,
  isCompatibleExistingItem,
  loadCurrentProductionOrders,
  releaseImportLock
};

