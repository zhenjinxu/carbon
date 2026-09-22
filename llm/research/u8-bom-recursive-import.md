# U8 BOM Recursive Import Research

## Scope

Read `C:\Users\zhenjin_xu\Desktop\用友数据库零件-子件.docx`, inspect the live U8 SQL Server schema, inspect Carbon's current Docker PostgreSQL data, and map the source BOM into Carbon's existing item/method model.

External competitor browsing was attempted but the local network could not reach the search endpoint. No unverified competitor claim is used below. The authoritative inputs are the user document, live U8 schema/data, live Carbon schema/data, and current repository code.

## Source findings

The document's recursive CTE returns a root code, descendant code, cumulative quantity, and level. It loses the direct parent and path, so repeated descendants under different branches cannot be distinguished.

Verified U8 source keys:

| Entity | Stable key | Important fields |
|---|---|---|
| BOM | `bom_bom.BomId` | Version, effective dates, Status |
| BOM parent | `bom_parent.AutoId` | BomId, ParentId, ParentScrap |
| BOM edge | `bom_opcomponent.OpComponentId` | BomId, ComponentId, SortSeq, BaseQtyN, BaseQtyD, CompScrap, effective dates |
| Part | `bas_part.PartId` | InvCode |
| Item master | `Inventory.cInvCode` | name, specification, unit, purchasing/manufacturing flags |
| Production order BOM | `mom_orderdetail.BomId` | actual BOM assigned to the order |

Quantity per direct parent is `BaseQtyN / BaseQtyD`. The live source has 751,564 edges on approved BOMs, no zero denominator, and three non-unit denominators.

Thirty-two U8 parts have multiple approved BOMs. Current production orders therefore use their assigned `mom_orderdetail.BomId` when it resolves to an approved BOM. If the assigned ID is missing from `bom_bom`, the importer selects the latest currently effective approved BOM for that parent.

## Current production scope

Carbon company `上海沃迪智能装备` currently has:

- 1,784 U8 ERP production jobs;
- 1,006 distinct root items;
- 1,006 root items missing their `part` master row;
- 1,006 root items missing a `makeMethod`;
- exactly one null-parent `jobMakeMethod` on all 1,784 jobs.

A read-only source expansion selected:

- 1,006 root BOM variants;
- 1,011 BOM definitions including subassemblies;
- 3,099 unique direct source edges;
- 1,483 unique part codes;
- 8,264 root-relative branch occurrences;
- maximum depth 5;
- zero cycles;
- 717 descendants repeated across different branches.

## Carbon mapping

Carbon already models a tree:

- `item`: revision-specific item row;
- `part`: revision-independent part master keyed by readable item ID plus company;
- `makeMethod`: a versioned BOM for one item;
- `methodMaterial`: a direct edge from a parent make method to a component item;
- `methodMaterial.materialMakeMethodId`: link to the component's own make method for recursive expansion;
- `get_method_tree` and BoM Explorer: existing recursive tree read and UI.

The generic CSV UI exposes `methodMaterial`, but its edge-function implementation explicitly throws `Not implemented`. The U8 work-order importer creates root items/jobs/operations only and creates neither `part` masters nor item BOMs.

## Required import invariants

1. Preserve every U8 `OpComponentId`; do not deduplicate by child code.
2. Preserve direct parent, child, root, level, source edge path, and cumulative quantity in the exported tree.
3. Use fixed decimal arithmetic for both direct and cumulative quantities.
4. Reject invalid quantities, missing codes, cycles, and depth overflow.
5. Scope every Carbon read/write by company.
6. Use one PostgreSQL transaction for items, part masters, methods, materials, and mappings.
7. Use an advisory lock to prevent concurrent imports.
8. Use `externalIntegrationMapping` for U8 item, BOM, and edge identities.
9. Reconcile only U8-managed edges; never delete user-authored BOM rows.
10. Re-read and hash the selected U8 source before commit to detect source drift.
11. Support analysis-only dry-run and full-write rollback modes before commit.
