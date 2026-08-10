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
});
