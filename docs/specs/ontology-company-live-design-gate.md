# Authenticated Company-Live Ontology Design Gate

## Outcome

Carbon does not currently have a company-scoped ontology table, service, refresh pipeline, or authoritative mapping from operational ERP records to the project ontology. Task 6 therefore stops at a typed adapter boundary. It does not label the project snapshot as live data and does not add a database migration, ERP route, or MCP registration.

## Decisions

### Permission

The future permission is ontology_view. It must be introduced as a dedicated Ontology permission module through the database migration workflow. It must not reuse settings_view or another broad permission.

The permission migration is deferred until an authoritative company ontology source exists. Adding the enum now would expose a non-functional module in employee and API-key permission UIs.

### Authentication and tenant scope

An ERP route must call requirePermissions(request, { view: "ontology" }). The returned userId and companyId become the only authenticated scope passed to CompanyOntologySource. Request query strings and bodies must reject companyId and userId.

Session, OAuth, and API-key callers use the same typed scope. API-key rate limits and scope checks remain in requirePermissions.

### Data authority and freshness

A company-live response uses authority.kind = company_live and includes the server-derived companyId, dataset/model identity, sourceRevision, generatedAt, and structured freshness metadata.

A stale response must declare staleAt. Project snapshot authority remains a separate discriminated branch and cannot contain companyId.

No source may claim company_live until it has a company predicate or RLS evidence, a stable source revision, and observedAt/staleAt semantics proven against real data.

### Refresh authority

There is no HTTP or MCP refresh operation. Snapshot replacement must remain an explicit build or deployment action that verifies a canonical signed source manifest before replacing bytes. Runtime callers can read metadata but cannot refresh, sync, infer, or mutate ontology data.

### HTTP and MCP sequence

The authenticated HTTP adapter is the first possible production surface after a real source exists. A future MCP adapter may wrap only metadata, search, and context after HTTP authentication and isolation tests pass.

The generic Carbon call_tool dispatcher is not an acceptable boundary because its registry contains write and destructive tools.

## Implementation gate

Before adding a company-live ERP route or permission migration, all of the following evidence is required:

1. A committed company ontology storage/source design with explicit companyId ownership.
2. Real JWT/OAuth and API-key tests for unauthenticated, forbidden, and allowed access.
3. Cross-company isolation tests for every query path.
4. RLS or explicit company predicate evidence, including service-role boundary tests.
5. Bounded pagination and response-size tests against production-scale data.
6. Fresh, stale, and unavailable source tests with stable timestamps and source revision.
7. A separate security review before MCP registration.

Until those conditions exist, CompanyOntologySource is an interface only and no company-live response is reachable at runtime.