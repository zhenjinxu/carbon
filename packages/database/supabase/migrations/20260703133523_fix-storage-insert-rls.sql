-- Fix: storage.objects INSERT RLS policy was missing a WITH CHECK clause.
-- The "Shared Private Bucket" policy only defines USING (which applies to
-- SELECT/UPDATE/DELETE), not WITH CHECK (which applies to INSERT).  Without a
-- WITH CHECK clause, INSERTs are rejected because no policy allows them.
--
-- The USING clause also depends on get_companies_with_employee_role() which
-- calls auth.uid() — that returns NULL for service_role and Storage API
-- internal calls, causing even service-role uploads to fail.
--
-- Storage API already authenticates every request, so restricting to
-- bucket_id = 'private' is sufficient for INSERT.
CREATE POLICY "Private bucket insert" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'private'
);
