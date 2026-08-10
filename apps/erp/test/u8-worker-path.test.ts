import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../packages/jobs/src/inngest/client", () => ({
  inngest: { createFunction: vi.fn(() => ({})) }
}));

import * as subject from "../../../packages/jobs/src/inngest/functions/integrations/u8-work-orders";

describe("U8 importer paths", () => {
  it("resolves the repository root when the worker runs from apps/erp", () => {
    const resolvePaths = Reflect.get(subject, "resolveU8ImportPaths");
    expect(resolvePaths).toBeTypeOf("function");
    if (typeof resolvePaths !== "function") return;

    const repositoryRoot = path.resolve(
      path.parse(process.cwd()).root,
      "workspace",
      "carbon"
    );
    const cwd = path.join(repositoryRoot, "apps", "erp");

    expect(resolvePaths({ cwd })).toEqual({
      carbonRoot: repositoryRoot,
      scriptPath: path.join(
        repositoryRoot,
        "scripts",
        "import-u8-work-orders.cjs"
      )
    });
  });
});
