# Obsidian Read-Only Ontology Browser Research

## Summary

This research covers a read-only Obsidian browser for the completed Carbon MegaMem pilot. The panel must make objects, relationships, evidence, and constraint status visible without enabling MegaMem's sync commands, storing Neo4j credentials, running a permanent MCP service, or modifying Markdown notes.

The strongest common pattern is a search-first object explorer with a compact result list and a focused detail view. Palantir separates semantic object/link modeling from actions and functions. Neo4j Bloom treats graph exploration as search plus relationship expansion. SAP separates named-graph metadata and query privileges from graph update privileges. Obsidian provides a native `ItemView` lifecycle for a dockable panel.

## Systems Surveyed

- **SAP HANA Cloud Knowledge Graph Engine**: relevant for named graphs, metadata, and explicit query/update privilege separation.
- **Palantir Ontology and Object Explorer**: relevant for object types, properties, links, evidence-aware object views, and the separation between semantic and kinetic layers.
- **Neo4j Bloom**: relevant for search-first graph exploration, suggestions, result cards, legend/type filtering, and neighborhood expansion.
- **Obsidian custom views**: relevant for a native right-sidebar panel with lifecycle cleanup and workspace integration.
- **MegaMem 1.7.6**: relevant as the existing extraction and Graphiti integration, but not as the panel runtime because its compiled plugin also exposes sync and schema-discovery commands.

## Research Questions

1. How should a user find and inspect an ontology object without learning Cypher?
2. How should source evidence and temporal context remain visible?
3. How can the browser remain technically incapable of modifying notes or graph data?
4. Which results should be presented as ontology-defined versus model-observed?
5. How should the existing Qwen and DeepSeek comparison namespaces be represented?

## Consensus Patterns

### 1. Search is the primary entry point

- Neo4j Bloom describes itself as a search-first graph environment and combines text search, graph-pattern suggestions, full-text search, and actions.
- Palantir Object Explorer begins from object search and then pivots to linked objects, properties, charts, and saved explorations.
- For Carbon, the first control should therefore be one search field over object name, summary, type, status, and source path. Cypher and raw graph internals should not be exposed.

### 2. Object identity, properties, links, and provenance stay together

- Palantir defines the semantic layer as objects, properties, and links mapped from integrated data sources.
- SAP exposes graph metadata such as class and predicate distributions separately from graph mutation.
- Carbon should show the selected object's stable UUID, ontology types, allowlisted properties, incoming/outgoing facts, and source Episodes in one detail view.

### 3. Read and write capabilities must be separate

- Palantir describes actions and functions as the kinetic layer that changes operational state; they are distinct from semantic object browsing.
- SAP documents separate privileges for querying, updating, dropping, and managing named graphs.
- The Carbon browser should contain no action types, graph mutation, sync, note creation, or file-management commands. Read-only should be an implementation property, not a UI promise.

### 4. The browser must reveal extraction quality

- The MegaMem ontology contains 14 approved relation names, while the live DeepSeek graph also contains model-observed relation names outside that set.
- A relation should therefore be labeled `defined` when its name belongs to the approved ontology and `observed` otherwise. Hiding this distinction would overstate ontology enforcement.

### 5. A snapshot is preferable for the first local panel

Four runtime approaches were compared:

| Approach | Benefits | Risks | Decision |
|---|---|---|---|
| Enable existing MegaMem panel | Already has Ontology/Analytics views | Also registers sync, schema discovery, current-note sync, scheduling, and file-menu behavior; only bundled JavaScript is installed | Reject for read-only panel |
| Direct Neo4j connection | Live data | Requires credentials and driver in Obsidian; expands attack and failure surface | Defer |
| Permanent read-only MCP | Live data and existing allowlist | Requires daemon lifecycle and bearer token availability | Defer |
| Sanitized build-time snapshot | No credentials, no network, works while Neo4j is stopped, deterministic tests | Refresh requires an explicit export/build/install step | Adopt for v1 |

## Current Carbon Graph Evidence

The restored DeepSeek namespace contains:

- 292 ontology entities plus 15 source Episodes.
- 424 fact relationships plus 508 Episode-to-entity `MENTIONS` relationships.
- Eight approved custom entity labels: Project, Standard, Module, Migration, SourceEvidence, Risk, Decision, and Milestone.
- Allowlisted entity fields such as status, owner, dates, version, rule ID, source path, evidence type, and locator.
- Fact fields including relation name, fact text, source/target UUIDs, Episode UUIDs, and temporal validity.

The panel must exclude embeddings, full Episode content, credentials, and unapproved arbitrary properties from its snapshot.

## Recommended Carbon Pattern

1. Create an independent `carbon-ontology-browser` Obsidian plugin under the MegaMem pilot workspace.
2. Export both completed namespaces into one versioned JSON snapshot using read-only Neo4j queries and property allowlists.
3. Compile the snapshot into the plugin bundle so runtime code performs no file, network, MCP, or database I/O.
4. Register one native Obsidian `ItemView`, one ribbon icon, and one `Open Ontology Browser` command.
5. Default to DeepSeek and provide Qwen as a comparison dataset.
6. Provide search, entity-type filtering, relationship navigation, source Episode inspection, and read-only opening of canonical source notes.
7. Display data freshness, namespace, source count, object count, fact count, and constraint-fixture status.
8. Mark relationships as ontology-defined or model-observed.
9. Keep the existing MegaMem plugin disabled and preserve source-note hashes before and after installation.

## Benefits Made Visible

The panel turns prior infrastructure work into user-visible outcomes:

- Scattered project notes become browsable business objects and relationships.
- Every extracted claim can be traced to source Episodes and note paths.
- Temporal fields and namespace metadata make model/batch provenance explicit.
- Qwen and DeepSeek outputs can be compared without rerunning extraction.
- Ontology-defined versus observed relations expose model drift instead of hiding it.
- Constraint fixture results show the difference between probabilistic extraction and deterministic enforcement.
- The complete view remains local and usable without sending a query to an online model.

## Sources

- Palantir Ontology overview: https://www.palantir.com/docs/foundry/ontology/overview/
- Neo4j Bloom visual tour: https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/
- Neo4j Bloom search bar: https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/search-bar/
- SAP Help Portal knowledge graph search: https://help.sap.com/docs/search?q=knowledge%20graph
- Obsidian custom views: https://docs.obsidian.md/Plugins/User+interface/Views
- Local MegaMem pilot research: `llm/research/megamem-obsidian-pilot.md`
- Local MegaMem pilot runtime: `.codex/work/megamem-pilot/README.md`
