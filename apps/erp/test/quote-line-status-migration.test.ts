import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/database/supabase/migrations/20260730153129_reconcile-quote-line-status.sql"
);

describe("quote line status reconciliation migration", () => {
  it("restores the enum contract used by the application", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain("RENAME VALUE \'Draft\' TO \'Not Started\'");
    expect(sql).toContain("ADD VALUE \'No Quote\' AFTER \'Complete\'");
    expect(sql).toContain("SET DEFAULT \'Not Started\'");
    expect(sql).toContain("pg_enum");
    expect(sql).not.toContain("DROP TYPE");
  });
});
