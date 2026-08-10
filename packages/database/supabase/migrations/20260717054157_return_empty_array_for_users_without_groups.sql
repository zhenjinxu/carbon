-- A user with no group memberships is valid and must receive an empty array,
-- not NULL, so authenticated layouts and group-based RLS checks remain stable.
CREATE OR REPLACE FUNCTION public.groups_for_user(uid text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retval text[];
BEGIN
  WITH RECURSIVE "groupsForUser" AS (
    SELECT "groupId", "memberGroupId", "memberUserId"
    FROM public."membership"
    WHERE "memberUserId" = uid::text
    UNION
    SELECT membership."groupId", membership."memberGroupId", membership."memberUserId"
    FROM public."membership" AS membership
    INNER JOIN "groupsForUser" AS nested_group
      ON nested_group."groupId" = membership."memberGroupId"
  )
  SELECT array_agg("groupId")
  INTO retval
  FROM "groupsForUser";

  RETURN COALESCE(retval, '{}');
END;
$$;