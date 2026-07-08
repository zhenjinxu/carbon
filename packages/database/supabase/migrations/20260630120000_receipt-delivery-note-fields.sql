-- Receipt Delivery Note Fields
-- Extends receipt and receiptLine tables to support the "收货单" (Goods Receiving Note) template
-- Adds: contract info, receiver/sender contact details, inspection results, signatures, and line-level fields

-- ============================================================
-- 1. Add new columns to receipt table
-- ============================================================

ALTER TABLE "receipt"
  ADD COLUMN IF NOT EXISTS "contractNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "receivingDepartment" TEXT,
  ADD COLUMN IF NOT EXISTS "receiverContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "receiverContactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "senderContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "senderContactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingMethodId" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityInspectionResult" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityInspectionNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "packagingCondition" TEXT,
  ADD COLUMN IF NOT EXISTS "packagingNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptanceConclusion" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptanceNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "receiverSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "senderSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouseKeeperSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureDate" DATE;

-- Foreign key for shipping method
ALTER TABLE "receipt"
  ADD CONSTRAINT "receipt_shippingMethodId_fkey"
  FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "receipt_shippingMethodId_idx" ON "receipt"("shippingMethodId");

-- ============================================================
-- 2. Add new columns to receiptLine table
-- ============================================================

ALTER TABLE "receiptLine"
  ADD COLUMN IF NOT EXISTS "expectedQuantity" NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- ============================================================
-- 3. Recreate views to include new columns
-- ============================================================

-- Recreate receiptLines view
DROP VIEW IF EXISTS "receiptLines";
CREATE OR REPLACE VIEW "receiptLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "receiptLine" rl
  INNER JOIN "item" i ON i."id" = rl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

-- Recreate receipts view
DROP VIEW IF EXISTS "receipts";
CREATE OR REPLACE VIEW "receipts" WITH(SECURITY_INVOKER=true) AS
  SELECT
    r.*,
    l."name" as "locationName"
  FROM "receipt" r
  LEFT JOIN "location" l
    ON l.id = r."locationId";

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
