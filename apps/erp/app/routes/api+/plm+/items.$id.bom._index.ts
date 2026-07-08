/**
 * PLM API - BOM (Bill of Materials) / 装配嵌套
 *
 * GET  /api/plm/items/:id/bom  - 获取 BOM 树结构
 * POST /api/plm/items/:id/bom  - 创建/更新 BOM 物料清单
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getMethodTreeArray, upsertMethodMaterial } from "~/modules/items";
import {
  getActiveMakeMethodId,
  getOrCreateMakeMethod,
  plmError,
  plmJson
} from "~/modules/plm/plm.server";
import type { BomTreeNode, BomUpsertRequest } from "~/modules/plm/types";

// ─── GET /api/plm/items/:id/bom ───────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { client, companyId } = await requirePermissions(request, {
      view: "parts"
    });

    const itemId = params.id;
    if (!itemId) {
      return plmError("物品 ID 是必填项");
    }

    // 查找物品
    const { data: existingItem, error: findError } = await client
      .from("item")
      .select("id, readableId, name, replenishmentSystem")
      .eq("readableId", itemId)
      .eq("companyId", companyId)
      .single();

    if (findError || !existingItem) {
      return plmError(`物品不存在: ${itemId}`, 404);
    }

    // 获取 active makeMethod
    const { id: makeMethodId, error: methodError } =
      await getActiveMakeMethodId(client, existingItem.id);

    if (methodError) {
      return plmError(methodError, 500);
    }

    if (!makeMethodId) {
      // 没有 BOM，返回空树
      return plmJson({
        success: true,
        data: {
          itemId: existingItem.id,
          readableId: existingItem.readableId,
          name: existingItem.name,
          makeMethodId: null,
          materials: []
        }
      });
    }

    // 获取 BOM 树
    const { data: treeData, error: treeError } = await getMethodTreeArray(
      client,
      makeMethodId
    );

    if (treeError) {
      return plmError(`获取 BOM 树失败: ${treeError.message}`, 500);
    }

    // 转换为响应格式
    const materials: BomTreeNode[] = (treeData || []).map((node: any) => ({
      id: node.id,
      makeMethodId: node.makeMethodId,
      materialMakeMethodId: node.materialMakeMethodId,
      methodType: node.methodType,
      itemType: node.itemType,
      itemId: node.itemId,
      itemName: node.itemName,
      itemReadableId: node.itemReadableId,
      quantity: node.quantity,
      unitOfMeasureCode: node.unitOfMeasureCode,
      level: node.level,
      order: node.order,
      children: node.children || []
    }));

    return plmJson({
      success: true,
      data: {
        itemId: existingItem.id,
        readableId: existingItem.readableId,
        name: existingItem.name,
        makeMethodId,
        materials
      }
    });
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}

// ─── POST /api/plm/items/:id/bom ──────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { client, companyId, userId } = await requirePermissions(request, {
      update: "parts"
    });

    if (request.method !== "POST") {
      return plmError(`不支持的方法: ${request.method}`, 405);
    }

    const itemId = params.id;
    if (!itemId) {
      return plmError("物品 ID 是必填项");
    }

    // 查找父物品
    const { data: parentItem, error: findError } = await client
      .from("item")
      .select("id, readableId, name, replenishmentSystem, defaultMethodType")
      .eq("readableId", itemId)
      .eq("companyId", companyId)
      .single();

    if (findError || !parentItem) {
      return plmError(`物品不存在: ${itemId}`, 404);
    }

    // 验证父物品类型（必须支持制造）
    if (
      parentItem.replenishmentSystem !== "Make" &&
      parentItem.replenishmentSystem !== "Buy and Make"
    ) {
      return plmError(
        `物品 ${itemId} 的补货系统为 "${parentItem.replenishmentSystem}"，不支持 BOM。需要设置为 "Make" 或 "Buy and Make"。`
      );
    }

    // 解析请求体
    const body = (await request.json()) as BomUpsertRequest;

    if (
      !body.materials ||
      !Array.isArray(body.materials) ||
      body.materials.length === 0
    ) {
      return plmError("物料清单 (materials) 不能为空");
    }

    // 获取或创建 makeMethod
    const { id: makeMethodId, error: methodError } =
      await getOrCreateMakeMethod(client, parentItem.id, companyId, userId);

    if (methodError) {
      return plmError(methodError, 500);
    }

    // 逐个添加/更新物料
    const results: Array<{
      itemId: string;
      success: boolean;
      materialId?: string;
      error?: string;
    }> = [];

    for (const material of body.materials) {
      // 验证子件存在
      const { data: childItem, error: childError } = await client
        .from("item")
        .select("id, readableId, type, defaultMethodType, sourcingType")
        .eq("readableId", material.itemId)
        .eq("companyId", companyId)
        .single();

      if (childError || !childItem) {
        results.push({
          itemId: material.itemId,
          success: false,
          error: `子件不存在: ${material.itemId}`
        });
        continue;
      }

      // 准备 methodMaterial 数据
      const methodMaterialData = {
        id: material.id || `${makeMethodId}-${childItem.id}-${Date.now()}`,
        makeMethodId,
        order: material.order ?? 0,
        itemType: childItem.type,
        itemId: childItem.id,
        quantity: material.quantity,
        unitOfMeasureCode: material.unitOfMeasureCode,
        methodType: material.methodType || childItem.defaultMethodType || "Buy",
        sourcingType: childItem.sourcingType || "Buy",
        kit: false
      };

      // 调用 upsertMethodMaterial
      const { data: resultData, error: upsertError } =
        await upsertMethodMaterial(client, {
          ...methodMaterialData,
          companyId,
          createdBy: userId
        });

      if (upsertError) {
        results.push({
          itemId: material.itemId,
          success: false,
          error: `添加物料失败: ${upsertError.message}`
        });
      } else {
        results.push({
          itemId: material.itemId,
          success: true,
          materialId: resultData?.id || methodMaterialData.id
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return plmJson({
      success: failed === 0,
      message: `BOM 更新完成: ${succeeded} 成功, ${failed} 失败`,
      data: {
        makeMethodId,
        results
      }
    });
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
