import { describe, expect, it } from "vitest";
import {
  OntologySnapshotSchema,
  parseOntologySnapshot,
  contextQuerySchema,
  searchQuerySchema,
  contextResponseSchema,
  authoritySchema,
  type OntologySnapshot,
} from "../src/contracts";
import { makeSnapshot } from "./fixtures";
import { httpErrorEnvelopeSchema, httpSuccessEnvelopeSchema } from "../src/schemas";

describe("ontology snapshot contract", () => {
  it("preserves generic nodes and observed relation classification", () => {
    const snapshot = makeSnapshot();
    snapshot.datasets[0]!.edges[0]!.classification = "observed";

    const parsed = parseOntologySnapshot(snapshot);

    expect(parsed.datasets[0]!.nodes[1]!.types).toEqual([]);
    expect(parsed.datasets[0]!.edges[0]!.classification).toBe("observed");
  });

  it("rejects unknown non-empty ontology types", () => {
    const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
    const datasets = snapshot.datasets as OntologySnapshot["datasets"];
    datasets[0]!.nodes[0]!.types = ["UnknownType" as never];

    expect(() => parseOntologySnapshot(snapshot)).toThrow(/types contains UnknownType/);
  });

  it("rejects duplicate mention identifiers", () => {
    const snapshot = makeSnapshot();
    snapshot.datasets[0]!.mentions[1]!.id = "mention-1";

    expect(() => parseOntologySnapshot(snapshot)).toThrow(/duplicate mention id/);
  });

  it("rejects caller company scope and unbounded query limits", () => {
    expect(searchQuerySchema.safeParse({ q: "Alpha", companyId: "company-1" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "Alpha", limit: 51 }).success).toBe(false);
    expect(contextQuerySchema.safeParse({ objectId: "node-a", depth: 2 }).success).toBe(false);
  });

  it("emits strict schemas for the public snapshot shape", () => {
    const result = OntologySnapshotSchema.safeParse(makeSnapshot());
    expect(result.success).toBe(true);
  });

  it("validates strict success and error envelopes", () => {
    const success = httpSuccessEnvelopeSchema.safeParse({
      schemaVersion: 1,
      requestId: "req_11111111-1111-4111-8111-111111111111",
      authority: {
        kind: "project_snapshot",
        snapshotId: "sha256:test",
        artifactHash: "sha256:test",
        sourceManifestHash: "sha256:manifest",
        dataset: "deepseek",
        model: "deepseek-v4-pro",
        generatedAt: "2026-08-08T06:00:00Z",
        freshness: "static",
      },
      data: {},
      warnings: [],
    });
    expect(success.success).toBe(true);

    for (const code of [
      "invalid_query",
      "unauthenticated",
      "forbidden",
      "object_not_found",
      "not_found",
      "method_not_allowed",
      "response_too_large",
      "rate_limited",
      "snapshot_unavailable",
    ]) {
      const envelope = httpErrorEnvelopeSchema.safeParse({
        schemaVersion: 1,
        requestId: "req_11111111-1111-4111-8111-111111111111",
        error: { code, message: "Safe message" },
      });
      expect(envelope.success).toBe(true);
    }
    expect(
      httpErrorEnvelopeSchema.safeParse({
        schemaVersion: 1,
        requestId: "req_test",
        error: { code: "invalid_query", message: "bad", stack: "secret" },
      }).success,
    ).toBe(false);
    expect(
      authoritySchema.safeParse({
        kind: "project_snapshot",
        snapshotId: "sha256:test",
        artifactHash: "sha256:test",
        dataset: "deepseek",
        model: "deepseek-v4-pro",
        generatedAt: "2026-08-08T06:00:00Z",
        freshness: "static",
      }).success,
    ).toBe(false);
    expect(
      contextResponseSchema.safeParse({
        authority: {
          kind: "project_snapshot",
          snapshotId: "sha256:test",
          artifactHash: "sha256:test",
          sourceManifestHash: "sha256:manifest",
          dataset: "deepseek",
          model: "deepseek-v4-pro",
          generatedAt: "2026-08-08T06:00:00Z",
          freshness: "static",
        },
        object: {
          id: "node-a",
          name: "Alpha",
          types: ["CarbonProject"],
          displayType: "CarbonProject",
          summary: "The Alpha project.",
          sourceEpisodeIds: ["episode-1"],
        },
        relationships: [],
        provenance: [{
          id: "episode-1",
          name: "Carbon project background",
          sourcePath: "项目开发/Carbon/Carbon 项目背景.md",
          createdAt: "2026-08-08T06:00:00Z",
          validAt: "2026-08-01T00:00:00Z",
          sourceDescription: "must not be exposed",
        }],
        warnings: [],
      }).success,
    ).toBe(false);
  });
});
