# U8 BOM Recursive Import Design

## Summary

Add a command-line importer that reads the BOM actually assigned to current U8 production orders, recursively resolves current subassembly BOMs, emits a branch-preserving tree, and imports all involved parts and direct BOM edges into Carbon's existing item module.

No parallel BOM schema is introduced.

## Command

```powershell
node scripts/import-u8-bom-parts.cjs --company-id <company> --user-id <user> --dry-run --output <tree.json>
node scripts/import-u8-bom-parts.cjs --company-id <company> --user-id <user> --rollback --output <tree.json>
node scripts/import-u8-bom-parts.cjs --company-id <company> --user-id <user> --output <tree.json>
```

Default job scope is `source = 'U8 ERP'` and status in `Planned`, `Ready`, `In Progress`, or `Paused`.

## Source selection

1. Read current Carbon U8 work-order IDs.
2. Read `mom_orderdetail` for the root PartId and assigned BomId.
3. Use the assigned BOM when it exists and is approved.
4. Otherwise choose the latest currently effective approved BOM for that parent.
5. For each child PartId, select the latest currently effective approved BOM.
6. Include only currently effective component rows.
7. Store why each root selected its BOM: `assigned` or `fallback`.

## Recursive output

Each flat branch row contains:

- root item code and root BomId;
- source job/order IDs associated with the root;
- direct parent code, PartId, and BomId;
- child code, PartId, and OpComponentId;
- level;
- SortSeq and OpSeq;
- numerator and denominator;
- direct quantity per parent;
- cumulative quantity from the root;
- parent scrap and component scrap;
- ordered PartId path;
- ordered OpComponentId path;
- deterministic branch key.

The JSON output contains both flat rows and nested `children` arrays. Repeated child codes on different paths remain separate nodes.

## Carbon writes

### Items and part masters

For every root and descendant:

- find revision `0` Part item by `readableId + revision + companyId + type`;
- insert a missing item with U8 name, specification, unit, and source metadata;
- insert the missing `part` master keyed by `readableId + companyId`;
- create/update an `externalIntegrationMapping` with integration `u8-bom`;
- set items with a selected child BOM to `Make` / `Make to Order`;
- keep leaf inventory items as `Buy` / `Pull from Inventory` unless their U8 manufacturing flags require otherwise.

Existing non-U8 items with the same business key are treated as collisions and abort unless they are explicitly mapped during the import.

### Make methods

Each selected U8 BomId maps to exactly one Carbon `makeMethod`. The importer reuses an empty interceptor-created Draft method only when safe; otherwise it creates a new version. One current selected method per item becomes Active. Other U8 versions remain archived or draft without changing unrelated user methods.

### Method materials

Each U8 OpComponentId maps to exactly one `methodMaterial`:

- `makeMethodId`: parent BOM method;
- `itemId`: child item;
- `materialMakeMethodId`: selected child BOM method, if any;
- `quantity`: BaseQtyN / BaseQtyD;
- `order`: SortSeq with stable edge tie-breaking;
- `methodType`: copied from the child item;
- `itemType`: Part;
- `customFields.u8Bom`: source identifiers, direct parent, quantity inputs, and branch-independent source metadata.

Only stale rows already mapped by integration `u8-bom` may be removed.

## Safety

- U8 is read-only.
- PostgreSQL uses a company advisory lock and one transaction.
- `--dry-run` performs no writes.
- `--rollback` executes all writes and constraints, then rolls back.
- Source signatures are compared before commit.
- A committed rerun must produce zero new logical entities and the same source/target counts.
- No database rebuild, migration, or production-host change is required.

## Acceptance criteria

- 1,784 current jobs are represented in root selection.
- 1,006 root parts appear in the Carbon Parts view.
- All selected source items, BOMs, and edges reconcile with target mappings.
- Root-relative export preserves 8,264 branch occurrences and direct parent paths.
- Maximum depth is 5 and cycle count is zero for the current dataset.
- The sample root `13110202010100` preserves four first-level branches and the distinct repeated `372236000403` occurrences.
- Dry-run, rollback, commit, and idempotent rerun all report consistent counts.
