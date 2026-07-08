import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const fileEntry = formData.get("file");
  const name = formData.get("name") as string;
  const size = Number(formData.get("size"));
  const sourceDocument = formData.get("sourceDocument") as string;
  const sourceDocumentId = formData.get("sourceDocumentId") as string;

  // The file may arrive as a File, Blob, or (in some runtimes) a string.
  // Normalize it into a Blob-like object we can hand to the storage API.
  let file: Blob | null = null;
  if (fileEntry instanceof Blob) {
    file = fileEntry;
  } else if (
    fileEntry &&
    typeof fileEntry === "object" &&
    "arrayBuffer" in fileEntry
  ) {
    // Duck-typed File/Blob from another realm (e.g. undici in Node)
    file = fileEntry as Blob;
  }

  if (!file) {
    return { error: "File is required" };
  }
  if (!name) {
    return { error: "Name is required" };
  }
  if (!sourceDocument || !sourceDocumentId) {
    return { error: "Source document and ID are required" };
  }

  const sanitizedFileName = stripSpecialCharacters(name);
  const storagePath = `${companyId}/parts/${sourceDocumentId}/${sanitizedFileName}`;

  const serviceRole = getCarbonServiceRole();

  const fileForUpload = file as File;
  const { error: uploadError } = await serviceRole.storage
    .from("private")
    .upload(storagePath, fileForUpload, {
      cacheControl: `${12 * 60 * 60}`,
      upsert: true,
      contentType: fileForUpload.type || "application/octet-stream"
    });

  if (uploadError) {
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
    return {
      error: `Failed to save document: ${createDocument.error.message}`
    };
  }

  return { success: true, document: createDocument.data };
}
