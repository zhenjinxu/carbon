import { describe, expect, it } from "vitest";
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

describe("ontology context service", () => {
  it("returns metadata with explicit snapshot authority", () => {
    const service = createOntologyService(makeSnapshot(), authority);

    const result = service.metadata("deepseek");

    expect(result.authority).toEqual({ ...authority, dataset: "deepseek" });
    expect(result.dataset.stats).toEqual({ objects: 2, episodes: 1, facts: 1, mentions: 2 });
    expect(result.contractVersion).toBe(1);
    expect(result.availableDatasets).toEqual([
      { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-pro", stats: { objects: 2, episodes: 1, facts: 1, mentions: 2 } },
      { id: "qwen", label: "Qwen", model: "qwen3:4b", stats: { objects: 1, episodes: 1, facts: 0, mentions: 1 } },
    ]);
  });

  it("searches deterministically and derives Unclassified without changing types", () => {
    const service = createOntologyService(makeSnapshot(), authority);

    const result = service.search({ dataset: "deepseek", q: "beta", limit: 50 });

    expect(result.results[0]!).toMatchObject({ id: "node-b", displayType: "Unclassified", types: [] });
    expect(result.results[0]!).not.toHaveProperty("fact");
  });

  it("returns depth-one context and provenance without Episode bodies", () => {
    const service = createOntologyService(makeSnapshot(), authority);

    const result = service.context({ dataset: "deepseek", objectId: "node-a", direction: "both", limit: 50 });

    expect(result.object.id).toBe("node-a");
    expect(result.relationships[0]).toMatchObject({ relation: "dependsOn", relatedObject: { id: "node-b", displayType: "Unclassified" } });
    expect(result.provenance[0]!).toMatchObject({ id: "episode-1", sourcePath: "项目开发/Carbon/Carbon 项目背景.md" });
    expect(result.provenance[0]!).not.toHaveProperty("body");
    expect(result.provenance[0]!).not.toHaveProperty("sourceDescription");
  });

  it("returns a stable not-found error within the selected dataset", () => {
    const service = createOntologyService(makeSnapshot(), authority);

    expect(() => service.context({ dataset: "qwen", objectId: "node-a", direction: "both", limit: 50 })).toThrow("object_not_found");
  });

  it("marks relationship results as truncated at the configured cap", () => {
    const snapshot = makeSnapshot();
    snapshot.datasets[0]!.edges = Array.from({ length: 101 }, (_, index) => ({
      id: `edge-${index}`,
      sourceId: "node-a",
      targetId: "node-b",
      relation: "dependsOn",
      fact: `Fact ${index}`,
      episodeIds: ["episode-1"],
      classification: "defined" as const,
    }));
    snapshot.datasets[0]!.stats.facts = 101;

    const service = createOntologyService(snapshot, authority);
    const result = service.context({ dataset: "deepseek", objectId: "node-a", direction: "outgoing", limit: 50 });

    expect(result.relationships).toHaveLength(50);
    expect(result.warnings).toContain("truncated");
  });

  it("rejects cursors that exceed safe integer precision", () => {
    const service = createOntologyService(makeSnapshot(), authority);
    const cursor = Buffer.from("9007199254740992", "utf8").toString("base64url");

    expect(() => service.search({ dataset: "deepseek", q: "Alpha", cursor })).toThrow("invalid_query");
  });
});
