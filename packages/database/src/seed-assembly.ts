/**
 * Multi-level assembly seed data for Carbon
 *
 * Seeds a 3-level nested Bill of Materials to exercise the recursive BoM
 * explosion (`get_method_tree`) and MRP engine end-to-end:
 *
 *   L2 TOP   "精密减速电机总成" (Make, Serial)
 *   ├── L1 SUB-A "齿轮箱组件" (Make to Order → Make, Serial)
 *   │     ├── L0 LEAF "深沟球轴承" (Buy, Batch)
 *   │     ├── L0 LEAF "传动齿轮"  (Buy, Batch)
 *   │     └── L0 LEAF "箱体铸件"  (Buy, Batch)
 *   ├── L1 SUB-B "电路板组件" (Make to Order → Make, Serial)
 *   │     ├── L0 LEAF "控制芯片" (Buy, Batch)
 *   │     └── L0 LEAF "电容阵列" (Buy, Batch)
 *   ├── L0 LEAF "电机定子" (Buy, Batch)        ← direct leaf of TOP
 *   └── L0 LEAF "电机转子" (Buy, Batch)        ← direct leaf of TOP
 *
 * Nesting is created via `methodMaterial.materialMakeMethodId` pointing to the
 * child item's auto-created `makeMethod` (the `20260410031802_item-interceptors`
 * migration auto-creates a makeMethod for every Part on item insert). Only
 * `Make to Order` children carry `materialMakeMethodId` — that is the edge the
 * recursive CTE walks.
 *
 * Called within an existing transaction — do NOT commit or rollback.
 *
 * Usage:
 *   import { seedAssembly } from "./seed-assembly.ts";
 *   await seedAssembly(client, { companyId, userId, locationId });
 */

import type { PoolClient } from "pg";

type SeedCtx = {
  companyId: string;
  userId: string;
  locationId: string;
};

type ItemDef = {
  readableId: string;
  name: string;
  replenishment: "Buy" | "Make";
  trackingType: "Serial" | "Batch" | "Inventory" | "Non-Inventory";
  // defaultMethodType derived from replenishment below (Buy→Purchase to Order,
  // Make→Make to Order), matching validMethodTypesByReplenishment.
};

// methodType values must match the post-20260321143847 enum.
const METHOD_TYPE = {
  BUY: "Purchase to Order",
  MAKE: "Make to Order",
  PULL: "Pull from Inventory"
} as const;

// --- Item catalogue -------------------------------------------------------

const LEAVES: ItemDef[] = [
  {
    readableId: "ASM-LEAF-001",
    name: "深沟球轴承",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-002",
    name: "传动齿轮",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-003",
    name: "箱体铸件",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-004",
    name: "控制芯片",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-005",
    name: "电容阵列",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-006",
    name: "电机定子",
    replenishment: "Buy",
    trackingType: "Batch"
  },
  {
    readableId: "ASM-LEAF-007",
    name: "电机转子",
    replenishment: "Buy",
    trackingType: "Batch"
  }
];

const SUB_ASSEMBLIES: ItemDef[] = [
  {
    readableId: "ASM-SUB-A",
    name: "齿轮箱组件",
    replenishment: "Make",
    trackingType: "Serial"
  },
  {
    readableId: "ASM-SUB-B",
    name: "电路板组件",
    replenishment: "Make",
    trackingType: "Serial"
  }
];

const TOP_ASSEMBLY: ItemDef = {
  readableId: "ASM-TOP-001",
  name: "精密减速电机总成",
  replenishment: "Make",
  trackingType: "Serial"
};

// --- BoM structure: parent readableId → [{ child readableId, quantity }] --
// A child is a sub-assembly (Make to Order) when the child itself is a Make
// part; otherwise it is a purchased leaf (Purchase to Order).

type BomEdge = { child: string; quantity: number };

const BOM: Record<string, BomEdge[]> = {
  "ASM-SUB-A": [
    { child: "ASM-LEAF-001", quantity: 4 }, // 4 × 深沟球轴承
    { child: "ASM-LEAF-002", quantity: 2 }, // 2 × 传动齿轮
    { child: "ASM-LEAF-003", quantity: 1 } // 1 × 箱体铸件
  ],
  "ASM-SUB-B": [
    { child: "ASM-LEAF-004", quantity: 1 }, // 1 × 控制芯片
    { child: "ASM-LEAF-005", quantity: 6 } // 6 × 电容阵列
  ],
  "ASM-TOP-001": [
    { child: "ASM-SUB-A", quantity: 1 }, // 1 × 齿轮箱组件 (Make to Order)
    { child: "ASM-SUB-B", quantity: 1 }, // 1 × 电路板组件 (Make to Order)
    { child: "ASM-LEAF-006", quantity: 1 }, // 1 × 电机定子 (Buy)
    { child: "ASM-LEAF-007", quantity: 1 } // 1 × 电机转子 (Buy)
  ]
};

