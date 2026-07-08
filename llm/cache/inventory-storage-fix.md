# Inventory Storage System Fix (2026-06-25)

## Problem
- `/x/inventory/quantities` page was returning 400 Bad Request
- `get_inventory_quantities` database function was missing `storageTypeIds` and `storageUnitIds` columns
- `storageUnits_recursive` view was missing placement tracking columns (`allowsStorage`, `movable`, `placedAt`, `placedBy`)

## Root Cause
Migration `20260512130000_inventory-storage-unit-filter.sql` was applied but the function definition was later overwritten by subsequent migrations, losing the storage-related columns.

## Solution
Created migration `20260625180000_fix-inventory-quantities-and-storage-view.sql`:
1. Restored `get_inventory_quantities` function with `storageTypeIds TEXT[]` and `storageUnitIds TEXT[]` columns
2. Updated `storageUnits_recursive` view to include `allowsStorage`, `movable`, `placedAt`, `placedBy` columns

## Files Changed
- `packages/database/supabase/migrations/20260625180000_fix-inventory-quantities-and-storage-view.sql` (new)
- `apps/erp/app/modules/inventory/inventory.models.ts` (fixed `zfd.checkbox()` syntax)
- `apps/erp/app/components/Form/StorageUnit.tsx` (added missing required fields)

## Verification
- Database function now returns 42 columns including storage arrays
- View has 14 columns including placement tracking
- TypeScript compilation errors resolved
- Page returns HTTP 200 with inventory data
