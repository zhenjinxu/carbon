/**
 * PLM API - Delete BOM Material
 *
 * DELETE /api/plm/items/:id/bom/:materialId - 删除 BOM 物料
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { plmJson, plmError } from "~/modules/plm/plm.server";

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { client, companyId, userId } = await requirePermissions(request, {
      delete: "parts"
    });

    if (request.method !== "DELETE") {
      return plmError(`不支持的方法: ${request.method}`, 405);
    }

    const itemId = params.id;
    const materialId = params.materialId;

    if (!itemId) {
      return plmError("物品 ID 是必填项");
    }
    if (!materialId) {
      return plmError("物料 ID 是必填项");
    }

    // 查找父物品
    const { data: parentItem, error: findError } = await client
      .from("item")
      .select("id, readableId")
      .eq("readableId", itemId)
      .eq("companyId", companyId)
      .single();

    if (findError || !parentItem) {
      return plmError(`物品不存在: ${itemId}`, 404);
    }

    // 查找 methodMaterial 记录
    const { data: material, error: materialError } = await client
      .from("methodMaterial")
      .select("id, makeMethodId, itemId")
      .eq("id", materialId)
      .eq("companyId", companyId)
      .single();

    if (materialError || !material) {
      return plmError(`物料记录不存在: ${materialId}`, 404);
    }

    // 验证 methodMaterial 属于该父物品
    const { data: makeMethod } = await client
      .from("makeMethod")
      .select("itemId")
      .eq("id", material.makeMethodId)
      .single();

    if (!makeMethod || makeMethod.itemId !== parentItem.id) {
      return plmError(`物料 ${materialId} 不属于物品 ${itemId}`, 400);
    }

    // 删除物料记录
    const { error: deleteError } = await client
      .from("methodMaterial")
      .delete()
      .eq("id", materialId)
      .eq("companyId", companyId);

    if (deleteError) {
      return plmError(`删除物料失败: ${deleteError.message}`, 500);
    }

    return plmJson({
      success: true,
      message: `物料 ${materialId} 已从物品 ${itemId} 的 BOM 中移除`
    });
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
