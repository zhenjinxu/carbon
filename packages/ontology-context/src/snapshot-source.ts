import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type OntologySnapshot, parseOntologySnapshot } from "./contracts";
import bundledManifest from "./generated/ontology-snapshot.manifest.json";
import type { SnapshotAuthorityInput } from "./service";

const snapshotUrl = new URL(
  "./generated/ontology-snapshot.json",
  import.meta.url
);
const manifestUrl = new URL(
  "./generated/ontology-snapshot.manifest.json",
  import.meta.url
);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function readArtifact(path: URL): Buffer {
  try {
    return readFileSync(fileURLToPath(path));
  } catch (error) {
    throw new Error("snapshot_unavailable", { cause: error });
  }
}

export interface LoadedSnapshotSource {
  snapshot: OntologySnapshot;
  authority: SnapshotAuthorityInput;
}

export function loadSnapshotSource(): LoadedSnapshotSource {
  const snapshotBytes = readArtifact(snapshotUrl);
  const manifestBytes = readArtifact(manifestUrl);
  const artifactHash = `sha256:${sha256(snapshotBytes)}`;
  const sourceManifestHash = `sha256:${sha256(manifestBytes)}`;

  if (
    bundledManifest.schemaVersion !== 1 ||
    bundledManifest.kind !== "compiled_snapshot" ||
    bundledManifest.snapshotPath !== "ontology-snapshot.json" ||
    bundledManifest.snapshotSha256 !== artifactHash
  ) {
    throw new Error("snapshot_unavailable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("snapshot_unavailable", { cause: error });
  }

  return {
    snapshot: parseOntologySnapshot(parsed),
    authority: {
      kind: "project_snapshot",
      snapshotId: artifactHash,
      artifactHash,
      sourceManifestHash,
      generatedAt: (parsed as { generatedAt: string }).generatedAt,
      freshness: "static"
    }
  };
}
