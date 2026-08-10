import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const generatedDir = new URL("../src/generated/", import.meta.url);
const snapshotPath = fileURLToPath(new URL("ontology-snapshot.json", generatedDir));
const manifestPath = fileURLToPath(new URL("ontology-snapshot.manifest.json", generatedDir));

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function fail(message) {
  throw new Error(`snapshot verification failed: ${message}`);
}

const snapshotBytes = readFileSync(snapshotPath);
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
const artifactHash = `sha256:${hash(snapshotBytes)}`;

if (manifest.schemaVersion !== 1 || manifest.kind !== "compiled_snapshot") {
  fail("manifest schema or kind is invalid");
}
if (manifest.snapshotPath !== "ontology-snapshot.json") {
  fail("manifest path is invalid");
}
if (manifest.snapshotSha256 !== artifactHash) {
  fail(`artifact hash mismatch: expected ${manifest.snapshotSha256}, got ${artifactHash}`);
}
if (snapshot.schemaVersion !== 1 || snapshot.database !== "carbon-megamem-pilot") {
  fail("snapshot identity is invalid");
}
if (snapshot.datasets?.length !== 2) fail("snapshot must contain two datasets");
const datasetIds = new Set(snapshot.datasets.map((dataset) => dataset.id));
if (!datasetIds.has("deepseek") || !datasetIds.has("qwen")) {
  fail("snapshot must contain deepseek and qwen");
}
for (const dataset of snapshot.datasets) {
  if (dataset.stats.objects !== dataset.nodes.length) fail(`${dataset.id} object count mismatch`);
  if (dataset.stats.episodes !== dataset.episodes.length) fail(`${dataset.id} Episode count mismatch`);
  if (dataset.stats.facts !== dataset.edges.length) fail(`${dataset.id} fact count mismatch`);
  if (dataset.stats.mentions !== dataset.mentions.length) fail(`${dataset.id} mention count mismatch`);
}

console.log(JSON.stringify({
  valid: true,
  artifactHash,
  sourceManifestHash: `sha256:${hash(manifestBytes)}`,
  datasets: snapshot.datasets.map((dataset) => ({ id: dataset.id, stats: dataset.stats })),
}));
