import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("ERP development server", () => {
  it("accepts the Inngest container host", async () => {
    expect(typeof config).toBe("function");
    if (typeof config !== "function") return;

    const resolved = await config({
      command: "serve",
      isPreview: false,
      isSsrBuild: false,
      mode: "test"
    });

    expect(resolved.server?.allowedHosts).toContain("host.docker.internal");
  });

  it("externalizes the native PDF drawing renderer from the SSR bundle", async () => {
    expect(typeof config).toBe("function");
    if (typeof config !== "function") return;

    const resolved = await config({
      command: "build",
      isPreview: false,
      isSsrBuild: true,
      mode: "test"
    });

    expect(resolved.ssr?.external).toContain("@napi-rs/canvas");
  });

  it("declares the externalized PDF renderer as an ERP runtime dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies?.["@napi-rs/canvas"]).toBe("0.1.100");
  });
});
