/**
 * PLM Integration API - Server Utilities
 *
 * 共享工具模块：响应格式化、分页解析、BOM 辅助函数。
 */

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { nanoid } from "nanoid";

// ─── 响应工具 ─────────────────────────────────────────────────────

/** 统一 JSON 响应 */
export function plmJson<T>(payload: T, status = 200) {
  return data(payload, { status });
}

/** 统一错误响应 */
export function plmError(message: string, status = 400) {
  return data({ success: false, error: message }, { status });
}

// ─── 分页工具 ─────────────────────────────────────────────────────

export interface PaginationResult {
  page: number;
  limit: number;
  offset: number;
}

/** 从 URL 查询参数中解析分页信息 */
export function parsePagination(searchParams: URLSearchParams): PaginationResult {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ─── ID 生成 ──────────────────────────────────────────────────────

/** 生成服务端 ID (nanoid) */
export function generateId(): string {
  return nanoid();
}

// ─── BOM 辅助函数 ─────────────────────────────────────────────────

/**
 * 获取物品的活跃制造方法（makeMethod）
 * 如果不存在则自动创建一个（status: Active, version: 1）
 */
export async function getOrCreateMakeMethod(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  userId: string
): Promise<{ id: string; error?: string }> {
  // 1. 查找 active makeMethod
  const { data: activeMethod, error: queryError } = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();

  if (queryError) {
    return { id: "", error: `查询 makeMethod 失败: ${queryError.message}` };
  }

  if (activeMethod) {
    return { id: activeMethod.id };
  }

  // 2. 不存在，创建一个新的
  const newId = generateId();
  const { error: insertError } = await client
    .from("makeMethod")
    .insert({
      id: newId,
      itemId,
      companyId,
      createdBy: userId,
      version: 1,
      status: "Active"
    });

  if (insertError) {
    return { id: "", error: `创建 makeMethod 失败: ${insertError.message}` };
  }

  return { id: newId };
}

/**
 * 获取物品的活跃制造方法 ID（只查询，不创建）
 */
export async function getActiveMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();

  if (error) {
    return { id: null, error: `查询 makeMethod 失败: ${error.message}` };
  }

  return { id: data?.id ?? null };
}
