import { path } from "~/utils/path";

type StorageUploadResult = {
  data?: { path: string };
  error?: { message: string };
};

/**
 * Upload a file to Supabase Storage via a server-side endpoint.
 *
 * Client-side storage uploads fail because the self-hosted Supabase Storage
 * API does not properly propagate the user's JWT context to Postgres, causing
 * auth.uid() to be NULL in RLS policy evaluation. This helper routes the
 * upload through the server where the service role (BYPASSRLS) is used.
 */
export async function serverStorageUpload(
  file: File,
  storagePath: string,
  options?: {
    bucket?: string;
    cacheControl?: string;
    contentType?: string;
    upsert?: boolean;
  }
): Promise<StorageUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", storagePath);
  if (options?.bucket) formData.append("bucket", options.bucket);
  if (options?.cacheControl)
    formData.append("cacheControl", options.cacheControl);
  if (options?.contentType) formData.append("contentType", options.contentType);
  if (options?.upsert !== undefined)
    formData.append("upsert", String(options.upsert));

  try {
    const response = await fetch(path.to.api.storageUpload, {
      method: "POST",
      body: formData
    });

    const result = (await response.json()) as StorageUploadResult;
    if (result.error) {
      return { error: result.error };
    }
    return { data: result.data };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : "Upload failed"
      }
    };
  }
}
