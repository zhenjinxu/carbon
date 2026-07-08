/**
 * PLM API - Upload Item Documents
 *
 * POST /api/plm/items/:id/documents - 上传物品说明文档
 *
 * 请求格式: multipart/form-data
 *   - file: 文档文件 (Word/Excel/PDF/TXT 等)
 *   - name: 文件名（可选，默认使用原文件名）
 *   - description: 文档描述（可选）
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { plmJson, plmError } from "~/modules/plm/plm.server";
import { stripSpecialCharacters } from "~/utils/string";
import { upsertDocument } from "~/modules/documents";
import type { FileUploadResponse } from "~/modules/plm/types";

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { client, companyId, userId } = await requirePermissions(request, {
      update: "parts"
    });

    const itemId = params.id;
    if (!itemId) {
      return plmError("物品 ID 是必填项");
    }

    // 查找物品
    const { data: existingItem, error: findError } = await client
      .from("item")
      .select("id, readableId")
      .eq("readableId", itemId)
      .eq("companyId", companyId)
      .single();

    if (findError || !existingItem) {
      return plmError(`物品不存在: ${itemId}`, 404);
    }

    // 解析 multipart
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const description = formData.get("description") as string | null;

    // 标准化 File 对象
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
      return plmError("文件 (file) 是必填项");
    }

    // 获取文件名
    const originalName =
      formData.get("name") as string ||
      (file as File).name ||
      "document.pdf";
    const sanitizedFileName = stripSpecialCharacters(originalName);

    // 构建存储路径
    const storagePath = `${companyId}/parts/${existingItem.id}/${sanitizedFileName}`;

    const serviceRole = getCarbonServiceRole();

    // 上传到 Supabase Storage
    const { error: uploadError } = await serviceRole.storage
      .from("private")
      .upload(storagePath, file as File, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true,
        contentType: (file as File).type || "application/octet-stream"
      });

    if (uploadError) {
      return plmError(`上传失败: ${uploadError.message}`, 500);
    }

    // 创建文档记录
    const { data: documentData, error: documentError } = await upsertDocument(
      serviceRole,
      {
        path: storagePath,
        name: originalName,
        size: file.size,
        sourceDocument: "Part",
        sourceDocumentId: existingItem.id,
        description: description || undefined,
        readGroups: [userId],
        writeGroups: [userId],
        createdBy: userId,
        companyId
      }
    );

    if (documentError) {
      return plmError(`创建文档记录失败: ${documentError.message}`, 500);
    }

    const response: FileUploadResponse = {
      success: true,
      documentId: documentData?.id,
      storagePath,
      fileName: originalName,
      fileSize: file.size,
      fileType: documentData?.type || "Document",
      createdAt: documentData?.createdAt || new Date().toISOString()
    };

    return plmJson(
      {
        success: true,
        message: "文档上传成功",
        data: response
      },
      201
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
