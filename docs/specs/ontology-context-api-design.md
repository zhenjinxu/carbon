# Read-Only Ontology Context API Design

## Summary

The next Carbon Ontology phase is a narrow, read-only context API for AI-assisted development. It will answer bounded questions about a validated ontology snapshot: which object is being discussed, what approved or model-observed relationships surround it, which source Episodes support the facts, and when the snapshot was generated. The first implementation is deliberately local and loopback-only over the existing immutable DeepSeek/Qwen snapshot. It does not connect to Neo4j, Ollama, MCP, Supabase, the ERP database, Markdown notes, or production actions.

## Scope

### Included

- A versioned response contract derived from the validated Ontology Browser snapshot.
- Three read operations: `metadata`, `search`, and `context`.
- Deterministic ordering, bounded limits, depth-one relationship expansion, provenance references, and explicit truncation warnings.
- Schema validation for all query parameters and all emitted responses.
- Request IDs, duration/result-count logging, and redacted errors.
- A future adapter boundary for authenticated company-scoped live data, without implementing that adapter in this phase.

### Excluded

- Neo4j or Ollama connections.
- Snapshot refresh, model inference, sync, graph mutation, note mutation, or file management.
- ERP inventory, job, quality, financial, or user data.
- Any write-capable MCP tool, generic `call_tool` delegation, SQL execution, or business action.
- A database migration or a change to the installed Obsidian plugin.

## Research

Key findings from `llm/research/ontology-context-api.md`:

- Palantir and SAP separate semantic query surfaces from operational actions and graph updates.
- Neo4j Bloom favors search-first, bounded neighborhood expansion rather than unbounded traversal.
- MCP schemas and annotations help clients but cannot replace server-side capability enforcement.
- Carbon already has a strict snapshot contract, provenance references, generic-node handling, and model-observed relation classification.
- Carbon's existing generic MCP dispatcher exposes write operations and is not an acceptable default boundary for this API.

## Decisions

### 1. Where does the first API run?

**Question:** Should the first API query the live graph or the validated snapshot?

**Industry:** Semantic products separate a stable ontology/query surface from operational mutation. The completed Carbon pilot also proved that a sanitized snapshot remains usable when Neo4j, Ollama, and MCP are stopped.

**Our Approach:** Build a loopback-only local adapter over the existing JSON snapshot. The response must state `authority.kind = "project_snapshot"`, the dataset/model, `snapshotId`, `generatedAt`, and source-manifest hash. A future live/company adapter is a separate design and authorization gate.
**Phase A manifest note:** The current exporter does not embed a canonical Vault source-manifest hash. `sourceManifestHash` therefore hashes the compiled artifact manifest that pins the snapshot bytes. It proves artifact identity and integrity, not source-note freshness; a refresh or company-live phase must introduce a canonical signed source manifest before making freshness claims.


### 2. What is the public operation set?

**Question:** How much graph functionality should an AI caller receive?

**Industry:** Search-first graph explorers expose lookup and controlled relationship expansion; broad query languages increase data and denial-of-service risk.

**Our Approach:** Expose exactly:

- `GET /api/ontology/metadata` - dataset, counts, snapshot and constraint metadata.
- `GET /api/ontology/search?q=...&dataset=...&type=...&limit=...&cursor=...` - bounded object search.
- `GET /api/ontology/context?objectId=...&dataset=...&direction=...&limit=...` - one object, allowlisted properties, depth-one incoming/outgoing relations, related object summaries, and provenance.

No Cypher, arbitrary property selectors, recursive depth, mutation, sync, or action operation is part of the contract.

### 3. How is the tenant boundary represented?

**Question:** How can project engineering context coexist with future company data?

**Industry:** Carbon authentication resolves tenant scope from the token; callers must not override it with a request parameter.

**Our Approach:** The local snapshot API has no company data and is marked `project_snapshot`; it is enabled only for loopback/internal development. The request schema rejects `companyId`. A future live adapter must receive an authenticated context object with `userId` and `companyId`, enforce a dedicated `ontology` read permission, and query only through approved services/RLS. It must never reuse a settings permission or trust a caller-supplied company ID.

### 4. Which fields are safe to return?

**Question:** How much source and graph detail is necessary for useful AI context?

**Industry:** Object explorers combine identity, properties, links, and provenance, but do not require raw graph storage internals.

**Our Approach:** Return the existing allowlisted node fields, edge relation/fact/temporal fields, related-node summaries, and Episode identity/path/timestamps. Do not return Episode bodies, embeddings, Neo4j labels/properties not in the contract, credentials, prompts, or arbitrary source text. Keep `sourcePath` only when it passed the approved Markdown-path check already used by the snapshot exporter.

### 5. How are model uncertainty and constraints shown?

**Question:** Should the API normalize away generic nodes and observed relations?

**Industry:** Ontology systems distinguish modeled semantics from observed or source-derived data.

**Our Approach:** Preserve generic nodes as `types: []`; expose a derived `displayType: "Unclassified"` only in the response convenience field. Preserve `classification: "defined" | "observed"` on every relation. Include deterministic constraint fixture counts as evaluation metadata, never as an authorization or business-state claim.

### 6. What are the safety limits?

**Question:** How do we prevent oversized or expensive context responses?

**Industry:** Search-first graph products bound result pages and neighborhood expansion.

**Our Approach:** Enforce `q` length 1-200, `limit` 1-50, at most 100 relation records per context response, `direction` in `incoming|outgoing|both`, and no depth greater than one. Use opaque cursors for search, deterministic `(score, type, normalizedName, id)` ordering, a 256 KiB serialized response cap, and a `truncated` warning when a limit is hit.

