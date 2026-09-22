# Parts Test Cleanup Delete Design

## Summary

Parts that are already referenced by manufacturing structures cannot be hard-deleted safely through the normal delete path. For test-stage cleanup, Carbon needs a separate developer-only flow that archives the rows needed for recovery, removes editable BOM references first, and then deletes the selected test parts in one transaction.

## Scope

This first version supports the practical failure reported on `/x/items/parts`: a Part blocked by `methodMaterial.itemId` references. It does not force-delete parts that are already referenced by historical business records such as jobs, inventory, quotes, sales orders, purchase invoices, stock transfers, tracked entities, or picking lists. Those remain protected and should be deactivated until a stricter per-domain cleanup workflow is designed.

## Design Decisions

### Deletion mode

- Normal bulk delete remains conservative and blocks when selected parts are used in BOM materials.
- Developer-only archived cleanup mode can remove `methodMaterial` rows that reference the selected parts, then delete the parts.
- If the database reports any remaining foreign-key restriction, the route returns a generic actionable message instead of exposing table or constraint names.

### Archive model

- Add a company-scoped `deletionArchive` table.
- Store one archive envelope per root deleted item.
- The envelope contains the root item ID/type, reason, and JSON snapshots of the item and the BOM material rows deleted before the item.
- Keep `restoredAt/restoredBy` nullable for a later recovery UI/API.

### Authorization

- Require a real user session; API keys cannot use this flow.
- Require `parts_delete` permission.
- Require the server-side `user.developer === true` check already used by bulk deletion.

### Restore posture

- V1 creates recoverable archive records but does not implement one-click restore.
- Restore is intentionally deferred because full restoration must validate ID conflicts, standard related rows, BOM parent methods, and any records recreated after deletion.

## Workflow

1. User selects rows on `/x/items/parts`.
2. Developer chooses archive cleanup in the destructive confirmation modal and enters a reason.
3. Server validates selected IDs, current company, developer identity, and reason.
4. Transaction locks selected item rows and referencing `methodMaterial` rows.
5. Transaction inserts archive envelopes.
6. Transaction deletes referencing `methodMaterial` rows.
7. Transaction deletes selected item rows.
8. UI clears selection, refreshes the table, and shows success.

## Edge Cases

- Duplicate or empty part IDs are rejected before opening the transaction.
- More than 100 selected parts are rejected.
- Non-current-company or non-Part IDs fail the whole batch.
- API keys get 403.
- Any unsupported hard reference leaves the archive insert rolled back with the delete.
- New user-visible text must reuse existing Lingui catalog entries where possible or update the compiled catalog in the same change.

