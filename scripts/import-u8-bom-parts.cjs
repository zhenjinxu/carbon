#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mssql = require("mssql");

const CARBON_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.resolve(
  process.env.WODIMES_SOURCE_ROOT ||
    process.env.U8_CONNECTOR_SOURCE_ROOT ||
    "D:/Object/0.1.7"
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
const runtimeEnv = { ...sourceEnv, ...carbonEnv, ...process.env };

const { Pool } = require(
  path.join(CARBON_ROOT, "packages", "database", "node_modules", "pg")
);
const { loadU8BomGraph } = require("./lib/u8-bom-source.cjs");
const {
  acquireImportLock,
  analyzeCarbonTarget,
  assertImportActor,
  importCarbonBom,
  loadCurrentProductionOrders,
  releaseImportLock
} = require("./lib/u8-bom-carbon.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function stableId(prefix, ...parts) {
  return (
    prefix +
    "_" +
    crypto
      .createHash("sha1")
      .update(parts.join("\u0000"))
      .digest("hex")
      .slice(0, 24)
  );
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: runtimeEnv.TZ || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value
    ])
  );
  return value.year + "-" + value.month + "-" + value.day;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--as-of must use YYYY-MM-DD.");
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("--as-of is not a valid date.");
  }
  return value;
}

const COMPANY_ID =
  argument("--company-id") || runtimeEnv.U8_CARBON_COMPANY_ID;
const USER_ID = argument("--user-id") || runtimeEnv.U8_CARBON_USER_ID;
const AS_OF_DATE = validateDate(argument("--as-of") || localDate());
const MAX_DEPTH = Number(argument("--max-depth") || 50);
const DRY_RUN = hasFlag("--dry-run");
const ROLLBACK = hasFlag("--rollback");

if (!COMPANY_ID) throw new Error("Missing --company-id.");
if (!USER_ID) throw new Error("Missing --user-id.");
if (DRY_RUN && ROLLBACK) {
  throw new Error("--dry-run and --rollback are mutually exclusive.");
}
if (!Number.isInteger(MAX_DEPTH) || MAX_DEPTH < 1) {
  throw new Error("--max-depth must be a positive integer.");
}

const CARBON_DB_URL =
  runtimeEnv.SUPABASE_DB_URL || carbonEnv.SUPABASE_DB_URL;
if (!CARBON_DB_URL) throw new Error("SUPABASE_DB_URL is not configured.");

for (const key of ["U8_SERVER", "U8_DATABASE", "U8_USER", "U8_PASSWORD"]) {
  if (!runtimeEnv[key]) throw new Error(key + " is not configured.");
}

