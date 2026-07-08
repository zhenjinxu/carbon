/**
 * Run asm-top-001 seed against the correct 'postgres' database
 * (Supabase PostgREST connects to 'postgres', not 'carbon').
 *
 * Usage:
 *   cd packages/database
 *   pnpm exec tsx src/run-asm-seed-postgres.ts
 */

import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { seedAsmTop001 } from "./seed-asm-top-001.ts";

async function main() {
  console.log("=== asm-top-001 MES Demo Seed (postgres db) ===\n");

  // Connect to the 'postgres' database (what Supabase PostgREST uses)
  const pool = new Pool({
    connectionString: "postgresql://postgres:postgres@localhost:56251/postgres",
    max: 1
  });
  const client = await pool.connect();

  try {
    // Use the correct company/user/location from the postgres database
    const companyId = "co-dev"; // Carbon Development
    const userId = "ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc"; // dev@carbon.local
    const locationId = "loc_BRMACv8Z8FVDWrRWdVroxE"; // Headquarters

    console.log(`Company:  ${companyId}`);
    console.log(`User:     ${userId}`);
    console.log(`Location: ${locationId}`);
    console.log(`Database: postgres\n`);

    await client.query("BEGIN");
    await seedAsmTop001(client, { companyId, userId, locationId });
    await client.query("COMMIT");

    console.log("\n✓ Done! Data is now visible in MES and ERP.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n✗ Seed failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
