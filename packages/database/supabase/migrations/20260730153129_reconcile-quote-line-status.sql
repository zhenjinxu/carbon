-- Reconcile databases restored from snapshots where quoteLineStatus still uses
-- the original Draft value and lacks No Quote.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = '"quoteLineStatus"'::regtype
      AND enumlabel = 'Draft'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = '"quoteLineStatus"'::regtype
      AND enumlabel = 'Not Started'
  ) THEN
    ALTER TYPE "quoteLineStatus" RENAME VALUE 'Draft' TO 'Not Started';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = '"quoteLineStatus"'::regtype
      AND enumlabel = 'No Quote'
  ) THEN
    ALTER TYPE "quoteLineStatus" ADD VALUE 'No Quote' AFTER 'Complete';
  END IF;
END;
$$;

ALTER TABLE "quoteLine"
  ALTER COLUMN status SET DEFAULT 'Not Started';
