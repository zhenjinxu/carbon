import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("storage schema grants migration", () => {
  it("restores schema usage for every Storage API JWT role", () => {
    const migrationsDirectory = path.resolve(
      __dirname,
      "../../../packages/database/supabase/migrations"
    );
    const migration = fs
      .readdirSync(migrationsDirectory)
      .find((file) => file.endsWith("_restore-storage-schema-usage.sql"));

    expect(migration).toBeDefined();

    const sql = fs.readFileSync(
      path.join(migrationsDirectory, migration!),
      "utf8"
    );

    expect(sql).toContain(
      "GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;"
    );
  });
});
