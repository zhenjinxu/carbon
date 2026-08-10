#!/usr/bin/env node
/**
 * Direct, read-only U8 production-order import for Carbon.
 *
 * Usage:
 *   node scripts/import-u8-work-orders.cjs --company-id <id> --user-id <id> --trigger Manual
 *   node scripts/import-u8-work-orders.cjs --company-id <id> --user-id <id> --trigger Scheduled
 *   node scripts/import-u8-work-orders.cjs --company-id <id> --user-id <id> --dry-run
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getU8OperationKey } = require("./lib/u8-work-order-identity.cjs");

const CARBON_ROOT = path.resolve(__dirname, "..");

const SOURCE_ROOT = path.resolve(
  process.env.WODIMES_SOURCE_ROOT || process.env.U8_CONNECTOR_SOURCE_ROOT || "D:/Object/0.1.7"
);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

const sourceEnv = loadEnv(path.join(SOURCE_ROOT, ".env"));
const carbonEnv = {
  ...loadEnv(path.join(CARBON_ROOT, ".env")),
  ...loadEnv(path.join(CARBON_ROOT, ".env.local"))
};

const pgModulePath = path.join(
  CARBON_ROOT,
  "packages",
  "database",
  "node_modules",
  "pg"
);
const { Pool } = require(pgModulePath);
const mssql = require("mssql");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const COMPANY_ID = argument("--company-id") || process.env.U8_CARBON_COMPANY_ID;
const USER_ID = argument("--user-id") || process.env.U8_CARBON_USER_ID;
const TRIGGER_TYPE = argument("--trigger") || "Manual";
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

if (!COMPANY_ID) throw new Error("Missing --company-id.");
if (!USER_ID) throw new Error("Missing --user-id.");
if (!["Manual", "Scheduled"].includes(TRIGGER_TYPE)) {
  throw new Error("--trigger must be Manual or Scheduled.");
}

const CARBON_DB_URL =
  process.env.SUPABASE_DB_URL || carbonEnv.SUPABASE_DB_URL;
if (!CARBON_DB_URL) throw new Error("SUPABASE_DB_URL is not configured.");

const requiredU8 = ["U8_SERVER", "U8_DATABASE", "U8_USER", "U8_PASSWORD"];
for (const key of requiredU8) {
  if (!(process.env[key] || sourceEnv[key])) {
    throw new Error(key + " is not configured.");
  }
}

const U8 = {
  server: process.env.U8_SERVER || sourceEnv.U8_SERVER,
  database: process.env.U8_DATABASE || sourceEnv.U8_DATABASE,
  user: process.env.U8_USER || sourceEnv.U8_USER,
  password: process.env.U8_PASSWORD || sourceEnv.U8_PASSWORD,
  port: Number(process.env.U8_PORT || sourceEnv.U8_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 10000,
  requestTimeout: 180000
};

const qident = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const text = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
};
const number = (value, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const hash = (...parts) =>
  crypto
    .createHash("sha1")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 24);
const stableId = (prefix, ...parts) => prefix + "_" + hash(...parts);
const json = (value) => JSON.stringify(value ?? {});
const dateOnly = (value) => {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime())
    ? null
    : result.toISOString().slice(0, 10);
};

async function insertBatch(
  client,
  table,
  columns,
  rows,
  conflict,
  updateColumns = []
) {
  if (rows.length === 0 || DRY_RUN) return;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return "$" + values.length;
      });
      return "(" + placeholders.join(", ") + ")";
    });
    const update =
      updateColumns.length > 0
        ? " DO UPDATE SET " +
          updateColumns
            .map((column) => {
              if (column === "customFields") {
                return (
                  qident(column) +
                  " = COALESCE(" +
                  qident(table) +
                  "." +
                  qident(column) +
                  ", '{}'::jsonb) || EXCLUDED." +
                  qident(column)
                );
              }
              if (column === "updatedAt") {
                return qident(column) + " = NOW()";
              }
              return qident(column) + " = EXCLUDED." + qident(column);
            })
            .join(", ")
        : "";
    const query =
      "INSERT INTO " +
      qident(table) +
      " (" +
      columns.map(qident).join(", ") +
      ") VALUES " +
      tuples.join(", ") +
      " ON CONFLICT " +
      conflict +
      update;
    await client.query(query, values);
  }
}

function normalizedConfig(row) {
  return {
    enabled: row?.enabled === true,
    intervalMinutes: number(row?.intervalMinutes, 5),
    customerNames: Array.isArray(row?.customerNames) ? row.customerNames : [],
    moCodes: Array.isArray(row?.moCodes) ? row.moCodes : [],
    soCodes: Array.isArray(row?.soCodes) ? row.soCodes : [],
    startDate: dateOnly(row?.startDate),
    endDate: dateOnly(row?.endDate),
    configVersion: number(row?.configVersion, 1)
  };
}

function addListFilter(request, conditions, column, values, prefix) {
  if (values.length === 0) return;
  const names = values.map((value, index) => {
    const name = prefix + index;
    request.input(name, mssql.NVarChar(255), value);
    return "@" + name;
  });
  conditions.push(column + " IN (" + names.join(", ") + ")");
}

async function readU8(config) {
  const pool = await new mssql.ConnectionPool(U8).connect();
  try {
    const request = pool.request();
    const conditions = [];
    addListFilter(
      request,
      conditions,
      "c.cCusName",
      config.customerNames,
      "customer"
    );
    addListFilter(request, conditions, "v.MoCode", config.moCodes, "moCode");
    addListFilter(request, conditions, "v.SoCode", config.soCodes, "soCode");
    if (config.startDate) {
      request.input("startDate", mssql.Date, config.startDate);
      conditions.push("CAST(v.StartDate AS date) >= @startDate");
    }
    if (config.endDate) {
      request.input("endDate", mssql.Date, config.endDate);
      conditions.push("CAST(v.StartDate AS date) <= @endDate");
    }
    const where =
      conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
    const baseQuery =
      "SELECT v.MoCode, v.MoSeq, v.OpSeq AS CurrentOpSeq, " +
      "v.OpDesc AS CurrentOpDesc, v.InvCode, v.InvName, v.InvStd, " +
      "v.Qty, v.QualifiedInQty, v.Status, v.SfcFlag, v.WIPType, " +
      "v.SoCode, v.DeptName, v.WhName, v.StartDate, v.DueDate, " +
      "v.Maker, v.MoDId, v.MoId, v.PartId, v.Define28, v.Define31, " +
      "c.cCusCode AS CustomerCode, c.cCusName AS CustomerName, m.RoutingId " +
      "FROM dbo.v_mom_orderdetail_ProcColMoIn v " +
      "LEFT JOIN dbo.mom_orderdetail m ON v.MoDId = m.MoDId " +
      "LEFT JOIN dbo.SO_SOMain s ON v.SoCode = s.cSoCode " +
      "LEFT JOIN dbo.Customer c ON s.cCusCode = c.cCusCode" +
      where +
      " ORDER BY v.MoDId, v.MoCode";
    const viewRows = (await request.query(baseQuery)).recordset;

    const routingIds = [
      ...new Set(viewRows.map((row) => row.RoutingId).filter(Boolean))
    ];
    const routingMap = new Map();
    for (let offset = 0; offset < routingIds.length; offset += BATCH_SIZE) {
      const batch = routingIds.slice(offset, offset + BATCH_SIZE);
      const detailRequest = pool.request();
      const parameters = batch.map((value, index) => {
        const name = "routing" + index;
        detailRequest.input(name, mssql.Int, number(value));
        return "@" + name;
      });
      const details = (
        await detailRequest.query(
          "SELECT PRoutingId, OpSeq, OperationId " +
            "FROM dbo.sfc_proutingdetail WHERE PRoutingId IN (" +
            parameters.join(", ") +
            ") ORDER BY PRoutingId, OpSeq"
        )
      ).recordset;
      for (const detail of details) {
        const key = String(detail.PRoutingId);
        const rows = routingMap.get(key) || [];
        rows.push(detail);
        routingMap.set(key, rows);
      }
    }

    const operationDefinitions = new Map();
    const operations = (
      await pool
        .request()
        .query(
          "SELECT OperationId, Description, OpCode FROM dbo.sfc_operation"
        )
    ).recordset;
    for (const operation of operations) {
      operationDefinitions.set(String(operation.OperationId), operation);
    }

    const expanded = [];
    for (const source of viewRows) {
      const steps = routingMap.get(String(source.RoutingId)) || [];
      if (steps.length === 0) {
        expanded.push({
          ...source,
          OpSeq: text(source.CurrentOpSeq, "1"),
          OpDesc: text(source.CurrentOpDesc, "U8 工序"),
          IsCurrentStep: true
        });
        continue;
      }
      for (const step of steps) {
        const definition = operationDefinitions.get(String(step.OperationId));
        expanded.push({
          ...source,
          OpSeq: text(step.OpSeq, "1"),
          OpDesc: text(
            definition?.Description,
            text(source.CurrentOpDesc, "U8 工序")
          ),
          OperationId: text(step.OperationId),
          IsCurrentStep:
            text(step.OpSeq) === text(source.CurrentOpSeq)
        });
      }
    }
    return { sourceRows: viewRows, expandedRows: expanded };
  } finally {
    await pool.close();
  }
}

async function importRows(client, config, sourceRows, expandedRows) {
  const defaultLocation = await client.query(
    'SELECT id FROM "location" WHERE "companyId" = $1 ORDER BY "createdAt" LIMIT 1',
    [COMPANY_ID]
  );
  if (!defaultLocation.rows[0]?.id) {
    throw new Error("The Carbon company has no location.");
  }
  const defaultLocationId = defaultLocation.rows[0].id;

  const uomMap = new Map(
    (
      await client.query(
        'SELECT code FROM "unitOfMeasure" WHERE "companyId" = $1',
        [COMPANY_ID]
      )
    ).rows.map((row) => [row.code, row.code])
  );
  const itemMap = new Map(
    (
      await client.query(
        'SELECT id, "readableId" FROM "item" WHERE "companyId" = $1',
        [COMPANY_ID]
      )
    ).rows.map((row) => [row.readableId, row.id])
  );
  const processMap = new Map(
    (
      await client.query(
        'SELECT id, name FROM "process" WHERE "companyId" = $1',
        [COMPANY_ID]
      )
    ).rows.map((row) => [row.name, row.id])
  );

  async function ensureUom(rawUnit) {
    const name = text(rawUnit, "件");
    const code = "WODI_" + hash(name).slice(0, 10);
    if (uomMap.has(code)) return code;
    if (!DRY_RUN) {
      await client.query(
        'INSERT INTO "unitOfMeasure" ("id", "code", "name", "companyId", "createdBy") ' +
          'VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [stableId("woduom", COMPANY_ID, code), code, name, COMPANY_ID, USER_ID]
      );
    }
    uomMap.set(code, code);
    return code;
  }

  async function ensureItem(source) {
    const readableId = text(source.InvCode, "U8-" + hash(source.MoDId));
    if (itemMap.has(readableId)) return itemMap.get(readableId);
    const id = stableId("wodiitem", COMPANY_ID, readableId, "Part");
    const uom = await ensureUom("件");
    if (!DRY_RUN) {
      await client.query(
        'INSERT INTO "item" ("id", "readableId", "name", "type", "itemTrackingType", ' +
          '"unitOfMeasureCode", "companyId", "createdBy", "revision", "notes") ' +
          "VALUES ($1, $2, $3, 'Part', 'Inventory', $4, $5, $6, '0', $7::jsonb) " +
          'ON CONFLICT ("readableId", "revision", "companyId", "type") DO UPDATE SET ' +
          'name = EXCLUDED.name, "unitOfMeasureCode" = EXCLUDED."unitOfMeasureCode"',
        [
          id,
          readableId,
          text(source.InvName, readableId),
          uom,
          COMPANY_ID,
          USER_ID,
          json({ u8: { itemCode: readableId } })
        ]
      );
    }
    itemMap.set(readableId, id);
    return id;
  }

  async function ensureProcess(rawName) {
    const name = text(rawName, "U8 工序");
    if (processMap.has(name)) return processMap.get(name);
    const id = stableId("wodiprocess", COMPANY_ID, name);
    if (!DRY_RUN) {
      await client.query(
        'INSERT INTO "process" ("id", "name", "defaultStandardFactor", "companyId", "createdBy", "active") ' +
          "VALUES ($1, $2, 'Minutes/Piece', $3, $4, true) " +
          'ON CONFLICT ("name", "companyId") DO UPDATE SET active = true',
        [id, name, COMPANY_ID, USER_ID]
      );
    }
    processMap.set(name, id);
    return id;
  }

  const existingJobs = new Set(
    (
      await client.query(
        "SELECT \"customFields\"->'wodiMES'->>'sourceMoDId' AS key " +
          'FROM "job" WHERE "companyId" = $1 ' +
          "AND \"customFields\"->'wodiMES'->>'sourceMoDId' IS NOT NULL",
        [COMPANY_ID]
      )
    ).rows.map((row) => row.key)
  );

  const groups = new Map();
  for (const row of expandedRows) {
    const key = text(row.MoDId);
    if (!key) continue;
    const group = groups.get(key) || {
      first: row,
      rows: [],
      allComplete: true,
      hasInProgress: false,
      maxQualified: 0
    };
    group.rows.push(row);
    const quantity = number(row.Qty);
    const qualified = number(row.QualifiedInQty);
    group.maxQualified = Math.max(group.maxQualified, qualified);
    if (number(row.Status) !== 4) group.allComplete = false;
    if (number(row.Status) === 3) group.hasInProgress = true;
    if (
      number(row.Status) === 4 &&
      qualified < quantity &&
      text(row.OpDesc) !== "领料工作中心"
    ) {
      group.allComplete = false;
    }
    groups.set(key, group);
  }

  const jobRows = [];
  const methodRows = [];
  const operationRows = [];
  const dependencyRows = [];
  const overviewRows = [];
  const externalRows = [];

  for (const [moDId, group] of groups) {
    const first = group.first;
    const jobId = stableId("wodjob", COMPANY_ID, moDId);
    const readableJobId =
      "WODI-" + text(first.MoCode, moDId) + "-" + moDId;
    const itemId = await ensureItem(first);
    const unit = await ensureUom("件");
    const makeMethodId = stableId("wodjmm", COMPANY_ID, moDId);
    const sourceStatus = group.allComplete
      ? "Completed"
      : group.hasInProgress
        ? "In Progress"
        : "Planned";
    const summary = {
      sourceMoDId: moDId,
      sourceMoCode: text(first.MoCode),
      sourceStatus,
      itemCode: text(first.InvCode),
      customerName: text(first.CustomerName),
      salesOrderCode: text(first.SoCode)
    };
    jobRows.push([
      jobId,
      readableJobId,
      "U8 ERP",
      itemId,
      unit,
      defaultLocationId,
      sourceStatus,
      number(first.Qty),
      group.maxQualified,
      COMPANY_ID,
      USER_ID,
      dateOnly(first.StartDate),
      dateOnly(first.DueDate),
      json({ wodiMES: summary })
    ]);
    methodRows.push([
      makeMethodId,
      jobId,
      itemId,
      COMPANY_ID,
      USER_ID,
      json({ wodiMES: { sourceMoDId: moDId } })
    ]);
    overviewRows.push([
      stableId("u8wo", COMPANY_ID, moDId),
      COMPANY_ID,
      jobId,
      moDId,
      text(first.MoCode, readableJobId),
      text(first.SoCode),
      text(first.CustomerCode),
      text(first.CustomerName),
      text(first.DeptName),
      text(first.Define28, text(first.Maker)),
      text(first.InvCode),
      text(first.InvName),
      text(first.Status),
      number(first.Qty),
      group.maxQualified,
      dateOnly(first.StartDate),
      dateOnly(first.DueDate),
      hash(json(first)),
      USER_ID
    ]);
    externalRows.push([
      stableId("wodext", COMPANY_ID, "U8", moDId, "job"),
      COMPANY_ID,
      "U8",
      moDId,
      moDId,
      "job",
      jobId,
      hash(json(first)),
      USER_ID
    ]);

    const sorted = [...group.rows].sort(
      (left, right) => number(left.OpSeq) - number(right.OpSeq)
    );
    let previous = null;
    for (const source of sorted) {
      const opSeq = text(source.OpSeq, "1");
      const operationKey = getU8OperationKey({
        sourceMoDId: moDId,
        operationSequence: opSeq,
        sourceOperationId: text(source.OperationId)
      });
      const operationId = stableId("wodjo", COMPANY_ID, operationKey);
      const processId = await ensureProcess(source.OpDesc);
      const quantity = number(source.Qty);
      const qualified = number(source.QualifiedInQty);
      const status =
        number(source.Status) === 4 &&
        (qualified >= quantity || text(source.OpDesc) === "领料工作中心")
          ? "Done"
          : number(source.Status) === 3 && source.IsCurrentStep
            ? "In Progress"
            : "Ready";
      operationRows.push([
        operationId,
        jobId,
        makeMethodId,
        number(opSeq, 1),
        processId,
        text(source.OpDesc, "U8 工序"),
        "After Previous",
        COMPANY_ID,
        USER_ID,
        quantity,
        qualified,
        status,
        1,
        json({ wodiMES: source })
      ]);
      externalRows.push([
        stableId("wodext", COMPANY_ID, "U8", operationKey, "jobOperation"),
        COMPANY_ID,
        "U8",
        operationKey,
        operationKey,
        "jobOperation",
        operationId,
        hash(json(source)),
        USER_ID
      ]);
      if (previous && previous !== operationId) {
        dependencyRows.push([
          operationId,
          previous,
          jobId,
          COMPANY_ID
        ]);
      }
      previous = operationId;
    }
  }

  await insertBatch(
    client,
    "job",
    [
      "id",
      "jobId",
      "source",
      "itemId",
      "unitOfMeasureCode",
      "locationId",
      "status",
      "quantity",
      "quantityComplete",
      "companyId",
      "createdBy",
      "startDate",
      "dueDate",
      "customFields"
    ],
    jobRows,
    '("id")',
    ["source", "itemId", "unitOfMeasureCode", "quantity", "startDate", "dueDate", "customFields", "updatedAt"]
  );
  await insertBatch(
    client,
    "jobMakeMethod",
    ["id", "jobId", "itemId", "companyId", "createdBy", "customFields"],
    methodRows,
    '("id")',
    ["itemId", "customFields", "updatedAt"]
  );
  await insertBatch(
    client,
    "jobOperation",
    [
      "id",
      "jobId",
      "jobMakeMethodId",
      "order",
      "processId",
      "description",
      "operationOrder",
      "companyId",
      "createdBy",
      "operationQuantity",
      "quantityComplete",
      "status",
      "priority",
      "customFields"
    ],
    operationRows,
    '("id")',
    ["description", "processId", "operationQuantity", "customFields", "updatedAt"]
  );
  await insertBatch(
    client,
    "jobOperationDependency",
    ["operationId", "dependsOnId", "jobId", "companyId"],
    dependencyRows,
    "DO NOTHING"
  );
  await insertBatch(
    client,
    "u8WorkOrder",
    [
      "id",
      "companyId",
      "jobId",
      "sourceMoDId",
      "moCode",
      "salesOrderCode",
      "customerCode",
      "customerName",
      "departmentName",
      "personInCharge",
      "itemCode",
      "itemName",
      "sourceStatus",
      "plannedQuantity",
      "sourceQualifiedQuantity",
      "plannedStartDate",
      "dueDate",
      "payloadHash",
      "createdBy"
    ],
    overviewRows,
    '("sourceMoDId", "companyId")',
    [
      "jobId",
      "moCode",
      "salesOrderCode",
      "customerCode",
      "customerName",
      "departmentName",
      "personInCharge",
      "itemCode",
      "itemName",
      "sourceStatus",
      "plannedQuantity",
      "sourceQualifiedQuantity",
      "plannedStartDate",
      "dueDate",
      "payloadHash",
      "updatedAt"
    ]
  );
  await insertBatch(
    client,
    "wodiMESExternalEntity",
    [
      "id",
      "companyId",
      "sourceCollection",
      "sourceId",
      "externalKey",
      "entityType",
      "carbonEntityId",
      "payloadHash",
      "createdBy"
    ],
    externalRows,
    '("entityType", "externalKey", "companyId")',
    ["sourceCollection", "sourceId", "carbonEntityId", "payloadHash", "updatedAt"]
  );

  return {
    scanned: sourceRows.length,
    inserted: [...groups.keys()].filter((key) => !existingJobs.has(key)).length,
    updated: [...groups.keys()].filter((key) => existingJobs.has(key)).length,
    skipped: sourceRows.length - groups.size,
    jobs: groups.size,
    operations: operationRows.length
  };
}

async function main() {
  const pool = new Pool({
    connectionString: CARBON_DB_URL,
    max: 1,
    ssl: CARBON_DB_URL.includes("localhost")
      ? false
      : { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  let locked = false;
  let runId = null;
  let config = normalizedConfig(null);
  try {
    const configResult = await client.query(
      'SELECT * FROM "u8WorkOrderImportConfig" WHERE "companyId" = $1',
      [COMPANY_ID]
    );
    config = normalizedConfig(configResult.rows[0]);
    if (TRIGGER_TYPE === "Scheduled" && !config.enabled) {
      console.log("U8 work-order import is stopped for this company.");
      return;
    }

    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      ["u8-work-order-import:" + COMPANY_ID]
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) {
      console.log("Another U8 work-order import is already running.");
      return;
    }

    runId = stableId(
      "u8run",
      COMPANY_ID,
      new Date().toISOString(),
      crypto.randomUUID()
    );
    if (!DRY_RUN) {
      await client.query(
        'INSERT INTO "wodiMESSyncRun" ' +
          '("id", "companyId", "source", "status", "triggerType", "filterSnapshot", "configVersion", "heartbeatAt", "createdBy") ' +
          "VALUES ($1, $2, 'U8', 'Running', $3, $4::jsonb, $5, NOW(), $6)",
        [
          runId,
          COMPANY_ID,
          TRIGGER_TYPE,
          json(config),
          config.configVersion,
          USER_ID
        ]
      );
    }

    const { sourceRows, expandedRows } = await readU8(config);
    await client.query("BEGIN");
    const result = await importRows(
      client,
      config,
      sourceRows,
      expandedRows
    );
    if (DRY_RUN) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
      await client.query(
        "UPDATE \"wodiMESSyncRun\" SET \"status\" = 'Completed', \"finishedAt\" = NOW(), " +
          '"heartbeatAt" = NOW(), "scannedCount" = $2, "insertedCount" = $3, ' +
          '"updatedCount" = $4, "skippedCount" = $5, "sourceCounts" = $6::jsonb, ' +
          '"targetCounts" = $7::jsonb WHERE "id" = $1',
        [
          runId,
          result.scanned,
          result.inserted,
          result.updated,
          result.skipped,
          json({ workOrders: result.scanned }),
          json({ jobs: result.jobs, operations: result.operations })
        ]
      );
      await client.query(
        'UPDATE "u8WorkOrderImportConfig" SET "lastRunAt" = NOW(), ' +
          "\"nextRunAt\" = CASE WHEN \"enabled\" THEN NOW() + (\"intervalMinutes\" * INTERVAL '1 minute') ELSE NULL END, " +
          '"updatedAt" = NOW() WHERE "companyId" = $1',
        [COMPANY_ID]
      );
    }
    console.log(JSON.stringify({ dryRun: DRY_RUN, ...result }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // No active transaction.
    }
    if (runId && !DRY_RUN) {
      await client.query(
        "UPDATE \"wodiMESSyncRun\" SET \"status\" = 'Failed', \"finishedAt\" = NOW(), " +
          '"heartbeatAt" = NOW(), "errorCount" = 1, "message" = $2 WHERE "id" = $1',
        [runId, String(error.message || error).slice(0, 2000)]
      );
      await client.query(
        'INSERT INTO "wodiMESSyncError" ' +
          '("id", "syncRunId", "companyId", "sourceCollection", "errorCode", "message", "createdBy") ' +
          "VALUES ($1, $2, $3, 'U8 work orders', 'IMPORT_FAILED', $4, $5)",
        [
          stableId("u8err", runId),
          runId,
          COMPANY_ID,
          String(error.message || error).slice(0, 2000),
          USER_ID
        ]
      );
    }
    throw error;
  } finally {
    if (locked) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
        ["u8-work-order-import:" + COMPANY_ID]
      );
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("U8 work-order import failed:", error.message);
  process.exitCode = 1;
});