const U8_CONFIG = {
  server: runtimeEnv.U8_SERVER,
  database: runtimeEnv.U8_DATABASE,
  user: runtimeEnv.U8_USER,
  password: runtimeEnv.U8_PASSWORD,
  port: Number(runtimeEnv.U8_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 10000,
  requestTimeout: 300000
};

function outputPath() {
  const requested = argument("--output");
  if (requested) {
    return path.isAbsolute(requested)
      ? requested
      : path.resolve(CARBON_ROOT, requested);
  }
  const mode = DRY_RUN ? "dry-run" : ROLLBACK ? "rollback" : "commit";
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.join(
    CARBON_ROOT,
    ".codex",
    "work",
    "u8-bom-parts",
    stamp + "-" + mode + ".json"
  );
}

function serializableGraph(graph) {
  return {
    asOfDate: graph.asOfDate,
    sourceSignature: graph.sourceSignature,
    summary: graph.summary,
    roots: graph.tree.roots,
    rows: graph.tree.rows.map(({ children, ...row }) => row),
    boms: [...graph.bomById.values()],
    parts: [...graph.itemsByPartId.values()],
    childBomSelections: [...graph.childBomByPartId.entries()].map(
      ([partId, bomId]) => ({ partId, bomId })
    )
  };
}

function writeOutput(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function createAuditRun(client, graph) {
  const runId = stableId(
    "u8bomrun",
    COMPANY_ID,
    new Date().toISOString(),
    crypto.randomUUID()
  );
  await client.query(
    [
      'INSERT INTO "wodiMESSyncRun"',
      '("id", "companyId", "source", "status", "triggerType",',
      '"filterSnapshot", "configVersion", "heartbeatAt", "createdBy")',
      "VALUES ($1, $2, 'U8', 'Running', 'Manual', $3::jsonb, 1, NOW(), $4)"
    ].join(" "),
    [
      runId,
      COMPANY_ID,
      JSON.stringify({
        mode: "BOM Parts",
        asOfDate: AS_OF_DATE,
        jobStatuses: ["Planned", "Ready", "In Progress", "Paused"],
        sourceSignature: graph.sourceSignature
      }),
      USER_ID
    ]
  );
  return runId;
}

async function completeAuditRun(client, runId, graph, result) {
  await client.query(
    [
      'UPDATE "wodiMESSyncRun" SET "status" = \'Completed\',',
      '"finishedAt" = NOW(), "heartbeatAt" = NOW(),',
      '"scannedCount" = $2, "insertedCount" = $3, "updatedCount" = $4,',
      '"skippedCount" = 0, "sourceCounts" = $5::jsonb,',
      '"targetCounts" = $6::jsonb, "message" = $7',
      'WHERE id = $1'
    ].join(" "),
    [
      runId,
      graph.summary.parts,
      result.analysis.newItems,
      result.analysis.existingItems,
      JSON.stringify(graph.summary),
      JSON.stringify({
        items: result.items,
        partMasters: result.partMasters,
        methods: result.methods,
        materials: result.materials,
        staleMaterialsRemoved: result.staleMaterialsRemoved
      }),
      "U8 BOM parts and branch relationships imported."
    ]
  );
}

async function failAuditRun(client, runId, error) {
  if (!runId) return;
  await client.query(
    [
      'UPDATE "wodiMESSyncRun" SET "status" = \'Failed\',',
      '"finishedAt" = NOW(), "heartbeatAt" = NOW(), "errorCount" = 1,',
      '"message" = $2 WHERE id = $1'
    ].join(" "),
    [runId, String(error.message || error).slice(0, 2000)]
  );
}

async function main() {
  const carbonPool = new Pool({
    connectionString: CARBON_DB_URL,
    max: 1,
    ssl:
      CARBON_DB_URL.includes("localhost") ||
      CARBON_DB_URL.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false }
  });
  const carbon = await carbonPool.connect();
  const u8 = await new mssql.ConnectionPool(U8_CONFIG).connect();
  let locked = false;
  let transaction = false;
  let runId = null;
  let committed = false;

  try {
    await assertImportActor(carbon, COMPANY_ID, USER_ID);
    await acquireImportLock(carbon, COMPANY_ID);
    locked = true;

    const productionOrders = await loadCurrentProductionOrders(
      carbon,
      COMPANY_ID
    );
    if (productionOrders.length === 0) {
      throw new Error("No current U8 ERP production orders were found.");
    }

    const graph = await loadU8BomGraph({
      pool: u8,
      productionOrders,
      asOfDate: AS_OF_DATE,
      maxDepth: MAX_DEPTH
    });
    const analysis = await analyzeCarbonTarget(carbon, {
      graph,
      productionOrders,
      companyId: COMPANY_ID
    });
    if (analysis.collisions.length > 0) {
      throw new Error(
        "Carbon item collisions must be resolved before import: " +
          analysis.collisions.slice(0, 20).join("; ")
      );
    }

    let result = { analysis };
    if (!DRY_RUN) {
      if (!ROLLBACK) runId = await createAuditRun(carbon, graph);
      await carbon.query("BEGIN");
      transaction = true;
      result = await importCarbonBom(carbon, {
        graph,
        productionOrders,
        companyId: COMPANY_ID,
        userId: USER_ID
      });

      const verificationGraph = await loadU8BomGraph({
        pool: u8,
        productionOrders,
        asOfDate: AS_OF_DATE,
        maxDepth: MAX_DEPTH
      });
      if (verificationGraph.sourceSignature !== graph.sourceSignature) {
        throw new Error(
          "U8 BOM source changed during import; Carbon transaction was rolled back."
        );
      }

      if (ROLLBACK) {
        await carbon.query("ROLLBACK");
      } else {
        await completeAuditRun(carbon, runId, graph, result);
        await carbon.query("COMMIT");
        committed = true;
      }
      transaction = false;
    }

    const filePath = outputPath();
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: DRY_RUN ? "dry-run" : ROLLBACK ? "rollback" : "commit",
      companyId: COMPANY_ID,
      committed,
      target: result,
      graph: serializableGraph(graph)
    };
    writeOutput(filePath, payload);

    console.log(
      JSON.stringify(
        {
          mode: payload.mode,
          committed,
          output: filePath,
          source: graph.summary,
          target: result
        },
        null,
        2
      )
    );
  } catch (error) {
    if (transaction) {
      try {
        await carbon.query("ROLLBACK");
      } catch {
        // The transaction may already have been aborted.
      }
    }
    if (!committed) {
      try {
        await failAuditRun(carbon, runId, error);
      } catch {
        // Preserve the original import error.
      }
    }
    throw error;
  } finally {
    if (locked) {
      try {
        await releaseImportLock(carbon, COMPANY_ID);
      } catch {
        // The connection close also releases session advisory locks.
      }
    }
    carbon.release();
    await carbonPool.end();
    await u8.close();
  }
}

main().catch((error) => {
  console.error("U8 BOM part import failed:", error.message);
  process.exitCode = 1;
});

