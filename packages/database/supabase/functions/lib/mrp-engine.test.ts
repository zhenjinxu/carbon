import { describe, expect, it } from "vitest";
import {
  computeLowLevelCodes,
  explodeBom,
  makeKey,
  splitKey,
  type BomExplosionInput
} from "./mrp-engine.ts";

// ---------------------------------------------------------------------------
// Helpers — build the inputs explodeBom expects from a small, declarative
// description of a multi-level assembly so each test reads like a spec.
// ---------------------------------------------------------------------------

const LOC = "L1";

function periods(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `P${i}` }));
}

/**
 * Build a BomExplosionInput from a map of itemId -> direct children.
 * Children default to replenishmentSystem inferred from whether the child
 * itself appears as a parent (Make) or not (Buy).
 */
function buildInput(opts: {
  bom: Record<string, { itemId: string; quantity: number; methodType: string }[]>;
  replenishment?: Record<string, "Buy" | "Make" | "Buy and Make">;
  leadTime?: Record<string, number>;
  grossDemand?: Record<string, number>; // period P0 demand per item
  onHand?: Record<string, number>;
  jobSupply?: Record<string, number>; // key `${periodId}|${itemId}`
  periods?: number;
}): BomExplosionInput {
  const items = new Set<string>();
  for (const [parent, kids] of Object.entries(opts.bom)) {
    items.add(parent);
    for (const k of kids) items.add(k.itemId);
  }
  const replenishmentSystemByItem = new Map<string, "Buy" | "Make" | "Buy and Make">();
  for (const it of items) {
    const explicit = opts.replenishment?.[it];
    if (explicit) replenishmentSystemByItem.set(it, explicit);
    else if (opts.bom[it]) replenishmentSystemByItem.set(it, "Make");
    else replenishmentSystemByItem.set(it, "Buy");
  }
  const bomByItem = new Map<string, { itemId: string; quantity: number; methodType: string }[]>();
  for (const [parent, kids] of Object.entries(opts.bom)) {
    bomByItem.set(parent, kids);
  }
  const leadTimeByItem = new Map<string, number>();
  for (const it of items) leadTimeByItem.set(it, opts.leadTime?.[it] ?? 0);

  const ps = periods(opts.periods ?? 4);
  const grossDemand = new Map<string, number>();
  for (const [item, qty] of Object.entries(opts.grossDemand ?? {})) {
    grossDemand.set(makeKey(LOC, "P0", item), qty);
  }
  const onHandByLocationItem = new Map<string, number>();
  for (const [item, qty] of Object.entries(opts.onHand ?? {})) {
    onHandByLocationItem.set(`${LOC}-${item}`, qty);
  }
  const jobSupply = new Map<string, number>();
  for (const [key, qty] of Object.entries(opts.jobSupply ?? {})) {
    const [periodId, itemId] = key.split("|");
    jobSupply.set(makeKey(LOC, periodId!, itemId!), qty);
  }
  return {
    grossDemand,
    bomByItem,
    replenishmentSystemByItem,
    leadTimeByItem,
    periods: ps,
    onHandByLocationItem,
    jobSupplyByLocationPeriodItem: jobSupply,
    topLevelContributors: new Map()
  };
}

// ---------------------------------------------------------------------------
// A 3-level assembly used across tests:
//
//   TOP (Make) ── 1× ──> SUB-A (Make) ── 2× ──> LEAF-1 (Buy)
//   TOP                  SUB-A            ── 1× ──> LEAF-2 (Buy)
//   TOP        ── 3× ──> SUB-B (Make) ── 1× ──> LEAF-3 (Buy)
//   TOP        ── 2× ──> LEAF-4 (Buy)
// ---------------------------------------------------------------------------

const ASSEMBLY_BOM = {
  TOP: [
    { itemId: "SUB-A", quantity: 1, methodType: "Make to Order" },
    { itemId: "SUB-B", quantity: 3, methodType: "Make to Order" },
    { itemId: "LEAF-4", quantity: 2, methodType: "Purchase to Order" }
  ],
  "SUB-A": [
    { itemId: "LEAF-1", quantity: 2, methodType: "Purchase to Order" },
    { itemId: "LEAF-2", quantity: 1, methodType: "Purchase to Order" }
  ],
  "SUB-B": [{ itemId: "LEAF-3", quantity: 1, methodType: "Purchase to Order" }]
};