## API Contract

### Common envelope

```json
{
  "schemaVersion": 1,
  "requestId": "req_...",
  "authority": {
    "kind": "project_snapshot",
    "snapshotId": "sha256:...",
    "dataset": "deepseek",
    "model": "...",
    "generatedAt": "2026-08-08T06:00:00Z",
    "sourceManifestHash": "sha256:...",
    "freshness": "static"
  },
  "data": {},
  "warnings": []
}
```

`requestId` is generated server-side. `authority` is mandatory so an AI client cannot mistake the snapshot for live ERP state.

### Metadata response

`data` contains the selected dataset's object, fact, Episode, and mention counts, the available datasets, the constraint-fixture summary, and the contract version. It contains no node or Episode body.

### Search response

`data` contains `{ results, nextCursor, totalEstimate }`. Each result contains `id`, `name`, `types`, derived `displayType`, `summary`, safe optional properties, and an array of source Episode IDs. Search never returns full edge facts; the caller must request a specific context.

### Context response

`data` contains:

```json
{
  "object": {
    "id": "...",
    "name": "...",
    "types": [],
    "displayType": "Unclassified",
    "summary": "...",
    "properties": {},
    "sourceEpisodeIds": ["..."]
  },
  "relationships": [
    {
      "id": "...",
      "direction": "outgoing",
      "sourceId": "...",
      "targetId": "...",
      "relation": "dependsOn",
      "classification": "defined",
      "fact": "...",
      "relatedObject": { "id": "...", "name": "...", "types": [], "summary": "..." },
      "episodeIds": ["..."],
      "validAt": "..."
    }
  ],
  "provenance": [
    { "id": "...", "name": "...", "sourcePath": "...", "createdAt": "...", "validAt": "..." }
  ]
}
```

The service must omit absent optional fields rather than serializing `null` placeholders. Multiple mention UUIDs remain distinct even when their Episode/node endpoints match.

### Error contract

Errors use `{ schemaVersion, requestId, error: { code, message } }` with no stack, SQL, file system path, token, or prompt. Required codes are `invalid_query` (400), `unauthenticated` (401), `forbidden` (403), `object_not_found` (404), `response_too_large` (413), `rate_limited` (429), and `snapshot_unavailable` (503).

## Data Model and Adapter Boundary

The first adapter reads the immutable `OntologySnapshot` contract already validated by the browser plugin. It creates in-memory indexes by dataset/node/edge/Episode and never writes back to the source artifact. The service boundary should be expressed as:

```ts
interface OntologyContextSource {
  metadata(dataset: DatasetId): Promise<OntologyMetadata>;
  search(input: SearchInput): Promise<SearchResultPage>;
  context(input: ContextInput): Promise<ContextResult>;
}
```

The snapshot source is the only implementation in Phase A. A future `CompanyOntologySource` is allowed only after its query methods accept authenticated scope and return an explicit `authority.kind = "company_live"` with freshness metadata. The two sources must not be silently merged in one response.

## Workflow

1. AI calls `metadata` and records the snapshot authority.
2. AI calls `search` for a bounded candidate set.
3. AI calls `context` for one or more stable IDs and receives relationships plus provenance.
4. AI produces an impact analysis and identifies files/tests; the deterministic Carbon service remains the final decision maker.
5. Human or approved engineering workflow performs any code, schema, permission, or runtime change.

## Edge Cases

- Empty search results return a successful empty page, not an error.
- An unknown dataset or malformed cursor is `invalid_query`.
- An object missing from the selected dataset is `object_not_found`; do not fall back to the other model namespace.
- Generic nodes are valid and display as `Unclassified`; unknown non-empty ontology types remain invalid snapshot data.
- Observed relation names are returned with `classification: "observed"`.
- Invalid or unapproved source paths are omitted and surfaced only through a non-sensitive warning count.
- A selected object with no relationships or provenance is valid and returns empty arrays.
- Relationship or response limits produce deterministic results and a `truncated` warning.
- Snapshot hash or schema mismatch prevents startup and returns `snapshot_unavailable`; the API must not serve partially parsed data.
- The API must never interpret a project snapshot as current inventory, production status, permission, or financial truth.

## Verification and Exit Criteria

- Contract tests cover valid metadata/search/context responses, all limits, empty results, generic nodes, observed relations, duplicate mention identity, and every error code.
- Security tests prove no write function, graph driver, model client, Supabase client, file mutation, or generic MCP dispatcher is imported by the local adapter.
- Determinism tests compare repeated serialized responses and verify the source snapshot hash.
- Runtime tests use a loopback server with the snapshot only; no database rebuild, Obsidian change, Neo4j/Ollama startup, or MCP service is required.
- A future company-live phase must add authenticated JWT/API-key tests, permission checks, company isolation, RLS/service-role evidence, pagination at production scale, and freshness checks before deployment.

## Open Questions Before Implementation

1. Should the local API be consumed only by developer tools, or should an authenticated ERP route eventually expose the project snapshot?
2. Which existing permission registry and action name should own a future company-live `ontology` read permission?
3. Who is authorized to refresh or replace the snapshot, and where should the signed source manifest be stored?
4. Is a future MCP adapter required in the first implementation, or is the HTTP contract sufficient for the initial AI workflow?

## Non-Goals Confirmed at This Checkpoint

- No production write Action is designed or enabled.
- No Obsidian plugin, note, graph database, MCP configuration, Carbon database, or installed runtime is changed by this design task.
