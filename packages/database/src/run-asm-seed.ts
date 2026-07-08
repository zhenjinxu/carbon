/**
 * Standalone runner for asm-top-001 MES demo seed.
 * Run against an existing dev database without re-seeding everything.
 *
 * Usage:
 *   cd packages/database
 *   pnpm exec tsx src/run-asm-seed.ts
 */

import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local" });

import { getPostgresConnectionPool } from "./client.ts";
import { seedAsmTop001 } from "./seed-asm-top-001.ts";

async function main() {
  console.log("=== asm-top-001 MES Demo Seed ===\n");

  const pgPool = getPostgresConnectionPool(1);
  const client = await pgPool.connect();

  try {
    // Look up existing dev company/user/location
    const companyResult = await client.query(
      `SELECT id FROM company LIMIT 1`
    );
    if (companyResult.rows.length === 0) {
      console.error("Error: No company found. Run db:seed:dev first.");
      process.exit(1);
    }
    const companyId = companyResult.rows[0].id as string;

    const userResult = await client.query(
      `SELECT id FROM "user" WHERE email = 'dev@carbon.local' LIMIT 1`
    );
    if (userResult.rows.length === 0) {
      console.error("Error: No dev user found. Run db:seed:dev first.");
      process.exit(1);
    }
    const userId = userResult.rows[0].id as string;

    const locationResult = await client.query(
      `SELECT id FROM location WHERE "companyId" = $1 LIMIT 1`,
      [companyId]
    );
    if (locationResult.rows.length === 0) {
      console.error("Error: No location found. Run db:seed:dev first.");
      process.exit(1);
    }
    const locationId = locationResult.rows[0].id as string;

    console.log(`Company:  ${companyId}`);
    console.log(`User:     ${userId}`);
    console.log(`Location: ${locationId}\n`);

    await client.query("BEGIN");
    await seedAsmTop001(client, { companyId, userId, locationId });
    await client.query("COMMIT");

    console.log("\n✓ Done!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n✗ Seed failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

main();
