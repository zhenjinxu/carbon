import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/database/supabase/migrations/20260731084217_recreate-quote-customer-details-view.sql"
);

describe("quote customer details compatibility migration", () => {
  it("restores the security-invoker view required by finalize and PDF", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain(
      'CREATE OR REPLACE VIEW "public"."quoteCustomerDetails"'
    );
    expect(sql).toMatch(/SECURITY_INVOKER\s*=\s*true/i);
    expect(sql).toContain('FROM "public"."quote" q');
    expect(sql).toContain('JOIN "public"."customer" c');
    expect(sql).toContain('JOIN "public"."customerTax" ctx');
    expect(sql).toContain('JOIN "public"."customerContact" cc');
    expect(sql).toContain('JOIN "public"."customerLocation" cl');
    expect(sql).toContain(
      'GRANT SELECT ON TABLE "public"."quoteCustomerDetails" TO anon, authenticated, service_role;'
    );
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
    expect(sql).not.toContain('DROP VIEW');
  });
});
