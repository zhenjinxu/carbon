# U8 Production BOM Part Import

## Purpose

`scripts/import-u8-bom-parts.cjs` reads the BOMs used by current U8 production
orders and imports the complete part master and manufacturing BOM graph into the
Carbon Items > Parts module.

It does not copy the BOM into existing job snapshots. It creates and maintains:

- revision 0 `item` rows of type `Part`;
- revision-independent `part` master rows;
- one mapped `makeMethod` for every selected U8 BOM;
- one mapped `methodMaterial` for every direct U8 BOM edge;
- `externalIntegrationMapping` records under integration `u8-bom`.

## Source Model

The Word source document was checked against the live U8 schema.

| Meaning | U8 source |
| --- | --- |
| BOM header | `bom_bom.BomId` |
| Parent part | `bom_parent.ParentId -> bas_part.PartId` |
| Direct child edge | `bom_opcomponent.OpComponentId` |
| Child part | `bom_opcomponent.ComponentId -> bas_part.PartId` |
| Direct quantity | `BaseQtyN / BaseQtyD` |
| Production assignment | `mom_orderdetail.BomId` |
| Approved status | `bom_bom.Status = 3` |

The importer preserves `OpComponentId` as the edge identity. It never collapses
rows by root code and child code because the same child may occur on multiple
branches with different direct and cumulative quantities.

For each current production order, an approved assigned BOM is preferred. If the
assigned ID is missing or not approved, the importer selects the latest approved
BOM effective on `--as-of`. The same rule is used when expanding manufactured
children.

## Safety Contract

- U8 is read only.
- Carbon uses a company-scoped advisory lock.
- `--dry-run` performs no business writes.
- `--rollback` executes the full target write path and then rolls it back.
- Commit mode writes the whole graph in one PostgreSQL transaction.
- U8 is read again before commit; a changed source signature aborts the Carbon
  transaction.
- Cycles, zero quantity denominators, excessive depth, ambiguous U8 PartIds,
  missing approved root BOMs, and unsafe Carbon item collisions fail closed.
- Stable external mappings make reruns idempotent. Unchanged item rows are not
  updated, so a no-op rerun does not emit search-index events.
- Existing WodiMES parts are reused only when they have WodiMES provenance and
  their item name exactly matches the U8 item name.
- Stale mapped U8 material edges are removed only within BOMs selected by the
  current import.

## Configuration

The command loads Carbon `.env` and `.env.local`, plus the configured U8 source
project `.env`. Configure these values without committing secrets:

- `SUPABASE_DB_URL`
- `U8_SERVER`, `U8_DATABASE`, `U8_USER`, `U8_PASSWORD`, optional `U8_PORT`
- `U8_CARBON_COMPANY_ID`
- `U8_CARBON_USER_ID`
- optional `WODIMES_SOURCE_ROOT` or `U8_CONNECTOR_SOURCE_ROOT`

`U8_CARBON_USER_ID` must identify a member of the target company and is used for
Carbon audit fields.

## Commands

Run from the repository root:

```powershell
pnpm u8:bom:import -- --dry-run
pnpm u8:bom:import -- --rollback
pnpm u8:bom:import
```

Explicit options can override the environment:

```powershell
pnpm u8:bom:import -- `
  --company-id <carbon-company-id> `
  --user-id <carbon-user-id> `
  --as-of 2026-07-30 `
  --max-depth 50 `
  --dry-run
```

Reports default to `.codex/work/u8-bom-parts/`. Use `--output <path>` to select a
different report file.

After rebuilding the ERP image, the same self-contained program is available
inside the container:

```bash
node /repo/scripts/import-u8-bom-parts.cjs --dry-run
```

The container must receive the same Carbon and U8 configuration through its
runtime environment or secret-loading entrypoint.

## 2026-07-30 Import Evidence

Source signature:

```text
64224d127d8efdeca96fd4f1c9e0e04ff702872a0a5b7424fd51641431fe9736
```

The dry run, rollback rehearsal, committed import, and idempotent rerun all used
that same signature.

| Check | Result |
| --- | ---: |
| Current U8 production orders | 1,784 |
| Root BOM selections | 1,006 |
| Fallback root selections | 15 |
| Selected BOMs | 1,011 |
| Direct BOM edges | 3,099 |
| Unique parts | 1,483 |
| Root-relative branch rows | 8,264 |
| Maximum depth | 5 |
| New Carbon items | 472 |
| New Carbon part masters | 1,483 |
| New Carbon methods | 1,011 |
| New Carbon material edges | 3,099 |
| Carbon identity collisions | 0 |

Post-commit reconciliation found exactly 1,483 item mappings, 1,011 make-method
mappings, and 3,099 material mappings. Every external ID and entity ID was
unique; there were no mapped items without a part master and no orphan material
mappings.

The committed rerun produced zero new items and zero new part masters while
reusing all 1,011 method and 3,099 material mappings.
The final no-op rerun left the PGMQ event sequence unchanged at 1,409,110,
proving that it emitted no new Carbon events.

## Branch Verification Example

For root part `192079030100`, Carbon contains these direct branches:

```text
192079030100 -> 192079030102  quantity 1
192079030100 -> 192079030101  quantity 1
```

The same descendant remains separate on both branches:

```text
192079030102 -> 372239001001  direct 1.3, cumulative 1.3
192079030101 -> 372239001001  direct 0.28, cumulative 0.28
```

The Carbon Parts UI showed the root method as active version 10, both direct
children with quantity 1, and child `192079030102` with material
`372239001001` at quantity 1.3.

## Reconciliation After Future Runs

Verify at minimum:

1. The source summary and signature are stable between the first and second U8
   reads.
2. Mapping counts equal the source part, BOM, and direct-edge counts.
3. No item mapping lacks a `part` master.
4. No material mapping lacks a `methodMaterial` row.
5. A repeated child on separate branches retains distinct parent codes,
   `OpComponentId` values, quantities, and edge paths.
6. A second committed run reports zero new logical entities.

Do not bypass a failed source-signature, cycle, collision, or approved-BOM check.
Resolve the source or identity issue and repeat dry-run and rollback rehearsal
before committing.
