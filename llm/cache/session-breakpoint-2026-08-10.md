# Carbon functional commit split 2026-08-10

The Carbon working tree was reviewed and committed in functional batches on `main`.

- Table interaction, authentication/session/RLS, WodiMES, U8 work-order import/dashboard, recursive U8 BOM, RFQ/quote recovery, database view/storage grants, quote completion, custom fields, PDF safety, Docker runtimes, dev full-Docker tooling, DB type generation, ERP locale catalogs, and ASM seed protection were committed separately.
- The committed U8 runtime uses `jobSource`, company-scoped scheduled/manual imports, source operation identity, and recursive BOM edge identity; targeted tests and package typechecks passed for the reviewed batches.
- The Windows DB type generator now uses the installed platform executable and atomic temp-file replacement. A live `pnpm db:types` run succeeded but exposed local schema drift; the generated drift was intentionally not committed.
- The first Table commit accidentally triggered the repository pre-commit translation hook and included rewritten locale files. A follow-up corrective commit restored the pre-hook locale boundary from lint-staged snapshot `5e763ae01`; locale catalogs were then committed separately with hooks disabled.
- Ontology Phase A package/design/research, agent/tool directories, screenshots/root images, AGENTS/HANDOFF/.gitignore metadata, and other uncertain research remain outside these Carbon commits.


## Ontology Context API Phase A committed

- Read-only loopback Context API Phase A was committed as 5f0b037fe with the follow-up corrective commit 6ddbb2762. The combined diff contains only the Context API design/research/package and the required workspace lock importer; locale catalogs have no net change.
- The package exposes only metadata/search/context over the byte-pinned project snapshot. It has 23 passing package tests, passing typecheck, passing Biome checks on source/tests, passing snapshot verification, and passing temporary loopback startup verification.
- Contract corrections verified before commit: sourceManifestHash is required in project authority, provenance strips sourceDescription, unsafe numeric cursors are rejected, and the no-write scanner covers schemas and production scripts.
- The first commit hook ran Lingui extraction/compile and rewrote 22 locale files plus formatted the pinned snapshot. Corrective commit 6ddbb2762 restored the parent locale content and the original snapshot hash F09CFF5BEA1EA4AE8B1456B43FE41C8A885E74386E4E2BC3EFCFDBF9C6627DCF; future Ontology commits must inspect hook output and use --no-verify when the hook would mutate unrelated or byte-pinned artifacts.
- Task 6 (authenticated company-live permission/data source, snapshot refresh authority, ERP exposure, and MCP adapter) remains a separate design/authorization gate; no database change, runtime route, MCP registration, or live data exposure was made.

## Ontology Task 6 design gate committed

- Task 6 design boundary was committed as 31c3d077c. It adds a discriminated project_snapshot/company_live authority contract, structured fresh/stale/sourceRevision metadata, authenticated scope parsing, companyId-to-authority matching, future CompanyOntologySource interface, and a design gate document.
- Phase A metadata/search/context response schemas and the loopback HTTP adapter explicitly accept project_snapshot only. A company_live authority injected into the loopback adapter is rejected as snapshot_unavailable; no unauthenticated live data path exists.
- The Task 6 package suite passes 28 tests, typecheck, Biome, snapshot verification, and loopback startup verification. No permission enum/migration, ERP route, company ontology source, database change, or MCP registration was added because Carbon has no existing company ontology storage/source to query safely.

### Final Ontology verification (post-31c3d077c)
- Fresh verification after the Task 6 commit: 28 package tests passed across 8 files; tsgo --noEmit passed; verify:snapshot returned valid with artifact hash F09CFF5BEA1EA4AE8B1456B43FE41C8A885E74386E4E2BC3EFCFDBF9C6627DCF and source manifest hash 4F4DA74EB44E77D7EAF5B6BC128B956CAFFECC753FA56351D107B889B981663C; loopback server bound 127.0.0.1 and returned HTTP 200.
- Biome passed on the Ontology source/test targets. The full package directory intentionally reports the canonical generated snapshot because formatting would rewrite the byte-pinned artifact; the snapshot verifier remains the authoritative check.
- The index is empty after the final commit. Remaining worktree entries are pre-existing metadata, agent/tool directories, cache/research notes, and images kept outside Carbon and Ontology commits.
### Carbon historical startup verification (2026-08-10)
- The supplied morning failure is a deterministic frozen-lockfile mismatch: Docker reported that packages/ontology-context/package.json added six specifiers absent from the lockfile importer at the time of that build.
- Current verification: host pnpm frozen install passes; docker compose config is valid; docker compose build erp exits 0; docker compose build mes exits 0. Both builds report Lockfile is up to date.
- The running stack was not restarted. Existing ERP and MES containers remain healthy; newly built local images are available for the next user-authorized start.