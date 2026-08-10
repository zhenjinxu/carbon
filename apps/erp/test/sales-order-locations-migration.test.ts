import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sales order locations compatibility migration", () => {
  it("recreates the current security-invoker view and reloads PostgREST", () => {
    const migrationsDirectory = path.resolve(
      __dirname,
      "../../../packages/database/supabase/migrations"
    );
    const migration = fs
      .readdirSync(migrationsDirectory)
      .find((file) => file.endsWith("_recreate-sales-order-locations-view.sql"));

    expect(migration).toBeDefined();

    const sql = fs.readFileSync(
      path.join(migrationsDirectory, migration!),
      "utf8"
    );

    expect(sql).toContain(
      'CREATE OR REPLACE VIEW "public"."salesOrderLocations"'
    );
    expect(sql).toContain("WITH (security_invoker = true)");
    expect(sql).toContain('LEFT OUTER JOIN "public"."customerTax"');
    expect(sql).toContain('LEFT OUTER JOIN "public"."salesOrderPayment"');
    expect(sql).toContain(
      'GRANT SELECT ON TABLE "public"."salesOrderLocations" TO anon, authenticated, service_role;'
    );
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
