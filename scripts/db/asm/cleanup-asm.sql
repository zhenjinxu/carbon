-- ============================================================================
-- Complete ASM-TOP-001 Recovery
-- Step 1: Clean up ALL related data
-- ============================================================================

-- Disable triggers
ALTER TABLE item DISABLE TRIGGER ALL;

-- Clean up in correct order (respecting foreign keys)
DELETE FROM "jobMaterial" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "jobOperation" WHERE "jobId" LIKE 'job-asm%';
DELETE FROM "jobMakeMethod" WHERE "jobId" LIKE 'job-asm%';
DELETE FROM job WHERE id LIKE 'job-asm%';
DELETE FROM "methodMaterial" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "methodOperation" WHERE "makeMethodId" LIKE 'make-item-asm%';
DELETE FROM "makeMethod" WHERE id LIKE 'make-item-asm%';
DELETE FROM "workCenterProcess" WHERE "workCenterId" LIKE 'wc-asm%';
DELETE FROM "workCenter" WHERE id LIKE 'wc-asm%';
DELETE FROM process WHERE id LIKE 'proc-asm%';
DELETE FROM "itemLedger" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemReplenishment" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemCost" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemUnitSalePrice" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemPlanning" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemShelfLife" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemRuleAssignment" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemRule" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM "itemPostingGroup" WHERE "itemId" LIKE 'item-asm%';
DELETE FROM material WHERE id LIKE 'item-asm%';
DELETE FROM item WHERE id LIKE 'item-asm%';

-- Re-enable triggers
ALTER TABLE item ENABLE TRIGGER ALL;
