/**
 * PLM API - Upload CAD Model File
 *
 * POST /api/plm/items/:id/cad - 上传物品 CAD 模型文件
 *
 * 请求格式: multipart/form-data
 *   - file: CAD 文件 (STEP/STL/IGES/3MF 等)
 *   - name: 文件名（可选）
 *   - properties: CAD 属性 JSON 字符串（可选）
 *     { material, finish, weight, volume, dimensions, source, notes }
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { generateId, plmError, plmJson } from "~/modules/plm/plm.server";
import type { CadUploadRequest, FileUploadResponse } from "~/modules/plm/types";
import { stripSpecialCharacters } from "~/utils/string";

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
    const propertiesStr = formData.get("properties") as string | null;

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
      (formData.get("name") as string) || (file as File).name || "model.step";
    const fileExtension = originalName.split(".").pop() || "step";
    const _sanitizedFileName = stripSpecialCharacters(originalName);

    // 生成模型 ID
    const modelId = generateId();
    const storagePath = `${companyId}/models/${modelId}.${fileExtension}`;

    const serviceRole = getCarbonServiceRole();

    // 上传到 Supabase Storage
    const { error: uploadError } = await serviceRole.storage
      .from("private")
      .upload(storagePath, file as File, {
        upsert: true,
        contentType: (file as File).type || "application/octet-stream"
      });

    if (uploadError) {
      return plmError(`上传失败: ${uploadError.message}`, 500);
    }

    // 创建 modelUpload 记录
    const { error: modelError } = await serviceRole.from("modelUpload").insert({
      id: modelId,
      modelPath: storagePath,
      name: originalName,
      size: file.size,
      companyId,
      createdBy: userId
    });

    if (modelError) {
      return plmError(`创建模型记录失败: ${modelError.message}`, 500);
    }

    // 关联到物品
    const { error: linkError } = await serviceRole
      .from("item")
      .update({ modelUploadId: modelId })
      .eq("id", existingItem.id);

    if (linkError) {
      return plmError(`关联模型到物品失败: ${linkError.message}`, 500);
    }

    // 触发缩略图生成任务
    try {
      await trigger("model-thumbnail", {
        companyId,
        modelId
      });
    } catch {
      // 缩略图生成失败不影响主流程
    }

    // 解析 CAD 属性（如果提供）
    let cadProperties: CadUploadRequest["properties"] = undefined;
    if (propertiesStr) {
      try {
        cadProperties = JSON.parse(propertiesStr);
      } catch {
        // 忽略无效 JSON
      }
    }

    const response: FileUploadResponse = {
      success: true,
      storagePath,
      fileName: originalName,
      fileSize: file.size,
      fileType: "Other", // CAD 文件归类为 Other
      createdAt: new Date().toISOString()
    };

    return plmJson(
      {
        success: true,
        message: "CAD 文件上传成功",
        data: response,
        modelId,
        modelPath: storagePath,
        cadProperties
      },
      201
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
