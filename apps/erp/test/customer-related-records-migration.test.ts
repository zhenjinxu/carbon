import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/database/supabase/migrations/20260730152347_backfill-customer-related-records.sql"
);

describe("customer related-record backfill migration", () => {
  it("idempotently restores every required customer baseline", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain('INSERT INTO "customerPayment"');
    expect(sql).toContain('INSERT INTO "customerShipping"');
    expect(sql).toContain('INSERT INTO "customerTax"');
    expect(sql.match(/NOT EXISTS/g)).toHaveLength(3);
    expect(sql.match(/existing\."customerId" = customer\.id/g)).toHaveLength(3);
    expect(sql).not.toContain("DELETE FROM");
    expect(sql).not.toContain("UPDATE ");
  });
});
