import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const generatorPath = path.resolve(
  process.cwd(),
  "../../scripts/generate-db-types.ts"
);

describe("database type generator", () => {
  it("uses the installed Windows executable and replaces output atomically", () => {
    const source = fs.readFileSync(generatorPath, "utf8");

    expect(source).toContain('process.platform === "win32"');
    expect(source).toContain('"supabase.exe"');
    expect(source).toContain('const tempTypesPath = `${typesPath}.tmp`;');
    expect(source).not.toContain('openSync(typesPath, "w")');
    expect(source).toContain("renameSync(tempTypesPath, typesPath)");
  });
});
