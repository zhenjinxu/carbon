/*
 * Idempotent WodiMES -> Carbon importer.
 *
 * Usage from D:\Object\carbon:
 *   node scripts/import-wodimes.cjs
 *   node scripts/import-wodimes.cjs --dry-run
 *   node scripts/import-wodimes.cjs --rollback
 *
 * The importer reads the live local MongoDB configured by WodiMES and the
 * local Carbon PostgreSQL URL. Password fields are intentionally redacted.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(process.env.WODIMES_SOURCE_ROOT || "D:/Object/0.1.7");
const CARBON_ROOT = path.resolve(__dirname, "..");
const { MongoClient } = require(path.join(SOURCE_ROOT, "node_modules", "mongodb"));
const { Pool } = require(path.join(CARBON_ROOT, "packages", "database", "node_modules", "pg"));
const DRY_RUN = process.argv.includes("--dry-run");
const ROLLBACK_ONLY = process.argv.includes("--rollback");
const BATCH_SIZE = 500;

if (DRY_RUN && ROLLBACK_ONLY) {
  throw new Error("Choose either --dry-run or --rollback, not both.");
}
const COMPANY_NAME = process.env.WODIMES_CARBON_COMPANY_NAME || "上海沃迪智能装备";

function loadEnv(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

const sourceEnv = loadEnv(path.join(SOURCE_ROOT, ".env"));
const carbonEnv = loadEnv(path.join(CARBON_ROOT, ".env.local"));
const MONGO_URL = process.env.WODIMES_MONGO_URL || sourceEnv.MONGO_URL || "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.WODIMES_MONGO_DB || sourceEnv.MONGO_DB || "mes_db";
const CARBON_DB_URL = process.env.SUPABASE_DB_URL || carbonEnv.SUPABASE_DB_URL;
const CREATED_BY = process.env.WODIMES_CARBON_USER_ID || "system";

if (!CARBON_DB_URL) throw new Error("SUPABASE_DB_URL is not configured in Carbon .env.local");

const qident = (value) => `"${String(value).replaceAll('"', '""')}"`;
const text = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};
const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const date = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const hash = (...parts) => crypto.createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 24);
const stableId = (prefix, ...parts) => `${prefix}_${hash(...parts)}`;
const naturalSourceKey = (doc, collection) => {
  switch (collection) {
    case "mes_proc_order_details":
      return [doc.MoDId, doc.OpSeq, doc.OpDesc];
    case "mes_proc_hours":
      return [doc.MoDId, doc.OpSeq, doc.OperationId];
    case "mes_materials":
      return [doc.uf_inv_code || doc.material_code];
    case "mes_operations":
      return [doc.uf_operation_id || doc.operation_code];
    case "mes_work_centers":
      return [doc.wc_code || doc.code];
    case "mes_inventory":
      return [doc.uf_inv_code || doc.material_code, doc.location];
    case "mes_workers":
      return [doc.username];
    case "mes_machines":
      return [doc.machine_code || doc.code];
    case "mes_workshops":
      return [doc.name];
    default:
      return null;
  }
};

const sourceId = (doc, collection) => {
  const naturalKey = naturalSourceKey(doc, collection);
  if (naturalKey?.length && naturalKey.every((part) => text(part) !== null)) {
    return stableId("wodsrc", collection, ...naturalKey.map((part) => text(part)));
  }
  const objectId = text(doc._id);
  if (objectId) return objectId;
  const snapshot = { ...doc };
  delete snapshot._id;
  return stableId("wodsrc", collection, JSON.stringify(safePayload(snapshot)));
};
const json = (value) => JSON.stringify(value ?? {});

function safePayload(value) {
  return JSON.parse(JSON.stringify(value, (key, current) => {
    if (["password", "JWT_SECRET", "MONGO_URL", "U8_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY"].includes(key)) return undefined;
    return current;
  }));
}

async function insertBatch(client, table, columns, rows, conflict, updateColumns = []) {
  if (!rows.length || DRY_RUN) return;
  const sourceRows = columns.includes("id")
    ? [...new Map(rows.map((row) => [row[columns.indexOf("id")], row])).values()]
    : rows;
  const quotedColumns = columns.map(qident).join(", ");
  for (let offset = 0; offset < sourceRows.length; offset += BATCH_SIZE) {
    const batch = sourceRows.slice(offset, offset + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, rowIndex) => {
      const rowPlaceholders = row.map((value, columnIndex) => {
        values.push(value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });
    const updateAssignments = updateColumns
      .filter((column) => column === "updatedAt" || columns.includes(column))
      .map((column) => column === "updatedAt" ? `${qident(column)} = NOW()` : `${qident(column)} = EXCLUDED.${qident(column)}`);
    const update = updateAssignments.length
      ? `DO UPDATE SET ${updateAssignments.join(", ")}`
      : "DO NOTHING";
    const conflictClause = conflict === "DO NOTHING"
      ? "ON CONFLICT DO NOTHING"
      : `ON CONFLICT ${conflict} ${update}`;
    await client.query(
      `INSERT INTO ${qident(table)} (${quotedColumns}) VALUES ${placeholders.join(", ")} ${conflictClause}`,
      values
    );
  }
}

async function getCollectionSignature(mongo, collectionName) {
  const collection = mongo.collection(collectionName);
  const [count, first, last] = await Promise.all([
    collection.countDocuments({}),
    collection.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).next(),
    collection.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next()
  ]);
  return `${count}:${text(first?._id, "")}:${text(last?._id, "")}`;
}

async function main() {
  const mongoClient = new MongoClient(MONGO_URL, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  const pool = new Pool({ connectionString: CARBON_DB_URL, max: 4 });
  await mongoClient.connect();
  const mongo = mongoClient.db(MONGO_DB);
  const client = await pool.connect();
  const counters = {};
  const externalRows = [];
  let companyId = null;
  let runId = null;
  let transactionStarted = false;

  try {
    const companyResult = await client.query(
      `SELECT id, name FROM "company" WHERE id = $1 OR name = $2 ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END LIMIT 1`,
      [process.env.WODIMES_CARBON_COMPANY_ID || "", COMPANY_NAME]
    );
    if (!companyResult.rows[0]) throw new Error(`Carbon company not found: ${COMPANY_NAME}`);
    companyId = companyResult.rows[0].id;
    const locationResult = await client.query(
      `SELECT id FROM "location" WHERE "companyId" = $1 AND (name = '沃迪生产车间' OR name = 'Headquarters') ORDER BY CASE WHEN name = '沃迪生产车间' THEN 0 ELSE 1 END LIMIT 1`,
      [companyId]
    );
    const defaultLocationId = process.env.WODIMES_CARBON_LOCATION_ID || locationResult.rows[0]?.id;
    if (!defaultLocationId) throw new Error(`Carbon location not found for company ${companyId}`);

    const creatorResult = await client.query(`SELECT id FROM "user" WHERE id = $1 LIMIT 1`, [CREATED_BY]);
    if (!creatorResult.rows[0]) {
      throw new Error(`Carbon import user not found: ${CREATED_BY}. Set WODIMES_CARBON_USER_ID.`);
    }

    const collections = (await mongo.listCollections().toArray()).map((item) => item.name).sort();
    console.log(`Source: ${MONGO_DB} (${collections.length} collections)`);
    console.log(`Target: ${companyResult.rows[0].name} (${companyId})`);
    if (DRY_RUN) console.log("DRY RUN: no Carbon records will be written.");
    if (ROLLBACK_ONLY) console.log("ROLLBACK: Carbon writes will be fully validated, then rolled back.");

    const sourceDocs = new Map();
    const sourceSignatures = new Map();
    for (const collectionName of collections) {
      const beforeSignature = await getCollectionSignature(mongo, collectionName);
      const docs = [];
      const cursor = mongo.collection(collectionName).find({}).batchSize(BATCH_SIZE);
      for await (const document of cursor) {
        const clean = safePayload(document);
        const id = sourceId(document, collectionName);
        docs.push({ document, clean, id });
      }
      const afterSignature = await getCollectionSignature(mongo, collectionName);
      if (beforeSignature !== afterSignature) {
        throw new Error(`Source collection changed while reading: ${collectionName}`);
      }
      sourceDocs.set(collectionName, docs);
      sourceSignatures.set(collectionName, afterSignature);
      counters[collectionName] = docs.length;
    }

    runId = stableId("wodrun", companyId, new Date().toISOString());
    if (!DRY_RUN) {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        `UPDATE "wodiMESSyncRun" SET "status" = 'Failed', "finishedAt" = clock_timestamp(), "errorCount" = GREATEST("errorCount", 1) WHERE "companyId" = $1 AND "status" = 'Running'`,
        [companyId]
      );
      await client.query(
        `INSERT INTO "wodiMESSyncRun" ("id", "companyId", "status", "sourceCounts", "createdBy") VALUES ($1, $2, 'Running', $3::jsonb, $4)`,
        [runId, companyId, json(counters), CREATED_BY]
      );
    }

    for (const [collectionName, docs] of sourceDocs) {
      const rawRows = docs.map(({ clean, id }) => [
        stableId("wodraw", companyId, collectionName, id),
        companyId,
        collectionName,
        id,
        date(clean.modified || clean.updated || clean.modified_at || clean.created || clean.created_at),
        json(clean),
        runId,
        CREATED_BY
      ]);
      await insertBatch(
        client,
        "wodiMESLegacyRecord",
        ["id", "companyId", "sourceCollection", "sourceId", "sourceUpdatedAt", "payload", "syncRunId", "createdBy"],
        rawRows,
        '("sourceCollection", "sourceId", "companyId")',
        ["sourceUpdatedAt", "payload", "syncRunId", "updatedAt"]
      );
      console.log(`  raw ${collectionName}: ${docs.length}`);
    }

    const uomMap = new Map();
    const itemMap = new Map();
    const processMap = new Map();
    const workCenterMap = new Map();
    const locationMap = new Map([["default", defaultLocationId]]);
    const employeeMap = new Map();
    const resourceMap = new Map();
    const resourceCodeMap = new Map();
    const resourceWorkCenterMap = new Map();
    const jobMap = new Map();
    const jobMakeMethodMap = new Map();
    const operationMap = new Map();
    const operationByReadableKey = new Map();
    const methodMap = new Map();

    const existingCompatibilityWorkers = await client.query(`SELECT id, username FROM "wodiMESWorker" WHERE "companyId" = $1`, [companyId]);
    const compatibilityWorkerByUsername = new Map(existingCompatibilityWorkers.rows.map((row) => [row.username, row.id]));
    const existingCompatibilityResources = await client.query(`SELECT id, code, name, "sourceCollection", "sourceId" FROM "wodiMESResource" WHERE "companyId" = $1 ORDER BY "updatedAt" NULLS FIRST, "createdAt"`, [companyId]);
    const compatibilityResourceBySource = new Map(existingCompatibilityResources.rows.map((row) => [`${row.sourceCollection}:${row.sourceId}`, row.id]));
    const compatibilityResourceByCode = new Map(existingCompatibilityResources.rows.map((row) => [row.code, row.id]));
    const compatibilityResourceByName = new Map(existingCompatibilityResources.rows.map((row) => [`${row.sourceCollection}:${row.name}`, row.id]));

    const existingUoms = await client.query(`SELECT code, id FROM "unitOfMeasure" WHERE "companyId" = $1`, [companyId]);
    for (const row of existingUoms.rows) uomMap.set(row.code, row.code);
    const ensureUom = async (rawUnit) => {
      const name = text(rawUnit, "件");
      const code = `WODI_${hash(name).slice(0, 10)}`;
      if (uomMap.has(code)) return code;
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "unitOfMeasure" ("id", "code", "name", "companyId", "createdBy") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [stableId("woduom", companyId, code), code, name, companyId, CREATED_BY]
        );
      }
      uomMap.set(code, code);
      return code;
    };

    const existingItems = await client.query(`SELECT id, "readableId", "unitOfMeasureCode" FROM "item" WHERE "companyId" = $1`, [companyId]);
    for (const row of existingItems.rows) itemMap.set(row.readableId, row.id);
    const ensureItem = async (rawCode, rawName, rawUnit, sourceCollection, rawSourceId, type = "Part") => {
      const readableId = text(rawCode, `WODI-${hash(rawName)}`);
      const rememberMapping = (itemId) => {
        externalRows.push([stableId("wodext", companyId, sourceCollection, rawSourceId, "item"), companyId, sourceCollection, rawSourceId, readableId, "item", itemId, null, CREATED_BY]);
        return itemId;
      };
      if (itemMap.has(readableId)) return rememberMapping(itemMap.get(readableId));
      const id = stableId("wodiitem", companyId, readableId, type);
      const uom = await ensureUom(rawUnit);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "item" ("id", "readableId", "name", "type", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy", "revision", "notes") VALUES ($1, $2, $3, $4, 'Inventory', $5, $6, $7, '0', $8::jsonb) ON CONFLICT ("readableId", "revision", "companyId", "type") DO UPDATE SET name = EXCLUDED.name, "unitOfMeasureCode" = EXCLUDED."unitOfMeasureCode", notes = EXCLUDED.notes`,
          [id, readableId, text(rawName, readableId), type, uom, companyId, CREATED_BY, json({ wodiMES: { sourceCollection, sourceId: rawSourceId } })]
        );
      }
      itemMap.set(readableId, id);
      return rememberMapping(id);
    };

    const existingProcesses = await client.query(`SELECT id, name FROM "process" WHERE "companyId" = $1`, [companyId]);
    for (const row of existingProcesses.rows) processMap.set(row.name, row.id);
    const ensureProcess = async (rawName) => {
      const name = text(rawName, "WodiMES 工序");
      if (processMap.has(name)) return processMap.get(name);
      const id = stableId("wodiprocess", companyId, name);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "process" ("id", "name", "defaultStandardFactor", "companyId", "createdBy", "active") VALUES ($1, $2, 'Minutes/Piece', $3, $4, true) ON CONFLICT ("name", "companyId") DO UPDATE SET active = true`,
          [id, name, companyId, CREATED_BY]
        );
      }
      processMap.set(name, id);
      return id;
    };

    const existingLocations = await client.query(`SELECT id, name FROM "location" WHERE "companyId" = $1`, [companyId]);
    for (const row of existingLocations.rows) locationMap.set(row.name, row.id);
    const ensureLocation = async (rawName, rawCode) => {
      const name = text(rawName, "WodiMES 车间");
      if (locationMap.has(name)) return locationMap.get(name);
      const id = stableId("wodiloc", companyId, rawCode || name);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "location" ("id", "name", "addressLine1", "city", "postalCode", "timezone", "companyId", "createdBy") VALUES ($1, $2, 'WodiMES import', 'Shanghai', '200000', 'Asia/Shanghai', $3, $4) ON CONFLICT ("id") DO UPDATE SET name = EXCLUDED.name`,
          [id, name, companyId, CREATED_BY]
        );
      }
      locationMap.set(name, id);
      return id;
    };

    const existingWorkCenters = await client.query(`SELECT id, name, "locationId" FROM "workCenter" WHERE "companyId" = $1`, [companyId]);
    const workCenterById = new Map();
    for (const row of existingWorkCenters.rows) workCenterMap.set(`${row.name}|${row.locationId || ""}`, row.id);
    for (const row of existingWorkCenters.rows) workCenterById.set(row.id, row);
    const ensureWorkCenter = async (rawName, rawCode, locationId = defaultLocationId) => {
      const name = text(rawName, rawCode || "WodiMES 工作中心");
      const key = `${name}|${locationId || ""}`;
      if (workCenterMap.has(key)) return workCenterMap.get(key);
      const id = stableId("wodiwc", companyId, rawCode || name, locationId || "");
      if (workCenterById.has(id)) {
        workCenterMap.set(key, id);
        return id;
      }
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "workCenter" ("id", "name", "description", "locationId", "companyId", "createdBy", "defaultStandardFactor") VALUES ($1, $2, $3, $4, $5, $6, 'Minutes/Piece') ON CONFLICT ("name", "locationId", "companyId") DO UPDATE SET description = EXCLUDED.description`,
          [id, name, rawCode ? `WodiMES ${rawCode}` : "WodiMES 导入工作中心", locationId, companyId, CREATED_BY]
        );
      }
      workCenterMap.set(key, id);
      return id;
    };

    const employeeTypes = new Map();
    for (const row of (await client.query(`SELECT id, name FROM "employeeType" WHERE "companyId" = $1`, [companyId])).rows) employeeTypes.set(row.name, row.id);
    const employeeTypeFor = (role) => employeeTypes.get(role === "qc" ? "质量人员" : role === "admin" ? "Admin" : "生产人员") || employeeTypes.values().next().value;
    const ensureEmployee = async (worker) => {
      const username = text(worker.username, `worker-${sourceId(worker, "mes_workers")}`);
      if (employeeMap.has(username)) return employeeMap.get(username);
      const id = stableId("wodiemp", companyId, username);
      const typeId = employeeTypeFor(worker.role);
      if (!typeId) throw new Error(`No Carbon employee type for ${username}`);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "employee" ("id", "companyId", "employeeTypeId", "active") VALUES ($1, $2, $3, $4) ON CONFLICT ("id", "companyId") DO UPDATE SET "employeeTypeId" = EXCLUDED."employeeTypeId", active = EXCLUDED.active`,
          [id, companyId, typeId, worker.is_active !== false]
        );
      }
      employeeMap.set(username, id);
      return id;
    };

    const ensureResource = async (collectionName, resource, locationId = defaultLocationId) => {
      const sid = sourceId(resource, collectionName);
      const key = `${collectionName}:${sid}`;
      if (resourceMap.has(key)) return resourceMap.get(key);
      const resourceName = text(resource.machine_name || resource.name || resource.equipment_name);
      const code = text(resource.machine_code || resource.code || resource.equipment_code, `WODI-${hash(collectionName, resourceName || sid).slice(0, 10)}`);
      const id = compatibilityResourceBySource.get(`${collectionName}:${sid}`) || compatibilityResourceByCode.get(code) || compatibilityResourceByName.get(`${collectionName}:${resourceName}`) || stableId("wodires", companyId, collectionName, sid);
      compatibilityResourceBySource.set(`${collectionName}:${sid}`, id);
      compatibilityResourceByCode.set(code, id);
      compatibilityResourceByName.set(`${collectionName}:${resourceName}`, id);
      const workCenterId = resource.wc_code ? await ensureWorkCenter(resource.wc_code, resource.wc_code, locationId) : null;
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "wodiMESResource" ("id", "companyId", "sourceCollection", "sourceId", "code", "name", "resourceType", "model", "status", "workCenterId", "locationId", "ipAddress", "macAddress", "payload", "createdBy") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15) ON CONFLICT ("id") DO UPDATE SET "sourceCollection" = EXCLUDED."sourceCollection", "sourceId" = EXCLUDED."sourceId", code = EXCLUDED.code, name = EXCLUDED.name, "resourceType" = EXCLUDED."resourceType", model = EXCLUDED.model, status = EXCLUDED.status, "workCenterId" = EXCLUDED."workCenterId", "locationId" = EXCLUDED."locationId", "ipAddress" = EXCLUDED."ipAddress", "macAddress" = EXCLUDED."macAddress", payload = EXCLUDED.payload, "updatedAt" = NOW()`,
          [id, companyId, collectionName, sid, code, text(resourceName, code), collectionName === "mes_equipment" ? "Equipment" : collectionName === "mes_workshops" ? "Workshop" : "Machine", text(resource.machine_model || resource.model), text(resource.status), workCenterId, locationId, text(resource.ip_address || resource.ip), text(resource.mac_address || resource.mac), json(safePayload(resource)), CREATED_BY]
        );
      }
      resourceMap.set(key, id);
      resourceCodeMap.set(`${collectionName}:${code}`, id);
      resourceWorkCenterMap.set(id, workCenterId);
      externalRows.push([stableId("wodext", companyId, collectionName, sid, "resource"), companyId, collectionName, sid, code, "wodiMESResource", id, null, CREATED_BY]);
      return id;
    };

    for (const row of sourceDocs.get("mes_materials") || []) {
      const material = row.document;
      await ensureItem(material.uf_inv_code || material.material_code, material.name, material.unit, "mes_materials", row.id, "Part");
    }
    for (const row of sourceDocs.get("mes_workers") || []) {
      const worker = row.document;
      const username = text(worker.username, row.id);
      const employeeId = await ensureEmployee(worker);
      const compatibilityWorkerId = compatibilityWorkerByUsername.get(username) || stableId("wodworker", companyId, row.id);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "wodiMESWorker" ("id", "companyId", "sourceId", "username", "name", "role", "phone", "employeeId", "active", "payload", "createdBy") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) ON CONFLICT ("id") DO UPDATE SET "sourceId" = EXCLUDED."sourceId", username = EXCLUDED.username, name = EXCLUDED.name, role = EXCLUDED.role, phone = EXCLUDED.phone, "employeeId" = EXCLUDED."employeeId", active = EXCLUDED.active, payload = EXCLUDED.payload, "updatedAt" = NOW()`,
          [compatibilityWorkerId, companyId, row.id, username, text(worker.name, worker.username), text(worker.role, "worker"), text(worker.phone), employeeId, worker.is_active !== false, json(safePayload(worker)), CREATED_BY]
        );
      }
      externalRows.push([stableId("wodext", companyId, "mes_workers", row.id, "worker"), companyId, "mes_workers", row.id, username, "wodiMESWorker", compatibilityWorkerId, null, CREATED_BY]);
    }
    for (const row of sourceDocs.get("mes_workshops") || []) {
      const workshop = row.document;
      const locationId = await ensureLocation(workshop.name || workshop.location, workshop.code);
      await ensureResource("mes_workshops", workshop, locationId);
    }
    for (const row of sourceDocs.get("mes_work_centers") || []) {
      const center = row.document;
      await ensureWorkCenter(center.wc_name || center.name, center.wc_code || center.code, defaultLocationId);
    }

    const operationDefs = new Map();
    for (const row of sourceDocs.get("mes_operations") || []) {
      const operation = row.document;
      const processId = await ensureProcess(operation.name || operation.operation_code);
      const sourceCode = text(operation.operation_code || operation.uf_operation_id || operation.name);
      operationDefs.set(sourceCode, { processId, workCenterId: operation.wc_code ? await ensureWorkCenter(operation.wc_code, operation.wc_code) : null });
      operationDefs.set(String(operation.sequence_no), { processId, workCenterId: operation.wc_code ? await ensureWorkCenter(operation.wc_code, operation.wc_code) : null });
      externalRows.push([stableId("wodext", companyId, "mes_operations", row.id, "process"), companyId, "mes_operations", row.id, sourceCode, "process", processId, null, CREATED_BY]);
    }

    for (const row of sourceDocs.get("mes_routings") || []) {
      const routing = row.document;
      const productCode = text(routing.product_code, `ROUTE-${row.id}`);
      const itemId = await ensureItem(productCode, routing.name || productCode, "件", "mes_routings", row.id, "Part");
      const methodId = stableId("wodimethod", companyId, row.id);
      methodMap.set(productCode, methodId);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "makeMethod" ("id", "itemId", "companyId", "createdBy", "version", "status", "customFields") VALUES ($1, $2, $3, $4, $5, 'Active', $6::jsonb) ON CONFLICT ("itemId", "version") DO UPDATE SET status = 'Active', "customFields" = EXCLUDED."customFields"`,
          [methodId, itemId, companyId, CREATED_BY, number(routing.version, 1), json({ wodiMES: safePayload(routing) })]
        );
      }
      const steps = Array.isArray(routing.steps) ? routing.steps : [];
      const methodRows = [];
      for (let index = 0; index < steps.length; index++) {
        const step = text(steps[index], String(index + 1));
        const definition = operationDefs.get(step) || { processId: await ensureProcess(step), workCenterId: null };
        methodRows.push([
          stableId("wodmop", companyId, row.id, step), methodId, index + 1, "After Previous", step,
          companyId, CREATED_BY, definition.processId, definition.workCenterId, 0, 0, 0,
          json({ wodiMES: { sourceRoutingId: row.id, step } })
        ]);
      }
      await insertBatch(client, "methodOperation", ["id", "makeMethodId", "order", "operationOrder", "description", "companyId", "createdBy", "processId", "workCenterId", "setupTime", "laborTime", "machineTime", "customFields"], methodRows, '("id")', ["description", "processId", "workCenterId", "customFields", "updatedAt"]);
      for (const methodRow of methodRows) externalRows.push([stableId("wodext", companyId, "mes_routings", row.id, `step:${methodRow[2]}`), companyId, "mes_routings", `${row.id}:step:${methodRow[2]}`, `${productCode}:${methodRow[2]}`, "methodOperation", methodRow[0], null, CREATED_BY]);
      externalRows.push([stableId("wodext", companyId, "mes_routings", row.id, "method"), companyId, "mes_routings", row.id, productCode, "makeMethod", methodId, null, CREATED_BY]);
    }

    const hoursByOperation = new Map();
    for (const row of sourceDocs.get("mes_proc_hours") || []) {
      const source = row.document;
      const key = `${text(source.MoDId)}:${text(source.OpSeq)}`;
      const current = hoursByOperation.get(key) || { work: 0, prep: 0 };
      current.work += number(source.work_hour);
      current.prep += number(source.prep_hour);
      hoursByOperation.set(key, current);
    }

    const procGroups = new Map();
    for (const row of sourceDocs.get("mes_proc_order_details") || []) {
      const source = row.document;
      const key = text(source.MoDId, row.id);
      let group = procGroups.get(key);
      if (!group) {
        group = { key, first: source, rows: [], allComplete: true, hasInProgress: false, maxQualified: 0 };
        procGroups.set(key, group);
      }
      group.rows.push({ ...source, _sourceId: row.id });
      const qty = number(source.Qty);
      const qualified = number(source.QualifiedInQty);
      group.maxQualified = Math.max(group.maxQualified, qualified);
      if (number(source.Status) !== 4) group.allComplete = false;
      if (number(source.Status) === 3) group.hasInProgress = true;
      if (number(source.Status) === 4 && qualified < qty && text(source.OpDesc) !== "领料工作中心") group.allComplete = false;
    }

    const existingOperationRows = await client.query(
      `SELECT id, description FROM "jobOperation" WHERE "companyId" = $1 AND id LIKE 'wodjo_%'`,
      [companyId]
    );
    const existingOperationDescriptions = new Map(existingOperationRows.rows.map((row) => [row.id, row.description]));
    for (const group of procGroups.values()) {
      const rowsByBaseKey = new Map();
      for (const source of group.rows) {
        const baseKey = `${group.key}:${text(source.OpSeq)}`;
        const rows = rowsByBaseKey.get(baseKey) || [];
        rows.push(source);
        rowsByBaseKey.set(baseKey, rows);
      }
      for (const [baseKey, rows] of rowsByBaseKey) {
        if (rows.length === 1) {
          rows[0]._operationKey = baseKey;
          continue;
        }
        const existingDescription = existingOperationDescriptions.get(stableId("wodjo", companyId, baseKey));
        let primaryIndex = rows.findIndex((row) => text(row.OpDesc) === text(existingDescription));
        if (primaryIndex < 0) primaryIndex = rows.length - 1;
        rows.forEach((row, index) => {
          row._operationKey = index === primaryIndex
            ? baseKey
            : `${baseKey}:duplicate:${hash(row._sourceId, row.OpDesc)}`;
        });
      }
    }

    const existingJobs = await client.query(`SELECT id, "jobId" FROM "job" WHERE "companyId" = $1`, [companyId]);
    const existingJobByJobId = new Map(existingJobs.rows.map((row) => [row.jobId, row.id]));
    const jobRows = [];
    const methodRows = [];
    for (const group of procGroups.values()) {
      const first = group.first;
      const jobId = `WODI-${text(first.MoCode, group.key)}-${group.key}`;
      const itemId = await ensureItem(first.InvCode, first.InvName, "件", "mes_proc_order_details", group.rows[0]._sourceId, "Part");
      const sourceStatus = group.allComplete ? "Completed" : group.hasInProgress ? "In Progress" : "Planned";
      const existingId = existingJobByJobId.get(jobId);
      const id = existingId || stableId("wodjob", companyId, group.key);
      existingJobByJobId.set(jobId, id);
      const unit = await ensureUom("件");
      jobRows.push([
        id, jobId, "U8 ERP", itemId, unit, defaultLocationId, sourceStatus, number(first.Qty), group.maxQualified,
        companyId, CREATED_BY, date(first.DueDate), 1, json({ wodiMES: { sourceMoDId: group.key, sourceMoCode: first.MoCode, sourceStatus, itemCode: first.InvCode } })
      ]);
      const makeMethodId = stableId("wodjmm", companyId, group.key);
      jobMakeMethodMap.set(group.key, makeMethodId);
      methodRows.push([makeMethodId, id, itemId, companyId, CREATED_BY, json({ wodiMES: { sourceMoDId: group.key } })]);
      jobMap.set(group.key, { id, itemId, makeMethodId, jobId, unit });
    }
    await insertBatch(client, "job", ["id", "jobId", "source", "itemId", "unitOfMeasureCode", "locationId", "status", "quantity", "quantityComplete", "companyId", "createdBy", "dueDate", "priority", "customFields"], jobRows, '("id")', ["source", "status", "quantity", "quantityComplete", "dueDate", "customFields", "updatedAt"]);
    await insertBatch(client, "jobMakeMethod", ["id", "jobId", "itemId", "companyId", "createdBy", "customFields"], methodRows, '("id")', ["itemId", "customFields", "updatedAt"]);

    const operationRows = [];
    for (const group of procGroups.values()) {
      const job = jobMap.get(group.key);
      const sorted = [...group.rows].sort((a, b) => number(a.OpSeq) - number(b.OpSeq));
      for (const source of sorted) {
        const operationKey = source._operationKey;
        const operationId = stableId("wodjo", companyId, operationKey);
        const definition = operationDefs.get(text(source.OpDesc)) || operationDefs.get(text(source.OpSeq)) || { processId: await ensureProcess(source.OpDesc), workCenterId: null };
        const hours = hoursByOperation.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || { work: 0, prep: 0 };
        const qty = number(source.Qty);
        const qualified = number(source.QualifiedInQty);
        const status = number(source.Status) === 4 && (qualified >= qty || text(source.OpDesc) === "领料工作中心") ? "Done" : number(source.Status) === 3 ? "In Progress" : "Ready";
        operationRows.push([
          operationId, job.id, job.makeMethodId, number(source.OpSeq, 1), definition.processId, definition.workCenterId,
          text(source.OpDesc, "WodiMES 工序"), hours.prep, hours.work, hours.work, "After Previous", companyId, CREATED_BY,
          qty, qualified, status, 1, json({ wodiMES: safePayload(source) })
        ]);
        operationMap.set(operationKey, operationId);
        const readableKey = `${text(source.MoCode)}:${text(source.OpSeq)}`;
        if (!operationByReadableKey.has(readableKey) || !operationKey.includes(":duplicate:")) {
          operationByReadableKey.set(readableKey, operationId);
        }
        externalRows.push([stableId("wodext", companyId, "mes_proc_order_details", text(source._sourceId), "jobOperation"), companyId, "mes_proc_order_details", text(source._sourceId), operationKey, "jobOperation", operationId, null, CREATED_BY]);
      }
    }
    await insertBatch(client, "jobOperation", ["id", "jobId", "jobMakeMethodId", "order", "processId", "workCenterId", "description", "setupTime", "laborTime", "machineTime", "operationOrder", "companyId", "createdBy", "operationQuantity", "quantityComplete", "status", "priority", "customFields"], operationRows, '("id")', ["description", "processId", "workCenterId", "setupTime", "laborTime", "machineTime", "operationQuantity", "quantityComplete", "status", "customFields", "updatedAt"]);

    const dependencyRows = [];
    for (const group of procGroups.values()) {
      const sorted = [...group.rows].sort((a, b) => number(a.OpSeq) - number(b.OpSeq));
      let previous = null;
      for (const source of sorted) {
        const current = operationMap.get(source._operationKey);
        if (current && previous && current !== previous) dependencyRows.push([current, previous, jobMap.get(group.key).id, companyId]);
        if (current) previous = current;
      }
    }
    await insertBatch(client, "jobOperationDependency", ["operationId", "dependsOnId", "jobId", "companyId"], dependencyRows, "DO NOTHING");

    const existingProcHours = await client.query(
      `SELECT id, "moDId", "opSeq", "operationId" FROM "wodiMESProcHour" WHERE "companyId" = $1`,
      [companyId]
    );
    const procHourByNaturalKey = new Map(existingProcHours.rows.map((row) => [`${row.moDId}:${row.opSeq}:${row.operationId}`, row.id]));
    const procHourRows = [];
    for (const row of sourceDocs.get("mes_proc_hours") || []) {
      const source = row.document;
      const naturalKey = `${text(source.MoDId)}:${text(source.OpSeq)}:${text(source.OperationId)}`;
      procHourRows.push([
        procHourByNaturalKey.get(naturalKey) || stableId("wodph", companyId, row.id), companyId, row.id,
        operationMap.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || null,
        text(source.MoCode), text(source.MoDId), text(source.OpSeq), text(source.OperationId), number(source.work_hour), number(source.prep_hour), json(safePayload(source)), CREATED_BY
      ]);
    }
    await insertBatch(client, "wodiMESProcHour", ["id", "companyId", "sourceId", "jobOperationId", "moCode", "moDId", "opSeq", "operationId", "workHour", "prepHour", "payload", "createdBy"], procHourRows, '("id")', ["sourceId", "jobOperationId", "moCode", "moDId", "opSeq", "operationId", "workHour", "prepHour", "payload", "updatedAt"]);

    for (const collectionName of ["mes_machines", "mes_equipment"]) {
      for (const row of sourceDocs.get(collectionName) || []) await ensureResource(collectionName, row.document);
    }

    const assignmentRows = [];
    for (const collectionName of ["mes_worker_tasks", "mes_tasks"]) {
      for (const row of sourceDocs.get(collectionName) || []) {
        const source = row.document;
        const opId = operationMap.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || operationByReadableKey.get(`${text(source.mo_code || source.MoCode)}:${text(source.op_seq || source.OpSeq)}`) || null;
        const username = text(source.assignee || source.worker || source.worker_id);
        const employeeId = username ? employeeMap.get(username) || null : null;
        const machineCode = text(source.machine_code);
        const resourceId = machineCode
          ? resourceCodeMap.get(`mes_machines:${machineCode}`) || resourceCodeMap.get(`mes_equipment:${machineCode}`) || null
          : null;
        assignmentRows.push([
          stableId("wodassign", companyId, collectionName, row.id), companyId, row.id, opId, employeeId, resourceId,
          number(source.assigned_qty || source.assignedQty || source.Qty || source.planned_qty), number(source.completed_qty || source.completedQty),
          source.priority === "urgent" ? "Urgent" : "Normal", text(source.task_status || source.status, "Assigned"), Boolean(source.is_rework), text(source.original_task_id), date(source.assigned_date || source.created_at || source.created), json(safePayload(source)), CREATED_BY
        ]);
      }
    }
    await insertBatch(client, "wodiMESAssignment", ["id", "companyId", "sourceId", "jobOperationId", "employeeId", "resourceId", "assignedQuantity", "completedQuantity", "priority", "status", "isRework", "originalSourceId", "assignedAt", "payload", "createdBy"], assignmentRows, '("sourceId", "companyId")', ["jobOperationId", "employeeId", "resourceId", "assignedQuantity", "completedQuantity", "priority", "status", "payload", "updatedAt"]);

    const assignmentBySource = new Map(assignmentRows.map((row) => [row[2], row[0]]));
    const reportRows = [];
    const inspectionRows = [];
    const productionRows = [];
    for (const collectionName of ["mes_production_reports", "mes_work_records"]) {
      for (const row of sourceDocs.get(collectionName) || []) {
        const source = row.document;
        const opId = operationMap.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || operationByReadableKey.get(`${text(source.mo_code || source.MoCode)}:${text(source.op_seq || source.OpSeq)}`) || null;
        const username = text(source.worker || source.reporter || source.reported_by);
        const employeeId = username ? employeeMap.get(username) || null : null;
        const reported = number(source.qty || source.report_qty || source.reported_qty);
        const accepted = number(source.qc_qualified_qty || source.qualified_qty || source.accepted_qty);
        const rejected = number(source.qc_rejected_qty || source.scrap_qty || source.rejected_qty);
        const status = source.cancelled ? "Cancelled" : accepted || rejected || String(source.status || "").toLowerCase().includes("approved") ? "Approved" : "PendingInspection";
        const reportId = stableId("wodreport", companyId, collectionName, row.id);
        reportRows.push([
          reportId, companyId, row.id, assignmentBySource.get(text(source.task_id)) || null, opId, employeeId, reported, accepted, rejected,
          status, number(source.actual_hour || source.actual_hours, null), null, text(source.reason || source.qc_reason), date(source.report_date || source.created_at || source.created), date(source.qc_time || source.inspected_at), Boolean(source.cancelled), date(source.cancelled_at), text(source.cancel_reason), json(safePayload(source)), CREATED_BY
        ]);
        inspectionRows.push([
          stableId("wodinspect", companyId, collectionName, row.id), companyId, row.id, reportId, opId, null,
          status === "Approved" ? "Approved" : "Pending", reported, null, accepted, rejected, status === "Approved" ? (rejected ? "PartiallyAccepted" : "Accepted") : null,
          text(source.reason || source.qc_reason), json({ source: safePayload(source) }), date(source.qc_time || source.inspected_at), json(safePayload(source)), CREATED_BY
        ]);
        if (opId && accepted > 0) productionRows.push([stableId("wodpq", companyId, collectionName, row.id, "production"), opId, "Production", accepted, companyId, CREATED_BY, text(source.reason || "WodiMES approved report")]);
        if (opId && rejected > 0) productionRows.push([stableId("wodpq", companyId, collectionName, row.id, "scrap"), opId, "Scrap", rejected, companyId, CREATED_BY, text(source.reason || "WodiMES rejected report")]);
      }
    }
    await insertBatch(client, "wodiMESReport", ["id", "companyId", "sourceId", "assignmentId", "jobOperationId", "employeeId", "reportedQuantity", "acceptedQuantity", "rejectedQuantity", "status", "actualHours", "inspectorId", "qcReason", "reportedAt", "inspectedAt", "cancelled", "cancelledAt", "cancelReason", "payload", "createdBy"], reportRows, '("sourceId", "companyId")', ["jobOperationId", "employeeId", "reportedQuantity", "acceptedQuantity", "rejectedQuantity", "status", "inspectedAt", "cancelled", "payload", "updatedAt"]);
    await insertBatch(client, "wodiMESInspection", ["id", "companyId", "sourceId", "reportId", "jobOperationId", "inspectorId", "status", "submittedQuantity", "sampledQuantity", "acceptedQuantity", "rejectedQuantity", "result", "reason", "criteriaSnapshot", "inspectedAt", "payload", "createdBy"], inspectionRows, '("sourceId", "companyId")', ["reportId", "jobOperationId", "status", "acceptedQuantity", "rejectedQuantity", "result", "reason", "inspectedAt", "payload", "updatedAt"]);
    await insertBatch(client, "productionQuantity", ["id", "jobOperationId", "type", "quantity", "companyId", "createdBy", "notes"], productionRows, '("id")', ["quantity", "notes", "updatedAt"]);

    const feedbackRows = [];
    for (const row of sourceDocs.get("mes_task_feedback") || []) {
      const source = row.document;
      const opId = operationMap.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || null;
      feedbackRows.push([stableId("wodfeedback", companyId, row.id), companyId, row.id, null, opId, text(source.type || source.feedback_type, "General"), text(source.content || source.message || source.description, "WodiMES feedback"), text(source.status, "Open"), employeeMap.get(text(source.reporter || source.reported_by)) || null, text(source.assignee), text(source.resolution), json(safePayload(source)), CREATED_BY]);
    }
    await insertBatch(client, "wodiMESFeedback", ["id", "companyId", "sourceId", "assignmentId", "jobOperationId", "type", "content", "status", "reportedBy", "assignee", "resolution", "payload", "createdBy"], feedbackRows, '("sourceId", "companyId")', ["jobOperationId", "status", "resolution", "payload", "updatedAt"]);

    const supplementRows = [];
    for (const row of sourceDocs.get("mes_material_supplements") || []) {
      const source = row.document;
      const opId = operationMap.get(`${text(source.MoDId)}:${text(source.OpSeq)}`) || null;
      const itemId = itemMap.get(text(source.InvCode || source.material_code)) || null;
      supplementRows.push([stableId("wodsupp", companyId, row.id), companyId, row.id, opId ? jobMap.get(text(source.MoDId))?.id || null : null, opId, itemId, number(source.supplement_qty || source.quantity), await ensureUom(source.unit), text(source.reason), text(source.requester || source.created_by), text(source.approver), json(safePayload(source)), CREATED_BY]);
    }
    await insertBatch(client, "wodiMESMaterialSupplement", ["id", "companyId", "sourceId", "jobId", "jobOperationId", "itemId", "quantity", "unitOfMeasureCode", "reason", "requester", "approver", "payload", "createdBy"], supplementRows, '("sourceId", "companyId")', ["jobId", "jobOperationId", "itemId", "quantity", "payload", "updatedAt"]);

    const inventoryRows = [];
    for (const row of sourceDocs.get("mes_inventory") || []) {
      const source = row.document;
      const code = text(source.uf_inv_code || source.material_code);
      inventoryRows.push([stableId("wodinv", companyId, row.id), companyId, row.id, itemMap.get(code) || await ensureItem(code, source.material_name, "件", "mes_inventory", row.id), defaultLocationId, number(source.quantity), text(source.location), date(source.modified || source.created), json(safePayload(source)), CREATED_BY]);
    }
    await insertBatch(client, "wodiMESInventorySnapshot", ["id", "companyId", "sourceId", "itemId", "locationId", "quantity", "sourceLocation", "capturedAt", "payload", "createdBy"], inventoryRows, '("sourceId", "companyId")', ["itemId", "quantity", "sourceLocation", "capturedAt", "payload", "updatedAt"]);

    const maintenanceRows = [];
    for (const row of sourceDocs.get("mes_equipment_faults") || []) {
      const source = row.document;
      const equipmentCode = text(source.equipment_code);
      const resourceId = equipmentCode
        ? resourceCodeMap.get(`mes_equipment:${equipmentCode}`) || resourceCodeMap.get(`mes_machines:${equipmentCode}`) || null
        : null;
      const workCenterId = resourceId ? resourceWorkCenterMap.get(resourceId) || null : null;
      if (!workCenterId) continue;
      maintenanceRows.push([
        stableId("wodmaint", companyId, row.id), `WODI-${text(source.equipment_code, row.id)}`, json({ source: safePayload(source) }), text(source.status).toLowerCase().includes("closed") ? "Completed" : "Open", "Medium", "Reactive", workCenterId,
        date(source.reported_at), date(source.repaired_at), companyId, CREATED_BY, "Impact", "Support Required"
      ]);
    }
    await insertBatch(client, "maintenanceDispatch", ["id", "maintenanceDispatchId", "content", "status", "priority", "source", "workCenterId", "actualStartTime", "actualEndTime", "companyId", "createdBy", "oeeImpact", "severity"], maintenanceRows, '("id")', ["content", "status", "actualStartTime", "actualEndTime", "updatedAt"]);

    const currentResourceIds = [...new Set(resourceMap.values())];
    if (!DRY_RUN && currentResourceIds.length) {
      await client.query(
        `DELETE FROM "wodiMESExternalEntity" WHERE "companyId" = $1 AND "entityType" = 'wodiMESResource'`,
        [companyId]
      );
      await client.query(
        `DELETE FROM "wodiMESResource" r
         WHERE r."companyId" = $1
           AND r."sourceCollection" = ANY($2::text[])
           AND NOT (r.id = ANY($3::text[]))
           AND NOT EXISTS (SELECT 1 FROM "wodiMESAssignment" a WHERE a."resourceId" = r.id)
           AND NOT EXISTS (SELECT 1 FROM "wodiMESResourcePresence" p WHERE p."resourceId" = r.id)`,
        [companyId, ["mes_machines", "mes_equipment", "mes_workshops"], currentResourceIds]
      );
    }

    for (const [collectionName, signature] of sourceSignatures) {
      const currentSignature = await getCollectionSignature(mongo, collectionName);
      if (currentSignature !== signature) {
        throw new Error(`Source collection changed during import: ${collectionName}`);
      }
    }

    const uniqueExternalRows = [...new Map(externalRows.map((row) => [`${row[1]}:${row[5]}:${row[4]}`, row])).values()];
    await insertBatch(client, "wodiMESExternalEntity", ["id", "companyId", "sourceCollection", "sourceId", "externalKey", "entityType", "carbonEntityId", "payloadHash", "createdBy"], uniqueExternalRows, '("entityType", "externalKey", "companyId")', ["sourceCollection", "sourceId", "carbonEntityId", "payloadHash", "updatedAt"]);

    const targetCounts = {
      jobs: procGroups.size,
      operations: operationRows.length,
      reports: reportRows.length,
      inspections: inspectionRows.length,
      mappings: uniqueExternalRows.length
    };
    if (!DRY_RUN) {
      await client.query(
        `UPDATE "wodiMESSyncRun" SET "status" = 'Completed', "finishedAt" = clock_timestamp(), "sourceCounts" = $1::jsonb, "targetCounts" = $2::jsonb, "errorCount" = 0 WHERE "id" = $3`,
        [json(counters), json(targetCounts), runId]
      );
      await client.query(ROLLBACK_ONLY ? "ROLLBACK" : "COMMIT");
      transactionStarted = false;
    }
    console.log(JSON.stringify({ ok: true, dryRun: DRY_RUN, rollback: ROLLBACK_ONLY, sourceCounts: counters, targetCounts }, null, 2));
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("WodiMES rollback failed:", rollbackError.message);
      }
      transactionStarted = false;
    }
    if (!DRY_RUN && !ROLLBACK_ONLY && companyId && runId) {
      try {
        await client.query(
          `INSERT INTO "wodiMESSyncRun" ("id", "companyId", "status", "finishedAt", "sourceCounts", "errorCount", "createdBy")
           VALUES ($1, $2, 'Failed', clock_timestamp(), $3::jsonb, 1, $4)
           ON CONFLICT ("id") DO UPDATE SET "status" = 'Failed', "finishedAt" = clock_timestamp(), "sourceCounts" = EXCLUDED."sourceCounts", "errorCount" = 1`,
          [runId, companyId, json(counters), CREATED_BY]
        );
        await client.query(
          `INSERT INTO "wodiMESSyncError" ("id", "syncRunId", "companyId", "sourceCollection", "errorCode", "message", "createdBy")
           VALUES ($1, $2, $3, 'import', 'IMPORT_FAILED', $4, $5)
           ON CONFLICT ("id") DO NOTHING`,
          [stableId("woderr", runId, "import"), runId, companyId, String(error.message || error).slice(0, 2000), CREATED_BY]
        );
      } catch (statusError) {
        console.error("WodiMES failure status could not be recorded:", statusError.message);
      }
    }
    console.error("WodiMES import failed:", error.stack || error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
    await mongoClient.close();
  }
}

main().catch(() => process.exit(1));
