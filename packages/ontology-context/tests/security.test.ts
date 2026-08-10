import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createOntologyContextServer } from "../src/http";
import { createOntologyService, type SnapshotAuthorityInput } from "../src/service";
import { loadSnapshotSource } from "../src/snapshot-source";
import { makeSnapshot } from "./fixtures";

const authority: SnapshotAuthorityInput = {
  kind: "project_snapshot",
  snapshotId: "sha256:test",
  artifactHash: "sha256:test",
  sourceManifestHash: "sha256:test-manifest",
  generatedAt: "2026-08-09T00:00:00.000Z",
  freshness: "static",
};

const sourceFiles = [
  "contracts.ts",
  "http.ts",
  "index.ts",
  "schemas.ts",
  "service.ts",
  "snapshot-source.ts",
].map((file) => new URL(`../src/${file}`, import.meta.url));
const runtimeScripts = [
  new URL("../scripts/ontology-context-server.cjs", import.meta.url),
  new URL("../scripts/verify-snapshot.mjs", import.meta.url),
];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listen(server: ReturnType<typeof createOntologyContextServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_unavailable");
  return address.port;
}

describe("read-only boundary", () => {
  test("does not import write-capable or external graph/runtime dependencies", () => {
    const forbidden = [
      /node:child_process/,
      /(?:@supabase|supabase-js|neo4j-driver|ollama|mcp)/i,
      /\b(?:writeFile|appendFile|rmSync|unlinkSync|mkdirSync|renameSync)\s*\(/,
      /\b(?:spawn|execFile|execSync)\s*\(/,
    ];
    for (const file of [...sourceFiles, ...runtimeScripts]) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    }
  });

  test("keeps source and snapshot hashes unchanged after requests", async () => {
    expect(loadSnapshotSource().authority.kind).toBe("project_snapshot");
    const fixtureSnapshot = makeSnapshot();
    const service = createOntologyService(fixtureSnapshot, authority);
    const server = createOntologyContextServer(service, { maxRequestsPerMinute: 10 });
    const fixtureHashBefore = sha256(Buffer.from(JSON.stringify(fixtureSnapshot)));
    const snapshotPath = new URL("../src/generated/ontology-snapshot.json", import.meta.url);
    const snapshotHashBefore = sha256(readFileSync(snapshotPath));
    const sourceHashesBefore = [...sourceFiles, ...runtimeScripts].map((file) => sha256(readFileSync(file)));
    const port = await listen(server);

    try {
      for (const [path, expectedStatus] of [
        ["/api/ontology/metadata", 200],
        ["/api/ontology/search?q=Alpha", 200],
        ["/api/ontology/context?objectId=node-a", 200],
        ["/api/ontology/write", 404],
      ] as const) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(response.status).toBe(expectedStatus);
      }
      const writeMethod = await fetch(`http://127.0.0.1:${port}/api/ontology/context?objectId=node-a`, {
        method: "POST",
      });
      expect(writeMethod.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }

    expect(sha256(Buffer.from(JSON.stringify(fixtureSnapshot)))).toBe(fixtureHashBefore);
    expect(sha256(readFileSync(snapshotPath))).toBe(snapshotHashBefore);
    expect([...sourceFiles, ...runtimeScripts].map((file) => sha256(readFileSync(file)))).toEqual(sourceHashesBefore);
  });
});
