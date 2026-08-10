import type { OntologySnapshot } from "../src/contracts";

export function makeSnapshot(): OntologySnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-08T06:00:00Z",
    database: "carbon-megamem-pilot",
    constraintSummary: { fixtures: 6, passed: 6 },
    datasets: [
      {
        id: "deepseek",
        label: "DeepSeek",
        namespace: "carbon-megamem-pilot-deepseek",
        model: "deepseek-v4-pro",
        stats: { objects: 2, episodes: 1, facts: 1, mentions: 2 },
        nodes: [
          {
            id: "node-a",
            name: "Alpha",
            types: ["CarbonProject"],
            summary: "The Alpha project.",
            status: "active",
            sourcePath: "项目开发/Carbon/Carbon 项目背景.md",
          },
          {
            id: "node-b",
            name: "Beta",
            types: [],
            summary: "A generic related object.",
          },
        ],
        edges: [
          {
            id: "edge-1",
            sourceId: "node-a",
            targetId: "node-b",
            relation: "dependsOn",
            fact: "Alpha depends on Beta.",
            episodeIds: ["episode-1"],
            validAt: "2026-08-01T00:00:00Z",
            classification: "defined",
          },
        ],
        episodes: [
          {
            id: "episode-1",
            name: "Carbon project background",
            sourcePath: "项目开发/Carbon/Carbon 项目背景.md",
            sourceDescription: "Approved Carbon source note.",
            createdAt: "2026-08-08T06:00:00Z",
            validAt: "2026-08-01T00:00:00Z",
          },
        ],
        mentions: [
          { id: "mention-1", episodeId: "episode-1", nodeId: "node-a" },
          { id: "mention-2", episodeId: "episode-1", nodeId: "node-b" },
        ],
      },
      {
        id: "qwen",
        label: "Qwen",
        namespace: "carbon-megamem-pilot-qwen",
        model: "qwen3:4b",
        stats: { objects: 1, episodes: 1, facts: 0, mentions: 1 },
        nodes: [
          {
            id: "qwen-node",
            name: "Qwen object",
            types: ["CarbonModule"],
            summary: "The Qwen comparison object.",
          },
        ],
        edges: [],
        episodes: [
          {
            id: "qwen-episode",
            name: "Qwen source",
            sourcePath: "项目开发/Carbon/Carbon 项目背景.md",
            sourceDescription: "Qwen source note.",
            createdAt: "2026-08-08T06:00:00Z",
            validAt: "2026-08-01T00:00:00Z",
          },
        ],
        mentions: [
          { id: "qwen-mention", episodeId: "qwen-episode", nodeId: "qwen-node" },
        ],
      },
    ],
  };
}
