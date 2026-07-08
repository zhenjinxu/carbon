/**
 * PLM API - Items Collection
 *
 * GET  /api/plm/items  - 物品列表（分页+搜索+类型筛选）
 * POST /api/plm/items  - 创建物品
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { upsertPart } from "~/modules/items";
import { parsePagination, plmError, plmJson } from "~/modules/plm/plm.server";
import type {
  CreateItemRequest,
  ItemResponse,
  PaginatedResponse
} from "~/modules/plm/types";

// ─── GET /api/plm/items ───────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { client, companyId } = await requirePermissions(request, {
      view: "parts"
    });

    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url.searchParams);
    const search = url.searchParams.get("search")?.trim() || "";
    const type = url.searchParams.get("type") || "";

    // 构建查询 - 分别查询 item 和 part 数据
    let query = client
      .from("item")
      .select("*", { count: "exact" })
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .range(offset, offset + limit - 1);

    // 类型筛选
    if (type) {
      query = query.eq("type", type);
    }

    // 搜索（按 readableId 或 name）
    if (search) {
      query = query.or(`readableId.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data: items, error, count } = await query;

    if (error) {
      return plmError(`查询失败: ${error.message}`, 500);
    }

    // 批量查询 part 数据
    const itemIds = (items || []).map((i) => i.id);
    const { data: parts } =
      itemIds.length > 0
        ? await client.from("part").select("*").in("id", itemIds)
        : { data: [] };

    const partMap = new Map((parts || []).map((p) => [p.id, p]));

    // 转换为响应格式
    const _itemsList: ItemResponse[] = (items || []).map((item) => {
      const part = partMap.get(item.id);
      return {
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
        part: part
          ? {
              approved: part.approved,
              approvedBy: part.approvedBy,
              fromDate: part.fromDate,
              toDate: part.toDate,
              assignee: part.assignee
            }
          : null
      };
    });

    const totalPages = Math.ceil((count || 0) / limit);

    const response: PaginatedResponse<ItemResponse> = {
      data: items,
      total: count || 0,
      page,
      limit,
      totalPages
    };

    return plmJson({ success: true, ...response });
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}

// ─── POST /api/plm/items ──────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { client, companyId, userId } = await requirePermissions(request, {
      create: "parts"
    });

    if (request.method !== "POST") {
      return plmError(`不支持的方法: ${request.method}`, 405);
    }

    const body = (await request.json()) as CreateItemRequest;

    // 验证必填字段
    if (!body.id) {
      return plmError("物品编号 (id) 是必填项");
    }
    if (!body.name) {
      return plmError("物品名称 (name) 是必填项");
    }
    if (!body.unitOfMeasureCode) {
      return plmError("计量单位 (unitOfMeasureCode) 是必填项");
    }

    // 调用 upsertPart 创建物品
    const result = await upsertPart(client, {
      id: body.id,
      revision: body.revision || "0",
      name: body.name,
      description: body.description || "",
      type: "Part", // upsertPart 固定为 Part 类型
      replenishmentSystem: body.replenishmentSystem || "Buy",
      defaultMethodType: body.defaultMethodType || "Buy",
      itemTrackingType: body.itemTrackingType || "Inventory",
      unitOfMeasureCode: body.unitOfMeasureCode,
      companyId,
      createdBy: userId,
      customFields: body.customFields as any,
      postingGroupId: body.postingGroupId,
      unitCost: body.unitCost,
      lotSize: body.lotSize,
      defaultStorageUnitId: body.defaultStorageUnitId
    });

    if (result.error) {
      return plmError(`创建物品失败: ${result.error.message}`, 500);
    }

    return plmJson(
      {
        success: true,
        message: "物品创建成功",
        data: result.data
      },
      201
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    return plmError(`服务器错误: ${(err as Error).message}`, 500);
  }
}
