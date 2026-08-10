import {
  type ContextQuery,
  type ContextResponse,
  type ProjectSnapshotAuthority as ContractSnapshotAuthority,
  contextQuerySchema,
  contextResponseSchema,
  type DatasetId,
  type MetadataResponse,
  metadataResponseSchema,
  type OntologyDataset,
  type OntologyEdge,
  type OntologyNode,
  type OntologySnapshot,
  parseOntologySnapshot,
  type SearchQuery,
  type SearchResponse,
  searchQuerySchema,
  searchResponseSchema
} from "./contracts";

export type SnapshotAuthorityInput = Omit<
  ContractSnapshotAuthority,
  "dataset" | "model"
> & {
  model?: string;
};

const MAX_RELATIONSHIPS = 100;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function displayType(node: OntologyNode): string {
  return node.types.length > 0 ? node.types.join(" · ") : "Unclassified";
}

function scoreNode(node: OntologyNode, query: string): number {
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(node.name);
  if (normalizedName === normalizedQuery) return 300;
  if (normalizedName.startsWith(normalizedQuery)) return 200;
  const indexed = normalize(
    [
      node.name,
      node.summary,
      displayType(node),
      node.status,
      node.sourcePath,
      node.locator
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
  );
  return normalizedQuery.split(" ").every((token) => indexed.includes(token))
    ? 100
    : 0;
}

function compareNode(left: OntologyNode, right: OntologyNode): number {
  const leftType = [...left.types].sort()[0] ?? "";
  const rightType = [...right.types].sort()[0] ?? "";
  return (
    leftType.localeCompare(rightType) ||
    normalize(left.name).localeCompare(normalize(right.name)) ||
    left.id.localeCompare(right.id)
  );
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^\d+$/.test(decoded)) throw new Error("invalid_query");
  const offset = Number(decoded);
  if (!Number.isSafeInteger(offset)) throw new Error("invalid_query");
  return offset;
}

function safeNode(
  node: OntologyNode,
  episodeIdsByNode: ReadonlyMap<string, readonly string[]>
) {
  return {
    ...node,
    displayType: displayType(node),
    sourceEpisodeIds: [...(episodeIdsByNode.get(node.id) ?? [])].sort()
  };
}

function authorityFor(
  authority: SnapshotAuthorityInput,
  dataset: OntologyDataset
): ContractSnapshotAuthority {
  return {
    kind: "project_snapshot",
    snapshotId: authority.snapshotId,
    artifactHash: authority.artifactHash,
    sourceManifestHash: authority.sourceManifestHash,
    dataset: dataset.id,
    model: dataset.model,
    generatedAt: authority.generatedAt,
    freshness: "static"
  };
}

function datasetMap(
  snapshot: OntologySnapshot
): Map<DatasetId, OntologyDataset> {
  return new Map(snapshot.datasets.map((dataset) => [dataset.id, dataset]));
}

export interface OntologyService {
  metadata(input: unknown): MetadataResponse;
  search(input: unknown): SearchResponse;
  context(input: unknown): ContextResponse;
}

