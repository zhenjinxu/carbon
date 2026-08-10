import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "../..");
const convertSource = fs.readFileSync(
  path.join(repoRoot, "packages/database/supabase/functions/convert/index.ts"),
  "utf8"
);
const getMethodSource = fs.readFileSync(
  path.join(repoRoot, "packages/database/supabase/functions/get-method/index.ts"),
  "utf8"
);
const interceptorMigration = path.join(
  repoRoot,
  "packages/database/supabase/migrations/20260730154817_make-quote-method-interceptors-idempotent.sql"
);

describe("sales RFQ quote method conversion", () => {
  it("checks nested method-copy failures and compensates the converted quote", () => {
    const block = convertSource.slice(
      convertSource.indexOf('case "salesRfqToQuote"'),
      convertSource.indexOf('case "shipmentToSalesInvoice"')
    );

    expect(block).toContain("methodCopyResults");
    expect(block).toContain("methodCopyFailure");
    expect(block).toContain('.deleteFrom("quote")');
    expect(block).toContain('status: "Ready for Quote"');
  });

  it("creates child quote methods inside the BOM-copy transaction", () => {
    const itemToQuoteLineStart = getMethodSource.indexOf(
      'case "itemToQuoteLine"'
    );
    const start = getMethodSource.indexOf("if (madeMaterials.length > 0)", itemToQuoteLineStart);
    const end = getMethodSource.indexOf(
      "if (pickedOrBoughtMaterials.length > 0)",
      start
    );
    const block = getMethodSource.slice(start, end);

    expect(block).toContain('.insertInto("quoteMakeMethod")');
    expect(block).toContain("id: newMakeMethodId");
    expect(block).toContain("parentMaterialId: materialId");
    expect(block).not.toContain('.updateTable("quoteMakeMethod")');
  });

  it("keeps asynchronous quote method interceptors idempotent", () => {
    expect(fs.existsSync(interceptorMigration)).toBe(true);
    if (!fs.existsSync(interceptorMigration)) return;

    const sql = fs.readFileSync(interceptorMigration, "utf8");
    expect(sql).toContain("sync_insert_quote_line_make_method");
    expect(sql).toContain("sync_insert_quote_material_make_method");
    expect(sql.match(/IF EXISTS/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
