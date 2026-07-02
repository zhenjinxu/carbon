import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request }: ActionFunctionArgs) {
  console.log("[document.upload] Action called");
  const { client, companyId, userId } = await requirePermissions(request, {});

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

  console.log("[document.upload] Received:", {
    fileEntryType: fileEntry?.constructor?.name ?? typeof fileEntry,
    hasFileEntry: !!fileEntry,
    hasBlob: fileEntry instanceof Blob,
    fileName: (fileEntry as File)?.name,
    fileType: (fileEntry as File)?.type,
    fileSize: (fileEntry as File)?.size,
    name,
    size,
    sourceDocument,
    sourceDocumentId,
    companyId,
    userId
  });

  if (!file) {
    console.error("[document.upload] File is missing or not a Blob/File");
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

  const sanitizedFileName = stripSpecialCharacters(name);
  const storagePath = `${companyId}/parts/${sourceDocumentId}/${sanitizedFileName}`;

  // Use service role for storage upload (bypasses RLS which is broken for
  // client-side uploads in this self-hosted Supabase environment)
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
    console.error("[document.upload] Storage upload failed:", uploadError, {
      path: storagePath,
      fileSize: file.size,
      fileType: fileForUpload.type
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