export function createOntologyService(
  rawSnapshot: unknown,
  authority: SnapshotAuthorityInput
): OntologyService {
  const snapshot = parseOntologySnapshot(rawSnapshot);
  const datasets = datasetMap(snapshot);
  const indexes = new Map<
    DatasetId,
    {
      nodes: Map<string, OntologyNode>;
      episodes: Map<string, OntologyDataset["episodes"][number]>;
      outgoing: Map<string, OntologyEdge[]>;
      incoming: Map<string, OntologyEdge[]>;
      episodeIdsByNode: Map<string, string[]>;
    }
  >();

  for (const dataset of snapshot.datasets) {
    const nodeMap = new Map(dataset.nodes.map((node) => [node.id, node]));
    const episodeMap = new Map(
      dataset.episodes.map((episode) => [episode.id, episode])
    );
    const outgoing = new Map<string, OntologyEdge[]>();
    const incoming = new Map<string, OntologyEdge[]>();
    const episodeIdsByNode = new Map<string, string[]>();

    for (const edge of dataset.edges) {
      outgoing.set(edge.sourceId, [
        ...(outgoing.get(edge.sourceId) ?? []),
        edge
      ]);
      incoming.set(edge.targetId, [
        ...(incoming.get(edge.targetId) ?? []),
        edge
      ]);
    }
    for (const mention of dataset.mentions) {
      const episodeIds = episodeIdsByNode.get(mention.nodeId) ?? [];
      if (!episodeIds.includes(mention.episodeId))
        episodeIds.push(mention.episodeId);
      episodeIdsByNode.set(mention.nodeId, episodeIds);
    }
    indexes.set(dataset.id, {
      nodes: nodeMap,
      episodes: episodeMap,
      outgoing,
      incoming,
      episodeIdsByNode
    });
  }

  function getDataset(datasetId: DatasetId): OntologyDataset {
    const dataset = datasets.get(datasetId);
    if (!dataset) throw new Error("invalid_dataset");
    return dataset;
  }

  function isDatasetId(value: unknown): value is DatasetId {
    return value === "deepseek" || value === "qwen";
  }

  return {
    metadata(input) {
      const datasetId =
        typeof input === "string"
          ? input
          : (input as { dataset?: DatasetId }).dataset;
      const selectedDataset = datasetId ?? "deepseek";
      if (!isDatasetId(selectedDataset)) throw new Error("invalid_dataset");
      const dataset = getDataset(selectedDataset);
      const result = {
        authority: authorityFor(authority, dataset),
        contractVersion: 1,
        availableDatasets: snapshot.datasets
          .map(({ id, label, model, stats }) => ({ id, label, model, stats }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        dataset: { id: dataset.id, stats: dataset.stats },
        constraintSummary: snapshot.constraintSummary
      } satisfies MetadataResponse;
      return metadataResponseSchema.parse(result);
    },

    search(input) {
      const query = searchQuerySchema.parse(input) as SearchQuery;
      const dataset = getDataset(query.dataset);
      const index = indexes.get(dataset.id);
      if (!index) throw new Error("invalid_dataset");
      const filtered = dataset.nodes
        .filter((node) => {
          if (!query.type) return true;
          return query.type === "Unclassified"
            ? node.types.length === 0
            : node.types.includes(query.type);
        })
        .map((node) => ({ node, score: scoreNode(node, query.q) }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || compareNode(left.node, right.node)
        );
      const offset = decodeCursor(query.cursor);
      const results = filtered
        .slice(offset, offset + query.limit)
        .map(({ node }) => safeNode(node, index.episodeIdsByNode));
      const nextOffset = offset + results.length;
      const result = {
        authority: authorityFor(authority, dataset),
        results,
        ...(nextOffset < filtered.length
          ? { nextCursor: encodeCursor(nextOffset) }
          : {}),
        totalEstimate: filtered.length,
        warnings: nextOffset < filtered.length ? (["truncated"] as const) : []
      } satisfies SearchResponse;
      return searchResponseSchema.parse(result);
    },

    context(input) {
      const query = contextQuerySchema.parse(input) as ContextQuery;
      const dataset = getDataset(query.dataset);
      const index = indexes.get(dataset.id);
      if (!index) throw new Error("invalid_dataset");
      const node = index.nodes.get(query.objectId);
      if (!node) throw new Error("object_not_found");

      const edges = [
        ...(query.direction === "incoming" || query.direction === "both"
          ? (index.incoming.get(node.id) ?? []).map((edge) => ({
              edge,
              direction: "incoming" as const
            }))
          : []),
        ...(query.direction === "outgoing" || query.direction === "both"
          ? (index.outgoing.get(node.id) ?? []).map((edge) => ({
              edge,
              direction: "outgoing" as const
            }))
          : [])
      ].sort(
        (left, right) =>
          left.edge.relation.localeCompare(right.edge.relation) ||
          left.edge.id.localeCompare(right.edge.id) ||
          left.direction.localeCompare(right.direction)
      );
      const visibleEdges = edges.slice(
        0,
        Math.min(query.limit, MAX_RELATIONSHIPS)
      );
      const relationships = visibleEdges.map(({ edge, direction }) => {
        const relatedId =
          direction === "incoming" ? edge.sourceId : edge.targetId;
        const relatedNode = index.nodes.get(relatedId);
        if (!relatedNode) throw new Error("snapshot_unavailable");
        return {
          id: edge.id,
          direction,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relation: edge.relation,
          classification: edge.classification,
          fact: edge.fact,
          relatedObject: safeNode(relatedNode, index.episodeIdsByNode),
          episodeIds: edge.episodeIds,
          ...(edge.validAt ? { validAt: edge.validAt } : {}),
          ...(edge.invalidAt ? { invalidAt: edge.invalidAt } : {}),
          ...(edge.expiredAt ? { expiredAt: edge.expiredAt } : {})
        };
      });
      const provenance = [...(index.episodeIdsByNode.get(node.id) ?? [])]
        .map((episodeId) => index.episodes.get(episodeId))
        .filter((episode): episode is OntologyDataset["episodes"][number] =>
          Boolean(episode)
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id)
        );
      const result = {
        authority: authorityFor(authority, dataset),
        object: safeNode(node, index.episodeIdsByNode),
        relationships,
        provenance: provenance.map(
          ({ id, name, sourcePath, createdAt, validAt }) => ({
            id,
            name,
            sourcePath,
            createdAt,
            validAt
          })
        ),
        warnings:
          edges.length > relationships.length ? (["truncated"] as const) : []
      } satisfies ContextResponse;
      return contextResponseSchema.parse(result);
    }
  };
}