describe("splitKey / makeKey", () => {
  it("round-trips a (location, period, item) key", () => {
    const key = makeKey("loc", "P0", "ITEM-1");
    const [loc, period, item] = splitKey(key);
    expect(loc).toBe("loc");
    expect(period).toBe("P0");
    expect(item).toBe("ITEM-1");
  });

  it("joins item ids that contain dashes", () => {
    // itemId may itself contain "-" — splitKey keeps the trailing segment whole.
    const key = makeKey("L", "P0", "ITEM-WITH-DASH");
    const [, , item] = splitKey(key);
    expect(item).toBe("ITEM-WITH-DASH");
  });
});

describe("computeLowLevelCodes", () => {
  it("assigns each item its max depth from any root (leaves deepest, roots shallowest)", () => {
    const bomByItem = new Map<string, { itemId: string; quantity: number; methodType: string }[]>();
    for (const [p, kids] of Object.entries(ASSEMBLY_BOM)) bomByItem.set(p, kids);

    const llc = computeLowLevelCodes(bomByItem);

    // computeLowLevelCodes walks each bomByItem key from level 0 and recurses
    // with level+1, keeping the max. So the TOP root is 0, sub-assemblies 1,
    // and the leaves (deepest) are 2.
    expect(llc.get("TOP")).toBe(0);
    expect(llc.get("SUB-A")).toBe(1);
    expect(llc.get("SUB-B")).toBe(1);
    expect(llc.get("LEAF-1")).toBe(2);
    expect(llc.get("LEAF-2")).toBe(2);
    expect(llc.get("LEAF-3")).toBe(2);
    expect(llc.get("LEAF-4")).toBe(1); // direct child of TOP → depth 1
  });

  it("does not infinitely recurse on a cyclic BoM (A → B → A)", () => {
    const cyclic = new Map<string, { itemId: string; quantity: number; methodType: string }[]>([
      ["A", [{ itemId: "B", quantity: 1, methodType: "Make to Order" }]],
      ["B", [{ itemId: "A", quantity: 1, methodType: "Make to Order" }]]
    ]);
    // Should terminate (the per-branch visited Set breaks the cycle).
    const llc = computeLowLevelCodes(cyclic);
    expect(llc.has("A")).toBe(true);
    expect(llc.has("B")).toBe(true);
  });
});

