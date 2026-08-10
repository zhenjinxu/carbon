-- A quote can already have an external link before it is finalized. The old
-- finalize route only recorded completedDate when it created that link, so use
-- the first persisted Quote PDF as evidence of historical finalization.
WITH first_pdf AS (
  SELECT
    d."sourceDocumentId" AS "quoteId",
    min(d."createdAt") AS "createdAt"
  FROM public.document d
  WHERE d."sourceDocument" = 'Quote'
    AND lower(d.name) LIKE '%.pdf'
  GROUP BY d."sourceDocumentId"
)
UPDATE public.quote q
SET "completedDate" = first_pdf."createdAt"
FROM first_pdf
WHERE q.id = first_pdf."quoteId"
  AND q."completedDate" IS NULL
  AND q.status <> 'Draft';
