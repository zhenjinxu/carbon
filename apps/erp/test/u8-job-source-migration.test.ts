import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/database/supabase/migrations/20260721093642_add-job-source.sql"
);

describe("U8 job source migration", () => {
  it("restores jobs view access after recreating the view", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain('DROP VIEW IF EXISTS "public"."jobs"');
    expect(sql).toContain('CREATE VIEW "public"."jobs"');
    expect(sql).toMatch(/SECURITY_INVOKER\s*=\s*true/i);
    expect(sql).toContain(
      'GRANT SELECT ON TABLE "public"."jobs" TO anon, authenticated, service_role;'
    );
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