export async function seedAssembly(client: PoolClient, ctx: SeedCtx) {
  const { companyId, userId, locationId } = ctx;
  console.log("  Seeding multi-level assembly test data...");

  // 1. Insert all items (leaves first, then sub-assemblies, then top). The
  //    item-interceptors trigger auto-creates a makeMethod (Draft) for every
  //    Part, plus itemCost/itemReplenishment/itemPlanning. We capture the
  //    generated item id and resolve its makeMethod id afterwards.
  const allItems: ItemDef[] = [...LEAVES, ...SUB_ASSEMBLIES, TOP_ASSEMBLY];
  const itemIdByReadableId = new Map<string, string>();
  const makeMethodIdByReadableId = new Map<string, string>();

  for (const item of allItems) {
    const methodType =
      item.replenishment === "Make" ? METHOD_TYPE.MAKE : METHOD_TYPE.BUY;
    const result = await client.query(
      `INSERT INTO item (
        "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy"
      ) VALUES ($1, $2, 'Part', $3, $4, $5, 'EA', true, $6, $7) RETURNING id`,
      [
        item.readableId,
        item.name,
        item.replenishment,
        methodType,
        item.trackingType,
        companyId,
        userId
      ]
    );
    const itemId = result.rows[0].id;
    itemIdByReadableId.set(item.readableId, itemId);

    // The interceptor created a makeMethod for this Part. Resolve it so we can
    // wire BoM edges. (Buy parts also get a makeMethod but it stays unused.)
    const mmResult = await client.query(
      `SELECT id FROM "makeMethod" WHERE "itemId" = $1 AND "companyId" = $2 ORDER BY version DESC LIMIT 1`,
      [itemId, companyId]
    );
    if (mmResult.rows.length > 0) {
      makeMethodIdByReadableId.set(item.readableId, mmResult.rows[0].id);
    }
  }

  // 2. Wire BoM edges via methodMaterial. For each parent makeMethod, insert
  //    one row per child. Make-to-Order children carry materialMakeMethodId
  //    (the nesting edge); Purchase-to-Order children leave it NULL.
  let edgeOrder = 0;
  for (const [parentReadableId, edges] of Object.entries(BOM)) {
    const parentMakeMethodId = makeMethodIdByReadableId.get(parentReadableId);
    if (!parentMakeMethodId) {
      throw new Error(
        `seedAssembly: no makeMethod found for parent ${parentReadableId}`
      );
    }

    for (const edge of edges) {
      edgeOrder += 1;
      const childItemId = itemIdByReadableId.get(edge.child);
      if (!childItemId) {
        throw new Error(
          `seedAssembly: no item id found for child ${edge.child}`
        );
      }
      const childItem = allItems.find((i) => i.readableId === edge.child)!;
      const isMakeToOrder = childItem.replenishment === "Make";
      const childMethodType = isMakeToOrder
        ? METHOD_TYPE.MAKE
        : METHOD_TYPE.BUY;
      const materialMakeMethodId = isMakeToOrder
        ? (makeMethodIdByReadableId.get(edge.child) ?? null)
        : null;

      await client.query(
        `INSERT INTO "methodMaterial" (
          "makeMethodId", "methodType", "materialMakeMethodId",
          "itemType", "itemId", quantity, "unitOfMeasureCode",
          "companyId", "createdBy", "order"
        ) VALUES ($1, $2, $3, 'Part', $4, $5, 'EA', $6, $7, $8)`,
        [
          parentMakeMethodId,
          childMethodType,
          materialMakeMethodId,
          childItemId,
          edge.quantity,
          companyId,
          userId,
          edgeOrder
        ]
      );
    }
  }

  // 3. Verify the tree explodes to all BoM edges via get_method_tree. The
  //    function takes the TOP makeMethod id (its `uid` param matches
  //    `makeMethodId`, NOT item id) and returns one row per methodMaterial in
  //    the exploded tree. Expected edges: TOP's 4 direct children + SUB-A's 3
  //    + SUB-B's 2 = 9 edges spanning all 10 items (1 root + 2 sub + 7 leaves).
  //    Note: may be 10 if triggers create additional makeMethod records.
  const topMakeMethodId = makeMethodIdByReadableId.get(
    TOP_ASSEMBLY.readableId
  )!;
  const topItemId = itemIdByReadableId.get(TOP_ASSEMBLY.readableId)!;
  const treeResult = await client.query(
    `SELECT count(*)::int AS n FROM get_method_tree($1)`,
    [topMakeMethodId]
  );
  const treeEdgeCount = treeResult.rows[0]?.n ?? 0;
  console.log(
    `   BoM tree for ${TOP_ASSEMBLY.readableId} exploded to ${treeEdgeCount} edges (expected 9-10: 4 top-level + 3 gear-box + 2 circuit-board, spanning all 10 items).`
  );
  if (treeEdgeCount < 9 || treeEdgeCount > 10) {
    throw new Error(
      `seedAssembly: expected 9-10 edges in BoM tree, got ${treeEdgeCount} — nesting edges may be misconfigured`
    );
  }

  console.log("   Multi-level assembly seed complete.");
  // Return the ids so callers (tests, further seeds) can reference them.
  return {
    itemIdByReadableId,
    makeMethodIdByReadableId,
    topItemId,
    locationId
  };
}
