/**
 * PLM Integration API - Type Definitions
 *
 * 为外部 PLM 系统集成提供的类型定义。
 * 涵盖物品(Part)、BOM(装配嵌套)、LOGO、说明文档、CAD 文件的完整数据结构。
 */

import type { Database } from "@carbon/database";

// ─── 物品相关类型 ────────────────────────────────────────────────

/** 物品追踪类型 */
export type ItemTrackingType =
  Database["public"]["Enums"]["itemTrackingType"];

/** 物品补货系统 */
export type ItemReplenishmentSystem =
  Database["public"]["Enums"]["itemReplenishmentSystem"];

/** 方法类型 */
export type MethodType = Database["public"]["Enums"]["methodType"];

/** 物品成本计算方法 */
export type ItemCostingMethod =
  Database["public"]["Enums"]["itemCostingMethod"];

// ─── PLM API 请求/响应类型 ──────────────────────────────────────

/** 创建物品请求体 */
export interface CreateItemRequest {
  /** 物品编号 (readableId), 如 "ASM-TOP-001" */
  id: string;
  /** 版本号, 默认 "0" */
  revision?: string;
  /** 物品名称/简短描述 */
  name: string;
  /** 详细描述 */
  description?: string;
  /** 物品类型: "Part" | "Material" | "Tool" | "Service" | "Consumable" */
  type?: "Part" | "Material" | "Tool" | "Service" | "Consumable";
  /** 补货系统: "Buy" | "Make" | "Buy and Make" */
  replenishmentSystem?: "Buy" | "Make" | "Buy and Make";
  /** 默认方法类型: "Buy" | "Make" | "Pick" */
  defaultMethodType?: "Buy" | "Make" | "Pick";
  /** 物品追踪类型: "Inventory" | "Non-Inventory" | "Serial" | "Batch" */
  itemTrackingType?: "Inventory" | "Non-Inventory" | "Serial" | "Batch";
  /** 计量单位代码 */
  unitOfMeasureCode: string;
  /** 单位成本 */
  unitCost?: number;
  /** 过账组 ID */
  postingGroupId?: string;
  /** 默认存储单元 ID */
  defaultStorageUnitId?: string;
  /** 批大小 (Make 类型物品) */
  lotSize?: number;
  /** 自定义字段 (JSON) */
  customFields?: Record<string, unknown>;
}

/** 更新物品请求体 */
export interface UpdateItemRequest extends Partial<CreateItemRequest> {
  /** 不传 id，id 从 URL 路径获取 */
}

/** 物品详情响应 */
export interface ItemResponse {
  id: string;
  readableId: string;
  revision: string | null;
  name: string;
  description: string | null;
  type: string;
  replenishmentSystem: string;
  defaultMethodType: string | null;
  itemTrackingType: string;
  unitOfMeasureCode: string | null;
  active: boolean;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  modelUploadId: string | null;
  blocked: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string | null;
  // Part 扩展属性
  part?: {
    approved: boolean;
    approvedBy: string | null;
    fromDate: string | null;
    toDate: string | null;
    assignee: string | null;
  } | null;
  // 成本信息
  cost?: {
    costingMethod: string;
    standardCost: number;
    unitCost: number;
  } | null;
}

// ─── BOM / 装配嵌套类型 ─────────────────────────────────────────

/** BOM 物料项（装配子件） */
export interface BomMaterialItem {
  /** methodMaterial 记录 ID（更新/删除时需要） */
  id?: string;
  /** 子件物品 ID */
  itemId: string;
  /** 子件类型: "Material" | "Part" 等 */
  itemType?: string;
  /** 用量 */
  quantity: number;
  /** 用量单位代码 */
  unitOfMeasureCode: string;
  /** 物料来源方法: "Buy" | "Make" | "Pick" */
  methodType?: "Buy" | "Make" | "Pick";
  /** 子件的制造方法 ID（用于递归装配嵌套） */
  materialMakeMethodId?: string;
  /** 排序序号 */
  order?: number;
}

/** BOM 请求 - 添加/更新物料清单 */
export interface BomUpsertRequest {
  /** 物料清单项列表 */
  materials: BomMaterialItem[];
}

