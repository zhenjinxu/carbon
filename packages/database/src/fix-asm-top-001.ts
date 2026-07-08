/**
 * Fix script for asm-top-001: clean up existing data and re-seed.
 *
 * Solves the issue where asm-top-001 exists as a part but has no makeMethod,
 * causing the details page (/x/part/asm-top-001/details) to render empty.
 *
 * Usage:
 *   cd packages/database
 *   pnpm exec tsx src/fix-asm-top-001.ts
 */

import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { seedAsmTop001 } from "./seed-asm-top-001.ts";

// Hardcoded IDs matching run-asm-seed-postgres.ts (Supabase 'postgres' database)
const COMPANY_ID = "co-dev"; // Carbon Development
const USER_ID = "ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc"; // dev@carbon.local
const LOCATION_ID = "loc_BRMACv8Z8FVDWrRWdVroxE"; // Headquarters

// Process names from the seed — used to clean up orphaned records
const PROCESS_NAMES = [
  "零部件预装",
  "自动锁附",
  "整机通电调试",
  "高温老化",
  "终检包装"
];

// Work center name prefixes from the seed
const WC_PREFIXES = [
  "PRE-ASM-01",
  "ROB0",
  "TEST0",
  "AG0",
  "FI-01"
];

async function cleanup(client: any) {
  console.log("  → Cleaning up existing asm-top-001 data...");

  // 1. Find the item
  const itemResult = await client.query(
    `SELECT id FROM item WHERE "readableId" = 'asm-top-001' AND "companyId" = $1`,
    [COMPANY_ID]
  );

  if (itemResult.rows.length === 0) {
    console.log("    No existing asm-top-001 item found, skipping cleanup.");
    return;
  }

  const itemId = itemResult.rows[0].id;
  console.log(`    Found item: ${itemId}`);

  // 2. Delete job operations (depends on job)
  const jobResult = await client.query(
    `SELECT id FROM job WHERE "itemId" = $1 AND "jobId" LIKE 'PRO-ASM-TOP-001%'`,
    [itemId]
  );
  for (const job of jobResult.rows) {
    await client.query(`DELETE FROM "jobOperation" WHERE "jobId" = $1`, [job.id]);
    await client.query(`DELETE FROM "jobMakeMethod" WHERE "jobId" = $1`, [job.id]);
    await client.query(`DELETE FROM job WHERE id = $1`, [job.id]);
  }
  if (jobResult.rows.length > 0) {
    console.log(`    Deleted ${jobResult.rows.length} job(s) and related operations.`);
  }

  // 3. Delete method materials and method operations (via makeMethod)
  const mmResult = await client.query(
    `SELECT id FROM "makeMethod" WHERE "itemId" = $1`,
    [itemId]
  );
  for (const mm of mmResult.rows) {
    await client.query(`DELETE FROM "methodMaterial" WHERE "makeMethodId" = $1`, [mm.id]);
    await client.query(`DELETE FROM "methodOperation" WHERE "makeMethodId" = $1`, [mm.id]);
  }
  if (mmResult.rows.length > 0) {
    console.log(`    Deleted ${mmResult.rows.length} makeMethod(s) and related operations/materials.`);
  }

  // 4. Delete the item (cascades to makeMethod, part, itemCost, itemReplenishment, etc.)
  await client.query(`DELETE FROM item WHERE id = $1`, [itemId]);
  console.log(`    Deleted item asm-top-001.`);

  // 5. Clean up orphaned processes (from previous seed runs)
  for (const procName of PROCESS_NAMES) {
    const procResult = await client.query(
      `SELECT id FROM process WHERE name = $1 AND "companyId" = $2`,
      [procName, COMPANY_ID]
    );
    for (const proc of procResult.rows) {
      await client.query(
        `DELETE FROM "workCenterProcess" WHERE "processId" = $1`,
        [proc.id]
      );
      await client.query(
        `DELETE FROM "procedure" WHERE "processId" = $1`,
        [proc.id]
      );
    }
    await client.query(
      `DELETE FROM process WHERE name = $1 AND "companyId" = $2`,
      [procName, COMPANY_ID]
    );
  }
  console.log(`    Cleaned up processes: ${PROCESS_NAMES.join(", ")}`);

  // 6. Clean up orphaned work centers (from previous seed runs)
  for (const prefix of WC_PREFIXES) {
    await client.query(
      `DELETE FROM "workCenter" WHERE name LIKE $1 AND "companyId" = $2`,
      [`${prefix}%`, COMPANY_ID]
    );
  }
  console.log(`    Cleaned up work centers.`);

  // 7. Clean up orphaned procedures (from previous seed runs, matched by name pattern)
  const procNames = PROCESSES.map((p) => `${p.name}工艺规程`);
  for (const name of procNames) {
    const procResult = await client.query(
      `SELECT id FROM "procedure" WHERE name LIKE $1 AND "companyId" = $2`,
      [`${name}%`, COMPANY_ID]
    );
    for (const proc of procResult.rows) {
      await client.query(
        `DELETE FROM "procedureStep" WHERE "procedureId" = $1`,
        [proc.id]
      );
    }
    await client.query(
      `DELETE FROM "procedure" WHERE name LIKE $1 AND "companyId" = $2`,
      [`${name}%`, COMPANY_ID]
    );
  }
  console.log(`    Cleaned up procedures.`);
}

// Keep PROCESSES in sync with seed-asm-top-001.ts
const PROCESSES = [
  { name: "零部件预装" },
  { name: "自动锁附" },
  { name: "整机通电调试" },
  { name: "高温老化" },
  { name: "终检包装" }
];

async function main() {
  console.log("=== Fix asm-top-001 (cleanup + re-seed) ===\n");

  const pool = new Pool({
    connectionString: "postgresql://postgres:postgres@localhost:56251/postgres",
    max: 1
  });
  const client = await pool.connect();

  try {
    console.log(`Company:  ${COMPANY_ID}`);
    console.log(`User:     ${USER_ID}`);
    console.log(`Location: ${LOCATION_ID}`);
    console.log(`Database: postgres\n`);

    await client.query("BEGIN");

    // Step 1: Clean up existing data
    await cleanup(client);

    // Step 2: Re-seed
    console.log("");
    await seedAsmTop001(client, {
      companyId: COMPANY_ID,
      userId: USER_ID,
      locationId: LOCATION_ID
    });

    await client.query("COMMIT");
    console.log("\n✓ Done! Refresh the browser and open /x/part/asm-top-001/details");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n✗ Fix failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
