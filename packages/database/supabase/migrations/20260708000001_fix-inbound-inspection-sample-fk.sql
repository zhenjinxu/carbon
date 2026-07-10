-- Migration: Add foreign key from inboundInspectionSample to inboundInspection
-- Date: 2026-07-08
-- Description: Fixes PostgREST error "Could not find a relationship between
--              'inboundInspection' and 'inboundInspectionSample'" by adding
--              the missing foreign key constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inboundInspectionSample_inboundInspectionId_fkey'
    AND table_name = 'inboundInspectionSample'
  ) THEN
    ALTER TABLE "inboundInspectionSample"
    ADD CONSTRAINT "inboundInspectionSample_inboundInspectionId_fkey"
    FOREIGN KEY ("inboundInspectionId")
    REFERENCES "inboundInspection"("id")
    ON DELETE CASCADE;
  END IF;
END $$;
