import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(__dirname, "../../..");

const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8");

describe("custom fields settings", () => {
  it("loads tenant-aware table projections, including tables with no fields", () => {
    const source = readSource(
      "apps",
      "erp",
      "app",
      "modules",
      "settings",
      "settings.service.ts"
    );
    const getCustomFields = source.slice(
      source.indexOf("export async function getCustomFields("),
      source.indexOf("export async function getCustomFieldsTables(")
    );
    const getCustomFieldsTables = source.slice(
      source.indexOf("export async function getCustomFieldsTables("),
      source.indexOf("export async function getIntegration(")
    );

    expect(getCustomFields).toContain('.from("customFieldTables")');
    expect(getCustomFields).toContain('.eq("companyId", companyId)');
    expect(getCustomFields).toContain(".single()");
    expect(getCustomFieldsTables).toContain('.from("customFieldTables")');
    expect(getCustomFieldsTables).toContain('.eq("companyId", companyId)');
  });

  it("submits edits by field id and authorizes custom-field writes as settings", () => {
    const form = readSource(
      "apps",
      "erp",
      "app",
      "modules",
      "settings",
      "ui",
      "CustomFields",
      "CustomFieldForm.tsx"
    );
    const tableRoute = readSource(
      "apps",
      "erp",
      "app",
      "routes",
      "x+",
      "settings+",
      "custom-fields.$table.tsx"
    );
    const editRoute = readSource(
      "apps",
      "erp",
      "app",
      "routes",
      "x+",
      "settings+",
      "custom-fields.$table.$id.tsx"
    );

    expect(form).toContain("path.to.customField(table, initialValues.id!)");
    expect(form).toContain('permissions.can("update", "settings")');
    expect(form).toContain('permissions.can("create", "settings")');
    expect(tableRoute).toContain('update: "settings"');
    expect(editRoute).toContain('update: "settings"');
  });

  it("ships an idempotent compatibility migration for restored databases", () => {
    const migrationsDirectory = path.join(
      repositoryRoot,
      "packages",
      "database",
      "supabase",
      "migrations"
    );
    const migration = fs
      .readdirSync(migrationsDirectory)
      .find((file) => file.endsWith("_recreate-custom-field-tables-view.sql"));

    expect(migration).toBeDefined();
    if (!migration) return;

    const sql = fs.readFileSync(
      path.join(migrationsDirectory, migration),
      "utf8"
    );

    expect(sql).toContain(
      'CREATE OR REPLACE VIEW "public"."customFieldTables"'
    );
    expect(sql).toMatch(/security_invoker\s*=\s*true/i);
    expect(sql).toContain('CROSS JOIN "public"."company"');
    expect(sql).toContain("'required', cf.\"required\"");
    expect(sql).toContain("COALESCE(fields.fields, '[]'::json)");
    expect(sql).toContain(
      'GRANT SELECT ON TABLE "public"."customFieldTables" TO anon, authenticated, service_role;'
    );
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    expect(sql).not.toContain("DROP VIEW");
  });
});
