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

    // Handle HTTP errors (4xx, 5xx)
    if (!response.ok) {
      let errorMessage = `Upload failed (HTTP ${response.status})`;
      try {
        // Try to parse as JSON first (our own error format)
        const errorData = (await response.json()) as {
          error?: string | { message: string };
        };
        if (errorData.error) {
          if (typeof errorData.error === "string") {
            errorMessage = errorData.error;
          } else if (errorData.error.message) {
            errorMessage = errorData.error.message;
          }
        }
      } catch {
        // Response is not JSON, try to get text content
        try {
          const text = await response.text();
          if (text) {
            errorMessage = text;
          } else if (response.statusText) {
            errorMessage = response.statusText;
          }
        } catch {
          if (response.statusText) {
            errorMessage = response.statusText;
          }
        }
      }
      return { error: { message: errorMessage } };
    }

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

type StorageRemoveResult = {
  data?: { path: string }[];
  error?: { message: string };
};

/**
 * Remove files from Supabase Storage via a server-side endpoint.
 *
 * Same RLS bypass approach as serverStorageUpload — routes the remove
 * through the server where the service role is used.
 */
export async function serverStorageRemove(
  paths: string[],
  bucket = "private"
): Promise<StorageRemoveResult> {
  const formData = new FormData();
  formData.append("bucket", bucket);
  formData.append("paths", JSON.stringify(paths));

  try {
    const response = await fetch(path.to.api.storageRemove, {
      method: "POST",
      body: formData
    });

    // Handle HTTP errors (4xx, 5xx)
    if (!response.ok) {
      let errorMessage = `Remove failed (HTTP ${response.status})`;
      try {
        // Try to parse as JSON first (our own error format)
        const errorData = (await response.json()) as {
          error?: string | { message: string };
        };
        if (errorData.error) {
          if (typeof errorData.error === "string") {
            errorMessage = errorData.error;
          } else if (errorData.error.message) {
            errorMessage = errorData.error.message;
          }
        }
      } catch {
        // Response is not JSON, try to get text content
        try {
          const text = await response.text();
          if (text) {
            errorMessage = text;
          } else if (response.statusText) {
            errorMessage = response.statusText;
          }
        } catch {
          if (response.statusText) {
            errorMessage = response.statusText;
          }
        }
      }
      return { error: { message: errorMessage } };
    }

    const result = (await response.json()) as StorageRemoveResult;
    if (result.error) {
      return { error: result.error };
    }
    return { data: result.data };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : "Remove failed"
      }
    };
  }
}
