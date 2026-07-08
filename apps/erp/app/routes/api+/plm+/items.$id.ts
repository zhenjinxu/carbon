/**
 * PLM API - Single Item
 *
 * GET    /api/plm/items/:id  - 获取物品详情
 * PUT    /api/plm/items/:id  - 更新物品
 * DELETE /api/plm/items/:id  - 停用物品（soft delete）
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { plmJson, plmError } from "~/modules/plm/plm.server";
import { upsertPart } from "~/modules/items";
import type { UpdateItemRequest, ItemResponse } from "~/modules/plm/types";

// ─── GET /api/plm/items/:id ───────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { client, companyId } = await requirePermissions(request, {
      view: "parts"
    });

    const itemId = params.id;
    if (!itemId) {
      return plmError("物品 ID 是必填项");
    }

    // 查询物品详情
    const { data: item, error } = await client
      .from("item")
      .select("*")
      .eq("readableId", itemId)
      .eq("companyId", companyId)
      .single();

    if (error || !item) {
      return plmError(`物品不存在: ${itemId}`, 404);
    }

    // 查询 part 扩展数据
    const { data: partData } = await client
      .from("part")
      .select("*")
      .eq("id", item.id)
      .maybeSingle();

    // 查询成本信息
    const { data: costData } = await client
      .from("itemCost")
      .select("*")
      .eq("itemId", item.id)
      .eq("companyId", companyId)
      .maybeSingle();

    const response: ItemResponse = {
      id: item.id,
      readableId: item.readableId,
      revision: item.revision,
      name: item.name,
      description: item.description,
      type: item.type,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      active: item.active,
      thumbnailUrl: item.thumbnailUrl,
      thumbnailPath: item.thumbnailPath,
      modelUploadId: item.modelUploadId,
      blocked: item.blocked,
      companyId: item.companyId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      part: partData
        ? {
            approved: partData.approved,
            approvedBy: partData.approvedBy,
            fromDate: partData.fromDate,
            toDate: partData.toDate,
            assignee: partData.assignee
          }
        : null,
      cost: costData
        ? {
            costingMethod: costData.costingMethod,
            standardCost: costData.standardCost,
            unitCost: costData.unitCost
          }
        : null
    };

    return plmJson({ success: true, data: response });
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}

// ─── PUT /api/plm/items/:id ───────────────────────────────────────
// ─── DELETE /api/plm/items/:id ────────────────────────────────────

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

    // DELETE: 停用物品
    if (request.method === "DELETE") {
      const { error } = await client
        .from("item")
        .update({ active: false, updatedBy: userId, updatedAt: new Date().toISOString() })
        .eq("id", existingItem.id);

      if (error) {
        return plmError(`停用物品失败: ${error.message}`, 500);
      }

      return plmJson({ success: true, message: `物品 ${itemId} 已停用` });
    }

    // PUT: 更新物品
    if (request.method === "PUT") {
      const body = (await request.json()) as UpdateItemRequest;

      const result = await upsertPart(client, {
        id: existingItem.readableId,
        revision: body.revision,
        name: body.name || "",
        description: body.description,
        replenishmentSystem: body.replenishmentSystem,
        defaultMethodType: body.defaultMethodType,
        itemTrackingType: body.itemTrackingType,
        unitOfMeasureCode: body.unitOfMeasureCode || "",
        updatedBy: userId,
        customFields: body.customFields as any,
        postingGroupId: body.postingGroupId,
        unitCost: body.unitCost,
        lotSize: body.lotSize,
        defaultStorageUnitId: body.defaultStorageUnitId
      });

      if (result.error) {
        return plmError(`更新物品失败: ${result.error.message}`, 500);
      }

      return plmJson({
        success: true,
        message: "物品更新成功",
        data: result.data
      });
    }

    return plmError(`不支持的方法: ${request.method}`, 405);
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