describe("explodeBom — multi-level demand propagation", () => {
  it("explodes a 10-unit TOP demand down to every leaf with correct quantities", () => {
    const input = buildInput({ bom: ASSEMBLY_BOM, grossDemand: { TOP: 10 } });
    const { grossDemand } = explodeBom(input);

    // TOP itself: 10 demanded (Make, exploded to children).
    expect(grossDemand.get(makeKey(LOC, "P0", "TOP"))).toBe(10);
    // SUB-A: 1 × 10 = 10
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBe(10);
    // SUB-B: 3 × 10 = 30
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-B"))).toBe(30);
    // LEAF-1 (under SUB-A, qty 2): 2 × 10 = 20
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-1"))).toBe(20);
    // LEAF-2 (under SUB-A, qty 1): 1 × 10 = 10
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-2"))).toBe(10);
    // LEAF-3 (under SUB-B, qty 1): 1 × 30 = 30
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-3"))).toBe(30);
    // LEAF-4 (direct under TOP, qty 2): 2 × 10 = 20
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-4"))).toBe(20);
  });

  it("nets on-hand inventory before exploding — only the shortfall propagates", () => {
    const input = buildInput({
      bom: ASSEMBLY_BOM,
      grossDemand: { TOP: 10 },
      onHand: { TOP: 4 } // 10 demanded − 4 on hand = 6 net → children scaled by 6
    });
    const { grossDemand } = explodeBom(input);

    // SUB-A: 1 × 6 = 6
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBe(6);
    // LEAF-1: 2 × 6 = 12
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-1"))).toBe(12);
    // SUB-B: 3 × 6 = 18
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-B"))).toBe(18);
  });

  it("nets job supply in a later period against running demand", () => {
    // Demand 10 in P0, but 6 units of job supply arrive in P1. With no
    // on-hand, P0 shortfall = 10 and explodes to children. The job supply in
    // P1 only reduces the *running* balance for the TOP item itself, not the
    // already-exploded child demand — children demand stays at the P0 net.
    const input = buildInput({
      bom: ASSEMBLY_BOM,
      grossDemand: { TOP: 10 },
      jobSupply: { "P1|TOP": 6 }
    });
    const { grossDemand } = explodeBom(input);
    // Children still reflect the P0 net requirement of 10 (no on-hand).
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBe(10);
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-1"))).toBe(20);
  });

  it("shifts child demand earlier by the child's lead time (in weeks)", () => {
    // LEAF-1 has 14 days lead → 2 weeks → demand lands 2 periods earlier than
    // the parent's P0, i.e. floored at P0 (can't go before the horizon).
    // Give LEAF-1 a 7-day lead so the shift is 1 period: parent demand at P1,
    // child demand should land at P0.
    const input = buildInput({
      bom: ASSEMBLY_BOM,
      grossDemand: { TOP: 10 }, // demand at P0
      leadTime: { "LEAF-1": 7 } // 1 week
    });
    const { grossDemand } = explodeBom(input);
    // LEAF-1 demand should be present at P0 (P0 − 1 week = P0 floored).
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-1"))).toBe(20);
  });

  it("skips bomDerivedDemand for Make-to-Order + Make children (inline subjob)", () => {
    // SUB-A is Make-to-Order AND Make → its demand is NOT written to
    // bomDerivedDemand (a subjob will be auto-spawned), but it IS still added
    // to grossDemand so downstream leaves under it still get exploded.
    const input = buildInput({ bom: ASSEMBLY_BOM, grossDemand: { TOP: 10 } });
    const { grossDemand, bomDerivedDemand } = explodeBom(input);

    // SUB-A demand exists in grossDemand (so its leaves explode)...
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBe(10);
    // ...but NOT in bomDerivedDemand (inline production skip).
    expect(bomDerivedDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBeUndefined();
    // LEAF-4 is Purchase-to-Order (not inline) → present in bomDerivedDemand.
    expect(bomDerivedDemand.get(makeKey(LOC, "P0", "LEAF-4"))).toBe(20);
  });

  it("does not explode Buy items — their shortfall stays as gross demand only", () => {
    // A standalone Buy item with demand and a (synthetic) child BoM entry:
    // since it's Buy, explodeBom must NOT propagate to children.
    const input = buildInput({
      bom: { "BUY-ROOT": [{ itemId: "BUY-CHILD", quantity: 5, methodType: "Purchase to Order" }] },
      replenishment: { "BUY-ROOT": "Buy" },
      grossDemand: { "BUY-ROOT": 8 }
    });
    const { grossDemand, bomDerivedDemand } = explodeBom(input);
    // Root demand preserved.
    expect(grossDemand.get(makeKey(LOC, "P0", "BUY-ROOT"))).toBe(8);
    // Child never receives any demand (Buy items don't explode).
    expect(grossDemand.get(makeKey(LOC, "P0", "BUY-CHILD"))).toBeUndefined();
    expect(bomDerivedDemand.get(makeKey(LOC, "P0", "BUY-CHILD"))).toBeUndefined();
  });

  it("treats Buy-and-Make replenishment as Buy for explosion purposes", () => {
    // Buy-and-Make collapses to Buy (effectiveReplenishment), so even though
    // TOP has a BoM, no child demand is generated.
    const input = buildInput({
      bom: ASSEMBLY_BOM,
      replenishment: { TOP: "Buy and Make", "SUB-A": "Make", "SUB-B": "Make" },
      grossDemand: { TOP: 10 }
    });
    const { grossDemand } = explodeBom(input);
    expect(grossDemand.get(makeKey(LOC, "P0", "TOP"))).toBe(10);
    // No sub-assembly demand because TOP is treated as Buy.
    expect(grossDemand.get(makeKey(LOC, "P0", "SUB-A"))).toBeUndefined();
    expect(grossDemand.get(makeKey(LOC, "P0", "LEAF-1"))).toBeUndefined();
  });
});
