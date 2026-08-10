import { afterEach, describe, expect, it } from "vitest";
import { createOntologyContextServer } from "../src/http";
import { createOntologyService, type SnapshotAuthorityInput } from "../src/service";
import { makeSnapshot } from "./fixtures";

const authority: SnapshotAuthorityInput = {
  kind: "project_snapshot",
  snapshotId: "sha256:test-snapshot",
  artifactHash: "sha256:test-snapshot",
  sourceManifestHash: "sha256:test-manifest",
  model: "deepseek-v4-pro",
  generatedAt: "2026-08-08T06:00:00Z",
  freshness: "static",
};

const servers: Array<ReturnType<typeof createOntologyContextServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startServer(maxRequestsPerMinute = 60) {
  const server = createOntologyContextServer(
    createOntologyService(makeSnapshot(), authority),
    { maxRequestsPerMinute },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

describe("ontology context HTTP adapter", () => {
  it("returns metadata and context with request and authority envelopes", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ontology/context?dataset=deepseek&objectId=node-a`);
    const body = (await response.json()) as {
      schemaVersion: number;
      requestId: string;
      authority: { kind: string };
      data: { object: { id: string } };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe(1);
    expect(body.requestId).toMatch(/^req_/);
    expect(body.data.object.id).toBe("node-a");
    expect(body.authority.kind).toBe("project_snapshot");
    expect(body.warnings).toEqual([]);
    expect(body.data).not.toHaveProperty("authority");
    expect(body.data).not.toHaveProperty("warnings");
  });

  it("rejects company scope and malformed limits before service execution", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ontology/search?q=Alpha&companyId=company-1&limit=51`);
    const body = (await response.json()) as { error: { code: string; message: string }; requestId: string };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(body.error.message).not.toContain("company-1");
    expect(body.requestId).toMatch(/^req_/);
  });

  it("maps schema validation failures to a safe invalid-query response", async () => {
    const baseUrl = await startServer();

    for (const path of [
      "/api/ontology/search?q=Alpha&limit=51",
      "/api/ontology/search?q=",
      "/api/ontology/context?objectId=node-a&depth=2",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "invalid_query", message: "Query parameters are invalid" });
    }
  });

  it("returns structured not-found and method errors without stack details", async () => {
    const baseUrl = await startServer();

    const notFound = await fetch(`${baseUrl}/api/ontology/context?dataset=qwen&objectId=node-a`);
    const notFoundBody = (await notFound.json()) as { error: { code: string; message: string } };
    const writeAttempt = await fetch(`${baseUrl}/api/ontology/context`, { method: "POST" });
    const writeBody = (await writeAttempt.json()) as { error: { code: string; message: string } };

    expect(notFound.status).toBe(404);
    expect(notFoundBody.error.code).toBe("object_not_found");
    expect(notFoundBody.error.message).toBe("Object was not found in the selected dataset");
    expect(writeAttempt.status).toBe(405);
    expect(writeBody.error.code).toBe("method_not_allowed");
    expect(JSON.stringify(notFoundBody)).not.toMatch(/stack|D:\\Object|node_modules/i);
  });

  it("enforces a bounded per-process request rate", async () => {
    const baseUrl = await startServer(1);

    const first = await fetch(`${baseUrl}/api/ontology/metadata`);
    const second = await fetch(`${baseUrl}/api/ontology/metadata`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });
});
