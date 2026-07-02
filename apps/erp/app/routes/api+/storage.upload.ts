import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";

/**
 * Generic server-side storage upload endpoint.
 *
 * Works around a Supabase Storage RLS issue where client-side uploads fail
 * because auth.uid() is NULL in the Storage API's Postgres context.
 * The service role bypasses RLS (see 20260701000001_service_role_bypass_rls.sql).
 */
export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {});

  const formData = await request.formData();
  const fileEntry = formData.get("file");
  const bucket = (formData.get("bucket") as string) ?? "private";
  const storagePath = formData.get("path") as string;
  const cacheControl = (formData.get("cacheControl") as string) ?? "3600";
  const upsert = formData.get("upsert") !== "false";

  // Normalize file object across runtimes (Node, Bun, Cloudflare, etc.)
  let file: Blob | null = null;
  if (fileEntry instanceof Blob) {
    file = fileEntry;
  } else if (
    fileEntry &&
    typeof fileEntry === "object" &&
    "arrayBuffer" in fileEntry
  ) {
    file = fileEntry as Blob;
  }

  if (!file) {
    return { error: "File is required" };
  }
  if (!storagePath) {
    return { error: "Storage path is required" };
  }

  const serviceRole = getCarbonServiceRole();

  const contentType =
    (formData.get("contentType") as string) ||
    (file as File).type ||
    "application/octet-stream";

  const { data, error } = await serviceRole.storage
    .from(bucket)
    .upload(storagePath, file as File, {
      cacheControl,
      upsert,
      contentType
    });

  if (error) {
    console.error("[storage.upload] Failed:", error, {
      bucket,
      path: storagePath,
      fileSize: file.size,
      fileType: file.type
    });
    return { error: error.message };
  }

  return { data: { path: data?.path ?? storagePath } };
}
