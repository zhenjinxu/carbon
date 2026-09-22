# AI Routing Raw-Material Target-Evidence Adapter Decision — 2026-08-24

## Scope

Phase 2 audited whether Carbon can expose BOM/raw-material evidence to AI Routing target evidence without leaking the answer route. This was read-only: no U8 writes, no Carbon database writes, no route-generation logic change, no draft/materialization/formal route writes.

## Current Target Evidence Path

- `getAiRoutingTargetEvidenceForItem` selects only the target item fields and latest `Succeeded` `aiDrawingExtraction` object; it does not join `material`, `methodMaterial`, active make-method raw materials, or recursive BOM leaf rows.
- `aiRoutingTargetEvidenceFromExtractionRow` passes those selected item fields plus normalized drawing extraction into `aiRoutingTargetEvidenceFromDrawing`.
- `AiRoutingTargetEvidence` currently contains readable id/name, `materialTags`, `featureTags`, optional `processHints`, drawing evidence, and warnings. It does not carry raw-material component codes, raw-material names, BOM operation sequence, or route operations.

## Comparator Evidence

- Phase 1 showed positive evidence is real but not sufficient as a direct rule: `板材/平板` appears in 993/1000 XJG01 positives and 500/1182 no-laser controls.
- `operationSequence 0020` is not discriminative: 1000/1000 positives and 1180/1182 controls.
- `采购 + 板材/平板 + 0020` still appears in no-laser controls, so it cannot add or suppress laser by itself.
- Prior source audit found method raw-material rows for 1927930206, 192769010102, and 1927930202, but no populated structured laser-suitability field or explicit positive/negative suitability text in current target evidence.

## Decision

Do not implement a target-evidence adapter now.

Reason: the current target evidence path lacks a non-leaking, explicit raw-material/stock laser-suitability source. Raw-material category, free-text names, BOM operation sequence, and active make-method material rows are useful audit clues, but using them now would either be non-discriminative or risk leaking the active answer route.

## Next Safe Gate

- Define/import a target-available raw-material or stock suitability source that is independent of active route operations and Evaluation truth.
- Classify each source column as allowed, ambiguous, or forbidden before wiring it into target evidence.
- Only after that, write RED tests preserving 1927930202, suppressing 1927930206/192769010102 only from explicit evidence, preserving 192759010202 disambiguation, and blocking raw text/category/0020-only rules.
- Production/materialization remains closed.