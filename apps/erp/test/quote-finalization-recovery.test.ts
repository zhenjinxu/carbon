import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(__dirname, "../../..");

describe("quote finalization recovery", () => {
  it("records the completed date when finalizeQuote marks a quote as sent", () => {
    const serviceSource = fs.readFileSync(
      path.join(
        repositoryRoot,
        "apps/erp/app/modules/sales/sales.service.ts"
      ),
      "utf8"
    );
    const start = serviceSource.indexOf("export async function finalizeQuote(");
    const end = serviceSource.indexOf(
      "export async function releaseSalesOrder(",
      start
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const finalizeQuoteSource = serviceSource.slice(start, end);
    expect(finalizeQuoteSource).toContain('status: "Sent"');
    expect(finalizeQuoteSource).toContain(
      "completedDate: now(getLocalTimeZone()).toAbsoluteString()"
    );
  });

  it("backfills only completed quotes that have persisted quote PDF evidence", () => {
    const migrationsDirectory = path.join(
      repositoryRoot,
      "packages/database/supabase/migrations"
    );
    const migration = fs
      .readdirSync(migrationsDirectory)
      .find((file) => file.endsWith("_backfill-quote-completed-date.sql"));

    expect(migration).toBeDefined();

    const sql = fs.readFileSync(
      path.join(migrationsDirectory, migration!),
      "utf8"
    );

    expect(sql).toContain('d."sourceDocument" = \'Quote\'');
    expect(sql).toContain('d."sourceDocumentId"');
    expect(sql).toContain('q."completedDate" IS NULL');
    expect(sql).toContain("q.status <> 'Draft'");
    expect(sql).toContain('SET "completedDate" = first_pdf."createdAt"');
  });
});
