# Read-Only Ontology Context API Research

## Summary

This research covers the next optional phase after the Carbon Ontology Browser: a narrow, read-only context API for AI-assisted development. The API should expose stable ontology objects, bounded relationships, provenance, constraint status, and snapshot authority without exposing graph credentials, note bodies, model prompts, database writes, or production actions. Existing Carbon evidence and the previously completed browser research are combined with the public patterns documented by Palantir, SAP, Neo4j, and the Model Context Protocol.

## Competitors Surveyed

- **Palantir Foundry Ontology** - semantic objects and links are separated from the kinetic action/function layer.
- **SAP HANA Cloud Knowledge Graph** - graph query and graph update capabilities are governed by separate metadata and privileges.
- **Neo4j Bloom** - search-first graph exploration, bounded neighborhood expansion, and visible relationship/type context.
- **Model Context Protocol tools** - machine-readable tool schemas and read-only/destructive capability annotations.
- **Carbon MegaMem pilot** - the local source of the already validated DeepSeek/Qwen snapshots and provenance contract.

## Key Consensus Patterns

### 1. Semantic context is separate from actions

- **Palantir** models objects, properties, and links in an ontology while actions and functions form a separate kinetic layer.
- **SAP** distinguishes graph querying from graph update and administration privileges.
- **Recommendation for Carbon:** the first API exposes only query operations. Release, reserve, post, migrate, sync, and note-writing actions are separate future work and must not share this endpoint.

### 2. Search and object lookup are bounded

- **Neo4j Bloom** uses search as the entry point and expands a selected neighborhood instead of dumping the whole graph.
- **Recommendation for Carbon:** require a bounded search query or stable object ID, cap page size and relationship expansion depth, and return an explicit truncation warning.

### 3. Provenance and authority remain in every response

- **Palantir** keeps object/link semantics tied to source integrations; **SAP** exposes graph metadata independently of graph content.
- **Recommendation for Carbon:** return snapshot ID, dataset/model, generation time, source manifest hash, constraint-fixture status, and source Episodes alongside facts. Never present a static model snapshot as current inventory, job, quality, or financial state.

### 4. Read-only must be enforceable at the capability boundary

- **MCP** provides structured schemas and read-only/destructive hints, but hints alone do not prevent a server from registering a write tool.
- **Recommendation for Carbon:** use a separate read-only adapter/route with an allowlisted operation set. Do not route Context API calls through the existing generic `call_tool` dispatcher, whose surface includes WRITE and DESTRUCTIVE services.

### 5. Tenant scope comes from authentication, never query arguments

- Carbon's existing MCP authentication resolves `userId` and `companyId` from OAuth/API-key context, and the cache documents that caller-supplied tenant IDs must not override that context.
- **Recommendation for Carbon:** reject `companyId` in the public input schema. A future live adapter must use the authenticated company scope and ordinary RLS/service-layer checks. The current project snapshot is not company data and therefore should remain a local/internal development surface until it is partitioned or explicitly authorized.

### 6. Probabilistic extraction and deterministic constraints are different facts

- The completed pilot preserves generic nodes as `types: []`, marks `Unclassified` only as a UI-derived label, and classifies relations as ontology-defined or model-observed.
- **Recommendation for Carbon:** expose these distinctions in the API response; do not infer a missing type, hide an observed relation, or convert fixture status into a business authorization decision.

## Competitor-Specific Details

### Palantir

The ontology is a semantic layer for object types, properties, and links. Actions/functions are modeled separately because they can change operational state. Carbon should retain this separation even if the first implementation is a small local API.

### SAP

Knowledge-graph metadata and query/update privileges are independently controlled. This supports a Carbon contract where snapshot metadata and read queries are available to an explicitly authorized caller, while graph mutation and operational writes are absent from the process.

### Neo4j

Bloom's search-first interaction and neighborhood expansion are a useful response shape: a compact object, grouped incoming/outgoing relations, and a controlled number of related objects. Raw Cypher and unbounded traversal are inappropriate for an AI context endpoint.

### Model Context Protocol

Tool schemas and annotations improve client behavior but are not an authorization mechanism. A Carbon MCP adapter should expose only the two or three read operations defined by the Context API and should keep write tools on the existing, separately governed surface.

## Recommended Approach for Carbon

1. Start with a local, loopback-only HTTP adapter over the immutable browser snapshot. This proves the contract without connecting to Neo4j, Ollama, MCP, Supabase, or production ERP data.
2. Use a versioned, allowlisted response contract based on the browser's validated `OntologySnapshot`; omit Episode bodies, embeddings, credentials, arbitrary Neo4j properties, and model prompts.
3. Provide `metadata`, `search`, and `context` read operations with hard limits, deterministic ordering, and explicit `authority: project_snapshot` metadata.
4. Add a future MCP read adapter only after the HTTP contract and authorization tests pass. It must not use the broad generic `call_tool` dispatcher.
5. Treat a company-scoped live adapter as a separate phase. It requires a verified `ontology` read permission, authenticated `companyId` derivation, RLS/service-layer tests, freshness semantics, and a real-data browser/API evaluation.

## Sources

- [Palantir Foundry Ontology overview](https://www.palantir.com/docs/foundry/ontology/overview)
- [Neo4j Bloom visual tour](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/)
- [Neo4j Bloom search bar](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/search-bar/)
- [SAP Help Portal knowledge graph search](https://help.sap.com/docs/search?q=knowledge%20graph)
- [Model Context Protocol tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Carbon Ontology Browser research](obsidian-read-only-ontology-browser.md)
- [Carbon Ontology and AI operating guide](E:/AI_Project_Vault/项目开发/Carbon/Carbon%20Ontology%20与%20AI%20开发运行应用说明.md)
