import { z } from "zod";

export const ENTITY_TYPES = [
  "CarbonProject",
  "CarbonStandard",
  "CarbonModule",
  "CarbonMigration",
  "CarbonSourceEvidence",
  "CarbonRisk",
  "CarbonDecision",
  "CarbonMilestone"
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type DatasetId = "deepseek" | "qwen";
const datasetIdSchema = z.enum(["deepseek", "qwen"]);

const isoTimestamp = z.string().datetime({ offset: true });
const nonEmptyString = z.string().min(1);
const boundedString = nonEmptyString.max(4096);

const nodeOptionalFields = {
  status: boundedString.optional(),
  owner: boundedString.optional(),
  sourcePath: boundedString.optional(),
  moduleType: boundedString.optional(),
  version: boundedString.optional(),
  ruleId: boundedString.optional(),
  evidenceType: boundedString.optional(),
  locator: boundedString.optional(),
  severity: boundedString.optional(),
  targetDate: boundedString.optional(),
  decisionDate: boundedString.optional(),
  reviewDate: boundedString.optional()
};

const ontologyTypeSchema = nonEmptyString.refine(
  (value): value is EntityType =>
    (ENTITY_TYPES as readonly string[]).includes(value),
  (value) => ({ message: `types contains ${value}` })
);

export const OntologyNodeSchema = z
  .object({
    id: nonEmptyString.max(256),
    name: boundedString,
    types: z.array(ontologyTypeSchema),
    summary: boundedString,
    ...nodeOptionalFields
  })
  .strict();

export const OntologyEdgeSchema = z
  .object({
    id: nonEmptyString.max(256),
    sourceId: nonEmptyString.max(256),
    targetId: nonEmptyString.max(256),
    relation: boundedString,
    fact: boundedString,
    episodeIds: z.array(nonEmptyString.max(256)),
    validAt: isoTimestamp.optional(),
    invalidAt: isoTimestamp.optional(),
    expiredAt: isoTimestamp.optional(),
    classification: z.enum(["defined", "observed"])
  })
  .strict();

export const OntologyEpisodeSchema = z
  .object({
    id: nonEmptyString.max(256),
    name: boundedString,
    sourcePath: boundedString,
    sourceDescription: boundedString,
    createdAt: isoTimestamp,
    validAt: isoTimestamp
  })
  .strict();

export const OntologyMentionSchema = z
  .object({
    id: nonEmptyString.max(256),
    episodeId: nonEmptyString.max(256),
    nodeId: nonEmptyString.max(256)
  })
  .strict();

export const OntologyStatsSchema = z
  .object({
    objects: z.number().int().nonnegative(),
    episodes: z.number().int().nonnegative(),
    facts: z.number().int().nonnegative(),
    mentions: z.number().int().nonnegative()
  })
  .strict();

export const OntologyDatasetSchema = z
  .object({
    id: z.enum(["deepseek", "qwen"]),
    label: boundedString,
    namespace: boundedString,
    model: boundedString,
    stats: OntologyStatsSchema,
    nodes: z.array(OntologyNodeSchema),
    edges: z.array(OntologyEdgeSchema),
    episodes: z.array(OntologyEpisodeSchema),
    mentions: z.array(OntologyMentionSchema)
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const episodeIds = new Set<string>();
    const mentionIds = new Set<string>();

    for (const node of dataset.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate node id ${node.id}`
        });
      }
      nodeIds.add(node.id);
    }
    for (const episode of dataset.episodes) {
      if (episodeIds.has(episode.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate episode id ${episode.id}`
        });
      }
      episodeIds.add(episode.id);
    }
    for (const edge of dataset.edges) {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate edge id ${edge.id}`
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${edge.id} references an unknown node`
        });
      }
      for (const episodeId of edge.episodeIds) {
        if (!episodeIds.has(episodeId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `edge ${edge.id} references an unknown episode`
          });
        }
      }
    }
    for (const mention of dataset.mentions) {
      if (mentionIds.has(mention.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate mention id ${mention.id}`
        });
      }
      mentionIds.add(mention.id);
      if (!episodeIds.has(mention.episodeId) || !nodeIds.has(mention.nodeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `mention ${mention.id} references an unknown item`
        });
      }
    }
    if (dataset.stats.objects !== dataset.nodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stats.objects does not match nodes"
      });
    }
    if (dataset.stats.episodes !== dataset.episodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stats.episodes does not match episodes"
      });
    }
    if (dataset.stats.facts !== dataset.edges.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stats.facts does not match edges"
      });
    }
    if (dataset.stats.mentions !== dataset.mentions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stats.mentions does not match mentions"
      });
    }
  });

export const OntologySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: isoTimestamp,
    database: z.literal("carbon-megamem-pilot"),
    constraintSummary: z
      .object({
        fixtures: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative()
      })
      .strict()
      .superRefine((summary, ctx) => {
        if (summary.passed > summary.fixtures) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "constraintSummary.passed exceeds fixtures"
          });
        }
      }),
    datasets: z.array(OntologyDatasetSchema)
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const ids = snapshot.datasets.map((dataset) => dataset.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate dataset id"
      });
    }
    if (
      ids.length !== 2 ||
      !ids.includes("deepseek") ||
      !ids.includes("qwen")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "snapshot.datasets must contain deepseek and qwen"
      });
    }
  });

export type OntologyNode = z.infer<typeof OntologyNodeSchema>;
export type OntologyEdge = z.infer<typeof OntologyEdgeSchema>;
export type OntologyEpisode = z.infer<typeof OntologyEpisodeSchema>;
export type OntologyMention = z.infer<typeof OntologyMentionSchema>;
export type OntologyDataset = z.infer<typeof OntologyDatasetSchema>;
export type OntologySnapshot = z.infer<typeof OntologySnapshotSchema>;

export function parseOntologySnapshot(value: unknown): OntologySnapshot {
  return OntologySnapshotSchema.parse(value);
}

const datasetQuery = datasetIdSchema.default("deepseek");
const limitQuery = z.number().int().min(1).max(50).default(50);

export const searchQuerySchema = z
  .object({
    dataset: datasetQuery,
    q: z.string().trim().min(1).max(200),
    type: z.enum(ENTITY_TYPES).or(z.literal("Unclassified")).optional(),
    limit: limitQuery,
    cursor: z.string().min(1).max(256).optional()
  })
  .strict();

export const contextQuerySchema = z
  .object({
    dataset: datasetQuery,
    objectId: nonEmptyString.max(256),
    direction: z.enum(["incoming", "outgoing", "both"]).default("both"),
    depth: z.literal(1).default(1),
    limit: limitQuery
  })
  .strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ContextQuery = z.infer<typeof contextQuerySchema>;

export const authoritySchema = z
  .object({
    kind: z.literal("project_snapshot"),
    snapshotId: nonEmptyString,
    artifactHash: nonEmptyString,
    sourceManifestHash: nonEmptyString,
    dataset: datasetIdSchema,
    model: nonEmptyString,
    generatedAt: isoTimestamp,
    freshness: z.literal("static")
  })
  .strict();

export type SnapshotAuthority = z.infer<typeof authoritySchema>;

const safeNodeSchema = OntologyNodeSchema.extend({
  displayType: nonEmptyString,
  sourceEpisodeIds: z.array(nonEmptyString)
}).strict();

const safeEpisodeSchema = OntologyEpisodeSchema.pick({
  id: true,
  name: true,
  sourcePath: true,
  createdAt: true,
  validAt: true
}).strict();

export const metadataResponseSchema = z
  .object({
    authority: authoritySchema,
    contractVersion: z.literal(1),
    availableDatasets: z.array(
      z
        .object({
          id: datasetIdSchema,
          label: boundedString,
          model: boundedString,
          stats: OntologyStatsSchema
        })
        .strict()
    ),
    dataset: z
      .object({ id: datasetIdSchema, stats: OntologyStatsSchema })
      .strict(),
    constraintSummary: z
      .object({
        fixtures: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

export const searchResponseSchema = z
  .object({
    authority: authoritySchema,
    results: z.array(safeNodeSchema),
    nextCursor: z.string().min(1).max(256).optional(),
    totalEstimate: z.number().int().nonnegative(),
    warnings: z.array(z.enum(["truncated"]))
  })
  .strict();

export const contextResponseSchema = z
  .object({
    authority: authoritySchema,
    object: safeNodeSchema,
    relationships: z.array(
      z
        .object({
          id: nonEmptyString,
          direction: z.enum(["incoming", "outgoing"]),
          sourceId: nonEmptyString,
          targetId: nonEmptyString,
          relation: boundedString,
          classification: z.enum(["defined", "observed"]),
          fact: boundedString,
          relatedObject: safeNodeSchema,
          episodeIds: z.array(nonEmptyString),
          validAt: isoTimestamp.optional(),
          invalidAt: isoTimestamp.optional(),
          expiredAt: isoTimestamp.optional()
        })
        .strict()
    ),
    provenance: z.array(safeEpisodeSchema),
    warnings: z.array(z.enum(["truncated"]))
  })
  .strict();

export type SafeNode = z.infer<typeof safeNodeSchema>;
export type MetadataResponse = z.infer<typeof metadataResponseSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ContextResponse = z.infer<typeof contextResponseSchema>;
