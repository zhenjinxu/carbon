import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const modelId = formData.get("modelId") as string;
  const name = formData.get("name") as string;
  const fileEntry = formData.get("file");
  const size = parseInt(formData.get("size") as string);

  const itemId = formData.get("itemId") as string | null;
  const salesRfqLineId = formData.get("salesRfqLineId") as string | null;
  const quoteLineId = formData.get("quoteLineId") as string | null;
  const salesOrderLineId = formData.get("salesOrderLineId") as string | null;
  const jobId = formData.get("jobId") as string | null;

  // Normalize file object across runtimes
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

  if (!modelId) {
    return { error: "Model ID is required" };
  }
  if (!name) {
    return { error: "Name is required" };
  }
  if (!file) {
    return { error: "File is required" };
  }

  const fileExtension = name.split(".").pop();
  const storagePath = `${companyId}/models/${modelId}.${fileExtension}`;

  const serviceRole = getCarbonServiceRole();

  const { error: uploadError } = await serviceRole.storage
    .from("private")
    .upload(storagePath, file as File, {
      upsert: true
    });

  if (uploadError) {
    console.error("[model.upload] Storage upload failed:", uploadError, {
      path: storagePath,
      fileSize: file.size,
      fileType: file.type
    });
    return { error: `Failed to upload file: ${uploadError.message}` };
  }

  const modelRecord = await client.from("modelUpload").insert({
    id: modelId,
    modelPath: storagePath,
    name,
    size,
    companyId,
    createdBy: userId
  });

  if (modelRecord.error) {
    console.error(
      "[model.upload] Failed to record upload:",
      modelRecord.error,
      {
        modelId,
        storagePath,
        name
      }
    );
    return { error: "Failed to record upload: " + modelRecord.error.message };
  }

  if (itemId) {
    await client
      .from("item")
      .update({ modelUploadId: modelId })
      .eq("id", itemId);
  }
  if (salesRfqLineId) {
    await client
      .from("salesRfqLine")
      .update({ modelUploadId: modelId })
      .eq("id", salesRfqLineId);
  }
  if (quoteLineId) {
    await client
      .from("quoteLine")
      .update({ modelUploadId: modelId })
      .eq("id", quoteLineId);
  }
  if (salesOrderLineId) {
    await client
      .from("salesOrderLine")
      .update({ modelUploadId: modelId })
      .eq("id", salesOrderLineId);
  }
  if (jobId) {
    await client.from("job").update({ modelUploadId: modelId }).eq("id", jobId);
  }

  await trigger("model-thumbnail", {
    companyId,
    modelId
  });

  return {
    success: true,
    modelPath: storagePath
  };
}
