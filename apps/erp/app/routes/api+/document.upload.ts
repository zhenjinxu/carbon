import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string;
  const size = Number(formData.get("size"));
  const sourceDocument = formData.get("sourceDocument") as string;
  const sourceDocumentId = formData.get("sourceDocumentId") as string;

  if (!file || !(file instanceof File)) {
    return { error: "File is required" };
  }
  if (!name) {
    return { error: "Name is required" };
  }
  if (!sourceDocument || !sourceDocumentId) {
    return { error: "Source document and ID are required" };
  }

  const sanitizedFileName = stripSpecialCharacters(file.name);
  const storagePath = `${companyId}/parts/${sourceDocumentId}/${sanitizedFileName}`;

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

  const createDocument = await upsertDocument(serviceRole, {
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

  return { success: true, document: createDocument.data };
}