/** BOM 树节点响应 */
export interface BomTreeNode {
  /** methodMaterial ID */
  id: string;
  /** 制造方法 ID */
  makeMethodId: string;
  /** 子件的制造方法 ID（如果是装配件） */
  materialMakeMethodId: string | null;
  /** 物料类型 */
  methodType: string;
  /** 物品类型 */
  itemType: string;
  /** 物品 ID */
  itemId: string;
  /** 物品名称 */
  itemName: string;
  /** 物品编号 */
  itemReadableId: string;
  /** 用量 */
  quantity: number;
  /** 单位 */
  unitOfMeasureCode: string;
  /** 层级深度 */
  level: number;
  /** 排序序号 */
  order: number;
  /** 子节点 */
  children?: BomTreeNode[];
}

// ─── 文件相关类型 ────────────────────────────────────────────────

/** 文件类型枚举 */
export type DocumentTypeEnum =
  | "Archive"
  | "Document"
  | "Presentation"
  | "PDF"
  | "Spreadsheet"
  | "Text"
  | "Image"
  | "Video"
  | "Audio"
  | "Other";

/** 上传文件响应 */
export interface FileUploadResponse {
  success: boolean;
  documentId?: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  fileType: DocumentTypeEnum;
  createdAt: string;
  error?: string;
}

/** 物品文件列表项 */
export interface ItemFileInfo {
  name: string;
  size: number;
  path: string;
  createdAt: string;
  type: string;
}

/** CAD 文件属性 */
export interface CadFileProperties {
  /** 材料 */
  material?: string;
  /** 表面处理 */
  finish?: string;
  /** 重量 (克) */
  weight?: number;
  /** 体积 (mm³) */
  volume?: number;
  /** 外形尺寸 (mm) */
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  /** CAD 软件来源 */
  source?: string;
  /** 备注 */
  notes?: string;
}

/** CAD 文件上传请求 */
export interface CadUploadRequest {
  /** CAD 文件属性（JSON 字符串或对象） */
  properties?: CadFileProperties;
  /** 是否同时生成缩略图 */
  generateThumbnail?: boolean;
  /** 是否关联为模型 */
  asModel?: boolean;
}

// ─── 批量操作类型 ────────────────────────────────────────────────

/** 批量创建请求 - 单个物品 */
export interface BatchItemRequest extends CreateItemRequest {
  /** BOM 物料清单 */
  bom?: BomMaterialItem[];
  /** LOGO 文件（Base64 编码或 URL） */
  logoUrl?: string;
  /** 文档文件 URL 列表 */
  documentUrls?: string[];
  /** CAD 文件 URL */
  cadFileUrl?: string;
  /** CAD 文件属性 */
  cadProperties?: CadFileProperties;
}

/** 批量创建请求 */
export interface BatchCreateRequest {
  /** 物品列表 */
  items: BatchItemRequest[];
  /** 是否在遇到错误时继续处理剩余物品 */
  continueOnError?: boolean;
}

/** 批量操作结果项 */
export interface BatchItemResult {
  /** 物品 ID (readableId) */
  itemId: string;
  /** 是否成功 */
  success: boolean;
  /** 数据库内部 ID */
  internalId?: string;
  /** 错误信息 */
  error?: string;
  /** 创建的文件列表 */
  files?: {
    logo?: FileUploadResponse;
    documents?: FileUploadResponse[];
    cad?: FileUploadResponse;
  };
  /** BOM 创建结果 */
  bom?: {
    created: number;
    errors?: string[];
  };
}

/** 批量操作响应 */
export interface BatchResponse {
  success: boolean;
  /** 总处理数量 */
  total: number;
  /** 成功数量 */
  succeeded: number;
  /** 失败数量 */
  failed: number;
  /** 每个物品的详细结果 */
  results: BatchItemResult[];
}

// ─── 通用 API 响应 ───────────────────────────────────────────────

/** 统一 API 响应包装 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** 分页查询参数 */
export interface PaginationParams {
  /** 页码 (1-based) */
  page?: number;
  /** 每页大小 (默认 50, 最大 200) */
  limit?: number;
  /** 搜索关键词 */
  search?: string;
  /** 物品类型筛选 */
  type?: string;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
