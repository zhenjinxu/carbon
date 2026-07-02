import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request }: ActionFunctionArgs) {
  console.log("[document.upload] Action called");
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string;
  const size = Number(formData.get("size"));
  const sourceDocument = formData.get("sourceDocument") as string;
  const sourceDocumentId = formData.get("sourceDocumentId") as string;

  console.log("[document.upload] Received:", {
    hasFile: !!file,
    fileName: file?.name,
    fileType: file?.type,
    fileSize: file?.size,
    name,
    size,
    sourceDocument,
    sourceDocumentId,
    companyId,
    userId
  });

  if (!file || !(file instanceof File)) {
    console.error("[document.upload] File is missing");
    return { error: "File is required" };
  }
  if (!name) {
    console.error("[document.upload] Name is missing");
    return { error: "Name is required" };
  }
  if (!sourceDocument || !sourceDocumentId) {
    console.error("[document.upload] Source document info is missing");
    return { error: "Source document and ID are required" };
  }

  const sanitizedFileName = stripSpecialCharacters(file.name);
  const storagePath = `${companyId}/parts/${sourceDocumentId}/${sanitizedFileName}`;

  // Use service role for storage upload (bypasses RLS which is broken for
  // client-side uploads in this self-hosted Supabase environment)
  const serviceRole = getCarbonServiceRole();

  const { error: uploadError } = await serviceRole.storage
    .from("private")
    .upload(storagePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      upsert: true,
      contentType: file.type || "application/octet-stream"
    });

  if (uploadError) {
    console.error("[document.upload] Storage upload failed:", uploadError, {
      path: storagePath,
      fileSize: file.size,
      fileType: file.type
    });
    return { error: `Failed to upload file: ${uploadError.message}` };
  }

  console.log("[document.upload] Storage upload succeeded:", {
    path: storagePath
  });

  // Use the user's JWT client for DB operations (matches original behavior)
  const createDocument = await upsertDocument(client, {
    path: storagePath,
    name,
    size,
    sourceDocument,
    sourceDocumentId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (createDocument.error) {
    console.error(
      "[document.upload] Failed to create document record:",
      createDocument.error
    );
    return {
      error: `Failed to save document: ${createDocument.error.message}`
    };
  }

  console.log("[document.upload] Document created:", {
    id: createDocument.data?.id,
    path: createDocument.data?.path
  });

  return { success: true, document: createDocument.data };
}
