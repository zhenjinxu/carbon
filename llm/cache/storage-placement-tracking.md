# Storage Placement Tracking System

## Overview

The storage placement tracking system manages the physical placement of items and storage units within the warehouse. It tracks what's currently stored where, with full operational metadata (who placed it, when, and quantities).

## Database Schema

### Storage Unit Table Extensions (Added 2026-06-25)

The `storageUnit` table was extended with four new columns:

1. **`allowsStorage` (BOOLEAN, DEFAULT true)**
   - Controls whether the storage unit can accept new placements
   - Property of the storage unit itself (1-to-many relationship)
   - When false, prevents any items or child storage units from being placed

2. **`movable` (BOOLEAN, DEFAULT false)**
   - Distinguishes between fixed and movable storage units
   - `true` = Movable (pallets, bins, cages)
   - `false` = Fixed (rack positions, shelf locations)
   - Used to enforce business rules about what can be nested

3. **`placedAt` (TIMESTAMP WITH TIME ZONE, NULLABLE)**
   - Tracks when this storage unit was placed into its parent unit
   - Set when `parentId` is assigned
   - Cleared when `parentId` is removed

4. **`placedBy` (TEXT, NULLABLE, FK → user.id)**
   - Tracks who performed the placement operation
   - References the user who placed this unit into its parent

### Item Ledger Extension (Added 2026-06-25)

The `itemLedger` table was extended with:

1. **`operatorId` (TEXT, NULLABLE, FK → user.id)**
   - Tracks who performed the inventory operation
   - Separate from `createdBy` (system user) to track the actual operator
   - Used in placement and adjustment operations

## Three Placement Scenarios

### Scenario 1: Items Placed in Storage Units

**Data Model:**
```
itemLedger: {
  itemId,           // What item
  storageUnitId,    // Where it's placed
  quantity,         // How much
  createdAt,        // When placed
  operatorId        // Who placed it (NEW)
}
```

**Query Pattern:**
```sql
-- Get current inventory in a storage unit
SELECT "itemId", SUM("quantity") as "totalQuantity"
FROM "itemLedger"
WHERE "storageUnitId" = $1
GROUP BY "itemId";
```

**Key Points:**
- Uses existing `itemLedger` table (no new table needed)
- `SUM(quantity)` gives current inventory level
- Positive quantity = placed in, negative = removed
- `operatorId` tracks the operator who performed the action

### Scenario 2: Movable Units Placed in Fixed Units

**Data Model:**
```
storageUnit (child): {
  parentId → storageUnit (fixed parent),
  placedAt,        // When placed (NEW)
  placedBy         // Who placed it (NEW)
}
```

**Example:**
- Fixed unit: P0001 (rack position A-01-01)
- Movable unit: B0001 (bin) placed in P0001
- `B0001.parentId = P0001`
- `B0001.placedAt = '2026-06-25 10:30:00'`
- `B0001.placedBy = 'user123'`

**Query Pattern:**
```sql
-- Get all movable units currently in a fixed unit
SELECT "id", "name", "placedAt", "placedBy"
FROM "storageUnit"
WHERE "parentId" = $1
  AND "movable" = true;
```

**Key Points:**
- Uses existing `parentId` field for structural nesting
- New `placedAt` and `placedBy` track operational metadata
- `movable` flag distinguishes fixed vs movable units
- One-to-many: one fixed unit can hold many movable units

### Scenario 3: Movable Units Nested in Other Movable Units

**Data Model:**
Same as Scenario 2, but both parent and child are movable:

**Example:**
- Movable parent: P0001 (pallet)
- Movable child: B0001 (bin) placed on P0001
- `B0001.parentId = P0001`
- `B0001.placedAt = '2026-06-25 10:30:00'`
- `B0001.placedBy = 'user123'`

**Query Pattern:**
```sql
-- Get all units currently on a pallet
SELECT "id", "name", "placedAt", "placedBy"
FROM "storageUnit"
WHERE "parentId" = $1
  AND "movable" = true;
```

**Key Points:**
- Same mechanism as Scenario 2
- No difference in data model between fixed/movable parent
- `movable` flag on both parent and child indicates both are movable
- Enables deep nesting: bin on pallet on rack position

## Seeded Data (2026-06-25)

For each company, the following storage units are automatically created:

1. **Parent Units (Categories):**
   - 料箱 (Bin category) - `movable = false`
   - 托盘 (Pallet category) - `movable = false`
   - 笼箱 (Cage category) - `movable = false`

2. **Child Units (20 each):**
   - B0001-B0020 (Bins) - `movable = true`, `parentId → 料箱`
   - P0001-P0020 (Pallets) - `movable = true`, `parentId → 托盘`
   - C0001-C0020 (Cages) - `movable = true`, `parentId → 笼箱`

**Total:** 63 storage units per company (3 parents + 60 children)

## Migration History

### 2026-06-25: Storage Placement Tracking

**Migration File:** `20260625172426_storage-placement-tracking.sql`

**Changes:**
1. Added `allowsStorage`, `movable`, `placedAt`, `placedBy` to `storageUnit`
2. Added `operatorId` to `itemLedger`
3. Updated existing B*, P*, C* units to set `movable = true`
4. Created indexes on new columns

**Backward Compatibility:**
- All existing storage units have `allowsStorage = true` (default)
- All existing storage units have `movable = false` (default, except B*/P*/C*)
- All existing storage units have `placedAt = NULL`, `placedBy = NULL`
- All existing item ledger entries have `operatorId = NULL`

## Business Rules (Enforced in Application Layer)

1. **Placement Validation:**
   - Check `parent.allowsStorage = true` before placing anything
   - Check `child.movable = true` when placing in another unit
   - Prevent cycles in nesting hierarchy

2. **Movement Tracking:**
   - When `parentId` changes, update `placedAt` and `placedBy`
   - When `parentId` is cleared, clear `placedAt` and `placedBy`

3. **Inventory Operations:**
   - When creating `itemLedger` entries, record `operatorId`
   - `operatorId` may differ from `createdBy` (system user vs actual operator)

## Related Tables

- **`storageUnit`**: Core table for storage units (bins, pallets, cages, positions)
- **`storageType`**: Categories for storage units (e.g., Cold, Hazardous)
- **`itemLedger`**: Transaction log for inventory movements
- **`warehouse`**: Physical warehouse locations
- **`location`**: Geographic locations (addresses)

## API Endpoints

The storage unit endpoints (`/api/inventory/storage-units/*`) now return the new fields:
- `allowsStorage`, `movable`, `placedAt`, `placedBy` for storage units
- `operatorId` for item ledger entries

## Future Enhancements

Potential future additions:
1. **Placement History Table**: Track all placement operations (not just current state)
2. **Capacity Management**: Track max capacity of storage units
3. **Weight/Volume Tracking**: Track physical constraints
4. **Temperature/Humidity Monitoring**: For cold storage
5. **Placement Rules Engine**: Automatic assignment based on item properties
