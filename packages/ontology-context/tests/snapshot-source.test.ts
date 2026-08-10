import { describe, expect, it } from "vitest";
import { loadSnapshotSource } from "../src/snapshot-source";

describe("compiled ontology snapshot source", () => {
  it("loads the pinned snapshot and exposes deterministic artifact authority", () => {
    const first = loadSnapshotSource();
    const second = loadSnapshotSource();

    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.authority).toEqual(second.authority);
    expect(first.authority).toMatchObject({
      kind: "project_snapshot",
      snapshotId: "sha256:F09CFF5BEA1EA4AE8B1456B43FE41C8A885E74386E4E2BC3EFCFDBF9C6627DCF",
      artifactHash: "sha256:F09CFF5BEA1EA4AE8B1456B43FE41C8A885E74386E4E2BC3EFCFDBF9C6627DCF",
    });
    expect(first.snapshot.datasets.map((dataset) => dataset.id)).toEqual(["deepseek", "qwen"]);
  });
});
