import { describe, expect, it } from "vitest";
import { createOntologyContextServer, type OntologyContextServerOptions } from "../src/http";
import { createOntologyService, type OntologyService, type SnapshotAuthorityInput } from "../src/service";
import { makeSnapshot } from "./fixtures";

const authority: SnapshotAuthorityInput = {
  kind: "project_snapshot",
  snapshotId: "sha256:test-snapshot",
  artifactHash: "sha256:test-snapshot",
  sourceManifestHash: "sha256:test-manifest",
  generatedAt: "2026-08-08T06:00:00Z",
  freshness: "static",
};

async function request(
  service: OntologyService,
  options: OntologyContextServerOptions,
): Promise<{ response: Response; close: () => Promise<void> }> {
  const server = createOntologyContextServer(service, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_unavailable");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ontology/metadata`);
  return {
    response,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("ontology context HTTP boundaries", () => {
  it("returns a bounded error when a response exceeds the byte cap", async () => {
    const running = await request(createOntologyService(makeSnapshot(), authority), { maxResponseBytes: 64 });
    try {
      const body = (await running.response.json()) as { error: { code: string } };
      expect(running.response.status).toBe(413);
      expect(body.error.code).toBe("response_too_large");
    } finally {
      await running.close();
    }
  });

  it("maps an unavailable snapshot source to a redacted 503", async () => {
    const unavailable: OntologyService = {
      metadata() {
        throw new Error("snapshot_unavailable");
      },
      search() {
        throw new Error("snapshot_unavailable");
      },
      context() {
        throw new Error("snapshot_unavailable");
      },
    };
    const running = await request(unavailable, {});
    try {
      const body = (await running.response.json()) as { error: { code: string; message: string } };
      expect(running.response.status).toBe(503);
      expect(body.error).toEqual({
        code: "snapshot_unavailable",
        message: "Ontology snapshot is unavailable",
      });
    } finally {
      await running.close();
    }
  });
});
