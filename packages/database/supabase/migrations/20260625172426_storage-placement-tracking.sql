-- Migration: Add storage placement tracking columns
-- Adds support for tracking storage status, movable/fixed units, and placement operations

-- ============================================================================
-- 1. Extend storageUnit table
-- ============================================================================

-- 存放状态：是否允许存放物品/子单位（属于存储单位本身的属性）
ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "allowsStorage" BOOLEAN NOT NULL DEFAULT true;

-- 区分可移动/固定存储单位
-- true = 可移动（托盘、料箱、笼箱）
-- false = 固定（某区-某层-某列）
ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "movable" BOOLEAN NOT NULL DEFAULT false;

-- 放置追踪：当前存储单位被放入父单位的时间和操作人
-- 当 parentId 设置时填充，parentId 清除时清空
ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "placedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "placedBy" TEXT REFERENCES "user"("id");

-- ============================================================================
-- 2. Extend itemLedger table
-- ============================================================================

-- 物品存放操作人
ALTER TABLE "itemLedger"
  ADD COLUMN IF NOT EXISTS "operatorId" TEXT REFERENCES "user"("id");

-- ============================================================================
-- 3. Update existing seed data
-- ============================================================================

-- 标记 B0001-B0020 为可移动料箱
UPDATE "storageUnit" SET "movable" = true WHERE name ~ '^B[0-9]{4}$';

-- 标记 P0001-P0020 为可移动托盘
UPDATE "storageUnit" SET "movable" = true WHERE name ~ '^P[0-9]{4}$';

-- 标记 C0001-C0020 为可移动笼箱
UPDATE "storageUnit" SET "movable" = true WHERE name ~ '^C[0-9]{4}$';

-- ============================================================================
-- 4. Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS "storageUnit_allowsStorage_idx" ON "storageUnit" ("allowsStorage");
CREATE INDEX IF NOT EXISTS "storageUnit_movable_idx" ON "storageUnit" ("movable");
CREATE INDEX IF NOT EXISTS "storageUnit_placedBy_idx" ON "storageUnit" ("placedBy");
CREATE INDEX IF NOT EXISTS "itemLedger_operatorId_idx" ON "itemLedger" ("operatorId");
