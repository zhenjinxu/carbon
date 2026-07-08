/**
 * PLM API - Batch Operations
 *
 * POST /api/plm/batch - 批量创建物品（含 BOM）
 *
 * 请求格式: JSON
 * {
 *   items: BatchItemRequest[],
 *   continueOnError?: boolean
 * }
 *
 * 注意：文件上传（LOGO/文档/CAD）需单独调用对应端点
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { plmJson, plmError, getOrCreateMakeMethod } from "~/modules/plm/plm.server";
import { upsertPart, upsertMethodMaterial } from "~/modules/items";
import type {
  BatchCreateRequest,
  BatchResponse,
  BatchItemResult
} from "~/modules/plm/types";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { client, companyId, userId } = await requirePermissions(request, {
      create: "parts"
    });

    if (request.method !== "POST") {
      return plmError(`不支持的方法: ${request.method}`, 405);
    }

    const body = (await request.json()) as BatchCreateRequest;

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return plmError("物品列表 (items) 不能为空");
    }

    const continueOnError = body.continueOnError ?? true;
    const results: BatchItemResult[] = [];

    for (const itemRequest of body.items) {
      // 验证必填字段
      if (!itemRequest.id) {
        const result: BatchItemResult = {
          itemId: itemRequest.id || "unknown",
          success: false,
          error: "物品编号 (id) 是必填项"
        };
        results.push(result);
        if (!continueOnError) break;
        continue;
      }

      if (!itemRequest.name) {
        const result: BatchItemResult = {
          itemId: itemRequest.id,
          success: false,
          error: "物品名称 (name) 是必填项"
        };
        results.push(result);
        if (!continueOnError) break;
        continue;
      }

      if (!itemRequest.unitOfMeasureCode) {
        const result: BatchItemResult = {
          itemId: itemRequest.id,
          success: false,
          error: "计量单位 (unitOfMeasureCode) 是必填项"
        };
        results.push(result);
        if (!continueOnError) break;
        continue;
      }

      try {
        // 1. 创建物品
        const createResult = await upsertPart(client, {
          id: itemRequest.id,
          revision: itemRequest.revision || "0",
          name: itemRequest.name,
          description: itemRequest.description || "",
          type: "Part",
          replenishmentSystem: itemRequest.replenishmentSystem || "Buy",
          defaultMethodType: itemRequest.defaultMethodType || "Buy",
          itemTrackingType: itemRequest.itemTrackingType || "Inventory",
          unitOfMeasureCode: itemRequest.unitOfMeasureCode,
          companyId,
          createdBy: userId,
          customFields: itemRequest.customFields as any,
          postingGroupId: itemRequest.postingGroupId,
          unitCost: itemRequest.unitCost,
          lotSize: itemRequest.lotSize,
          defaultStorageUnitId: itemRequest.defaultStorageUnitId
        });

        if (createResult.error) {
          const result: BatchItemResult = {
            itemId: itemRequest.id,
            success: false,
            error: `创建物品失败: ${createResult.error.message}`
          };
          results.push(result);
          if (!continueOnError) break;
          continue;
        }

        const result: BatchItemResult = {
          itemId: itemRequest.id,
          success: true,
          internalId: createResult.data?.id
        };

        // 2. 创建 BOM（如果有）
        if (itemRequest.bom && itemRequest.bom.length > 0) {
          // 验证父物品类型
          if (
            itemRequest.replenishmentSystem !== "Make" &&
            itemRequest.replenishmentSystem !== "Buy and Make"
          ) {
            result.bom = {
              created: 0,
              errors: [
                `物品 ${itemRequest.id} 的补货系统不支持 BOM，需要 "Make" 或 "Buy and Make"`
              ]
            };
          } else {
            // 获取物品内部 ID
            const { data: itemData } = await client
              .from("item")
              .select("id")
              .eq("readableId", itemRequest.id)
              .eq("companyId", companyId)
              .single();

            if (itemData) {
              // 获取或创建 makeMethod
              const { id: makeMethodId, error: methodError } =
                await getOrCreateMakeMethod(client, itemData.id, companyId, userId);

              if (methodError) {
                result.bom = { created: 0, errors: [methodError] };
              } else {
                const bomResults: string[] = [];
                const bomErrors: string[] = [];

                for (const material of itemRequest.bom) {
                  // 查找子件
                  const { data: childItem } = await client
                    .from("item")
                    .select("id, type, defaultMethodType, sourcingType")
                    .eq("readableId", material.itemId)
                    .eq("companyId", companyId)
                    .single();

                  if (!childItem) {
                    bomErrors.push(`子件不存在: ${material.itemId}`);
                    continue;
                  }

                  const methodMaterialData = {
                    id: `${makeMethodId}-${childItem.id}-${Date.now()}`,
                    makeMethodId,
                    order: material.order ?? 0,
                    itemType: childItem.type,
                    itemId: childItem.id,
                    quantity: material.quantity,
                    unitOfMeasureCode: material.unitOfMeasureCode,
                    methodType:
                      material.methodType || childItem.defaultMethodType || "Buy",
                    sourcingType: childItem.sourcingType || "Buy",
                    kit: false
                  };

                  const { error: upsertError } = await upsertMethodMaterial(client, {
                    ...methodMaterialData,
                    companyId,
                    createdBy: userId
                  });

                  if (upsertError) {
                    bomErrors.push(
                      `添加物料 ${material.itemId} 失败: ${upsertError.message}`
                    );
                  } else {
                    bomResults.push(methodMaterialData.id);
                  }
                }

                result.bom = {
                  created: bomResults.length,
                  errors: bomErrors.length > 0 ? bomErrors : undefined
                };
              }
            }
          }
        }

        results.push(result);
      } catch (err) {
        const result: BatchItemResult = {
          itemId: itemRequest.id,
          success: false,
          error: `处理异常: ${(err as Error).message}`
        };
        results.push(result);
        if (!continueOnError) break;
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const response: BatchResponse = {
      success: failed === 0,
      total: results.length,
      succeeded,
      failed,
      results
    };

    return plmJson(response, failed === 0 ? 201 : 207);
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
