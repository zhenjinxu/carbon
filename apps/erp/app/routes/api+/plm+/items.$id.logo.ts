/**
 * PLM API - Upload Item Logo/Thumbnail
 *
 * POST /api/plm/items/:id/logo - 上传物品 LOGO/缩略图
 *
 * 请求格式: multipart/form-data
 *   - file: 图片文件 (PNG/JPG/GIF/WEBP)
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { plmJson, plmError } from "~/modules/plm/plm.server";
import { stripSpecialCharacters } from "~/utils/string";
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

    // 验证文件类型
    const fileType = (file as File).type || "application/octet-stream";
    if (!fileType.startsWith("image/")) {
      return plmError("LOGO 必须是图片文件 (PNG/JPG/GIF/WEBP)");
    }

    // 获取文件名
    const originalName =
      formData.get("name") as string ||
      (file as File).name ||
      "logo.png";
    const extension = originalName.split(".").pop() || "png";
    const sanitizedFileName = stripSpecialCharacters(`logo.${extension}`);

    // 构建存储路径
    const storagePath = `${companyId}/parts/${existingItem.id}/${sanitizedFileName}`;

    const serviceRole = getCarbonServiceRole();

    // 上传到 Supabase Storage
    const { error: uploadError } = await serviceRole.storage
      .from("private")
      .upload(storagePath, file as File, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true,
        contentType: fileType
      });

    if (uploadError) {
      return plmError(`上传失败: ${uploadError.message}`, 500);
    }

    // 获取公开 URL
    const { data: urlData } = serviceRole.storage
      .from("private")
      .getPublicUrl(storagePath);

    const thumbnailUrl = urlData?.publicUrl || null;

    // 更新物品的缩略图字段
    const { error: updateError } = await client
      .from("item")
      .update({
        thumbnailUrl,
        thumbnailPath: storagePath,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", existingItem.id);

    if (updateError) {
      return plmError(`更新缩略图失败: ${updateError.message}`, 500);
    }

    const response: FileUploadResponse = {
      success: true,
      storagePath,
      fileName: originalName,
      fileSize: file.size,
      fileType: "Image",
      createdAt: new Date().toISOString()
    };

    return plmJson(
      {
        success: true,
        message: "LOGO 上传成功",
        data: response,
        thumbnailUrl
      },
      201
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
