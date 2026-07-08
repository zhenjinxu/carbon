import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";

/**
 * Generic server-side storage remove endpoint.
 *
 * Works around a Supabase Storage RLS issue where client-side operations fail
 * because auth.uid() is NULL in the Storage API's Postgres context.
 * The service role bypasses RLS.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {});

  const formData = await request.formData();
  const bucket = (formData.get("bucket") as string) ?? "private";
  const pathsStr = formData.get("paths") as string;

  if (!pathsStr) {
    return { error: { message: "Paths are required" } };
  }

  let paths: string[];
  try {
    paths = JSON.parse(pathsStr);
    if (!Array.isArray(paths) || paths.length === 0) {
      return { error: { message: "Paths must be a non-empty array" } };
    }
  } catch {
    return { error: { message: "Paths must be a valid JSON array" } };
  }

  const serviceRole = getCarbonServiceRole();

  const { data, error } = await serviceRole.storage
    .from(bucket)
    .remove(paths);

  if (error) {
    return { error: { message: error.message } };
  }

  return { data };
}
