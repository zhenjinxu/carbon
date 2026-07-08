# Carbon PLM 集成 API 使用文档

## 概述

Carbon PLM API 提供了一套完整的 RESTful 接口，支持从外部 PLM 系统直接导入物品数据到 Carbon 物品模块。

**功能特性：**
- ✅ 物品基础信息管理（创建/查询/更新/停用）
- ✅ 装配嵌套（BOM 结构管理）
- ✅ 物品 LOGO/缩略图上传
- ✅ 物品说明文档上传（Word/Excel/PDF 等）
- ✅ CAD 模型文件上传（STEP/STL/IGES 等）
- ✅ 批量操作支持

**认证方式：** API Key（通过 `carbon-key` 请求头）

---

## 认证

所有 API 请求都需要在请求头中提供 `carbon-key`：

```
carbon-key: your-api-key-here
```

API Key 在 Carbon 系统中创建，支持权限范围（scopes）和速率限制（rate limit）。

---

## API 端点

### 基础 URL

```
http://localhost:3000/api/plm
```

### 1. 物品管理

#### 1.1 获取物品列表

**GET** `/api/plm/items`

**查询参数：**
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 50，最大 200
- `search` (可选): 搜索关键词（按物品编号或名称）
- `type` (可选): 物品类型筛选（Part/Material/Tool/Service/Consumable）

**请求示例：**
```bash
curl -X GET "http://localhost:3000/api/plm/items?page=1&limit=20&type=Part" \
  -H "carbon-key: your-api-key"
```

**响应示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "item-123",
      "readableId": "ASM-TOP-001",
      "revision": "0",
      "name": "顶部装配件",
      "description": "产品顶部装配组件",
      "type": "Part",
      "replenishmentSystem": "Make",
      "defaultMethodType": "Make",
      "itemTrackingType": "Inventory",
      "unitOfMeasureCode": "EA",
      "active": true,
      "thumbnailUrl": "https://...",
      "thumbnailPath": "company-id/parts/item-123/logo.png",
      "modelUploadId": null,
      "blocked": false,
      "companyId": "company-123",
      "createdAt": "2026-07-04T10:00:00Z",
      "updatedAt": "2026-07-04T10:00:00Z",
      "part": {
        "approved": false,
        "approvedBy": null,
        "fromDate": null,
        "toDate": null,
        "assignee": null
      }
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

#### 1.2 创建物品

**POST** `/api/plm/items`

**请求体：**
```json
{
  "id": "ASM-TOP-001",
  "revision": "0",
  "name": "顶部装配件",
  "description": "产品顶部装配组件",
  "type": "Part",
  "replenishmentSystem": "Make",
  "defaultMethodType": "Make",
  "itemTrackingType": "Inventory",
  "unitOfMeasureCode": "EA",
  "unitCost": 100.00,
  "postingGroupId": "PG-001",
  "defaultStorageUnitId": "SU-001",
  "lotSize": 10,
  "customFields": {
    "material": "铝合金",
    "finish": "阳极氧化"
  }
}
```

**必填字段：**
- `id`: 物品编号（readableId）
- `name`: 物品名称
- `unitOfMeasureCode`: 计量单位代码

**可选字段：**
- `revision`: 版本号，默认 "0"
- `description`: 描述
- `type`: 物品类型，默认 "Part"
- `replenishmentSystem`: 补货系统（Buy/Make/Buy and Make），默认 "Buy"
- `defaultMethodType`: 默认方法类型（Buy/Make/Pick），默认 "Buy"
- `itemTrackingType`: 追踪类型（Inventory/Non-Inventory/Serial/Batch），默认 "Inventory"
- `unitCost`: 单位成本
- `postingGroupId`: 过账组 ID
- `defaultStorageUnitId`: 默认存储单元 ID
- `lotSize`: 批大小（Make 类型物品）
- `customFields`: 自定义字段（JSON）

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/items" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ASM-TOP-001",
    "name": "顶部装配件",
    "description": "产品顶部装配组件",
    "replenishmentSystem": "Make",
    "unitOfMeasureCode": "EA"
  }'
```

**响应示例：**
```json
{
  "success": true,
  "message": "物品创建成功",
  "data": {
    "id": "item-123",
    "readableId": "ASM-TOP-001",
    ...
  }
}
```

#### 1.3 获取物品详情

**GET** `/api/plm/items/:id`

**路径参数：**
- `id`: 物品编号（readableId）

**请求示例：**
```bash
curl -X GET "http://localhost:3000/api/plm/items/ASM-TOP-001" \
  -H "carbon-key: your-api-key"
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": "item-123",
    "readableId": "ASM-TOP-001",
    "revision": "0",
    "name": "顶部装配件",
    "description": "产品顶部装配组件",
    "type": "Part",
    "replenishmentSystem": "Make",
    "defaultMethodType": "Make",
    "itemTrackingType": "Inventory",
    "unitOfMeasureCode": "EA",
    "active": true,
    "thumbnailUrl": "https://...",
    "thumbnailPath": "company-id/parts/item-123/logo.png",
    "modelUploadId": null,
    "blocked": false,
    "companyId": "company-123",
    "createdAt": "2026-07-04T10:00:00Z",
    "updatedAt": "2026-07-04T10:00:00Z",
    "part": {
      "approved": false,
      "approvedBy": null,
      "fromDate": null,
      "toDate": null,
      "assignee": null
    },
    "cost": {
      "costingMethod": "Standard",
      "standardCost": 100.00,
      "unitCost": 100.00
    }
  }
}
```

#### 1.4 更新物品

**PUT** `/api/plm/items/:id`

**路径参数：**
- `id`: 物品编号（readableId）

**请求体：**（所有字段可选）
```json
{
  "name": "更新后的名称",
  "description": "更新后的描述",
  "revision": "1",
  "unitCost": 120.00
}
```

**请求示例：**
```bash
curl -X PUT "http://localhost:3000/api/plm/items/ASM-TOP-001" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "更新后的名称",
    "description": "更新后的描述"
  }'
```

**响应示例：**
```json
{
  "success": true,
  "message": "物品更新成功",
  "data": {
    ...
  }
}
```

#### 1.5 停用物品

**DELETE** `/api/plm/items/:id`

**路径参数：**
- `id`: 物品编号（readableId）

**请求示例：**
```bash
curl -X DELETE "http://localhost:3000/api/plm/items/ASM-TOP-001" \
  -H "carbon-key: your-api-key"
```

**响应示例：**
```json
{
  "success": true,
  "message": "物品 ASM-TOP-001 已停用"
}
```

---

### 2. BOM / 装配嵌套

#### 2.1 获取 BOM 树

**GET** `/api/plm/items/:id/bom`

**路径参数：**
- `id`: 父物品编号（readableId）

**请求示例：**
```bash
curl -X GET "http://localhost:3000/api/plm/items/ASM-TOP-001/bom" \
  -H "carbon-key: your-api-key"
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "itemId": "item-123",
    "readableId": "ASM-TOP-001",
    "name": "顶部装配件",
    "makeMethodId": "method-456",
    "materials": [
      {
        "id": "mm-001",
        "makeMethodId": "method-456",
        "materialMakeMethodId": null,
        "methodType": "Buy",
        "itemType": "Material",
        "itemId": "item-789",
        "itemName": "铝板",
        "itemReadableId": "MAT-ALU-001",
        "quantity": 2,
        "unitOfMeasureCode": "EA",
        "level": 1,
        "order": 1,
        "children": []
      }
    ]
  }
}
```

#### 2.2 创建/更新 BOM 物料

**POST** `/api/plm/items/:id/bom`

**路径参数：**
- `id`: 父物品编号（readableId）

**请求体：**
```json
{
  "materials": [
    {
      "itemId": "MAT-ALU-001",
      "quantity": 2,
      "unitOfMeasureCode": "EA",
      "methodType": "Buy",
      "order": 1
    },
    {
      "itemId": "MAT-STEEL-002",
      "quantity": 1,
      "unitOfMeasureCode": "EA",
      "methodType": "Buy",
      "order": 2
    }
  ]
}
```

**必填字段：**
- `materials`: 物料清单数组
  - `itemId`: 子件物品编号
  - `quantity`: 用量
  - `unitOfMeasureCode`: 用量单位

**可选字段：**
- `methodType`: 方法类型（Buy/Make/Pick），默认从子件继承
- `order`: 排序序号

**注意：** 父物品的 `replenishmentSystem` 必须是 "Make" 或 "Buy and Make"。

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/bom" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "materials": [
      {
        "itemId": "MAT-ALU-001",
        "quantity": 2,
        "unitOfMeasureCode": "EA"
      }
    ]
  }'
```

**响应示例：**
```json
{
  "success": true,
  "message": "BOM 更新完成: 1 成功, 0 失败",
  "data": {
    "makeMethodId": "method-456",
    "results": [
      {
        "itemId": "MAT-ALU-001",
        "success": true,
        "materialId": "mm-001"
      }
    ]
  }
}
```

#### 2.3 删除 BOM 物料

**DELETE** `/api/plm/items/:id/bom/:materialId`

**路径参数：**
- `id`: 父物品编号（readableId）
- `materialId`: 物料记录 ID（从 GET BOM 接口获取）

**请求示例：**
```bash
curl -X DELETE "http://localhost:3000/api/plm/items/ASM-TOP-001/bom/mm-001" \
  -H "carbon-key: your-api-key"
```

**响应示例：**
```json
{
  "success": true,
  "message": "物料 mm-001 已从物品 ASM-TOP-001 的 BOM 中移除"
}
```

---

### 3. 文件上传

#### 3.1 上传物品 LOGO

**POST** `/api/plm/items/:id/logo`

**路径参数：**
- `id`: 物品编号（readableId）

**请求格式：** `multipart/form-data`

**表单字段：**
- `file`: 图片文件（PNG/JPG/GIF/WEBP）

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/logo" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/logo.png"
```

**响应示例：**
```json
{
  "success": true,
  "message": "LOGO 上传成功",
  "data": {
    "success": true,
    "storagePath": "company-id/parts/item-123/logo.png",
    "fileName": "logo.png",
    "fileSize": 12345,
    "fileType": "Image",
    "createdAt": "2026-07-04T10:00:00Z"
  },
  "thumbnailUrl": "https://..."
}
```

#### 3.2 上传物品说明文档

**POST** `/api/plm/items/:id/documents`

**路径参数：**
- `id`: 物品编号（readableId）

**请求格式：** `multipart/form-data`

**表单字段：**
- `file`: 文档文件（Word/Excel/PDF/TXT 等）
- `name` (可选): 文件名（默认使用原文件名）
- `description` (可选): 文档描述

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/documents" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/spec.pdf" \
  -F "description=产品规格说明书"
```

**响应示例：**
```json
{
  "success": true,
  "message": "文档上传成功",
  "data": {
    "success": true,
    "documentId": "doc-123",
    "storagePath": "company-id/parts/item-123/spec.pdf",
    "fileName": "spec.pdf",
    "fileSize": 54321,
    "fileType": "PDF",
    "createdAt": "2026-07-04T10:00:00Z"
  }
}
```

#### 3.3 上传 CAD 模型文件

**POST** `/api/plm/items/:id/cad`

**路径参数：**
- `id`: 物品编号（readableId）

**请求格式：** `multipart/form-data`

**表单字段：**
- `file`: CAD 文件（STEP/STL/IGES/3MF 等）
- `name` (可选): 文件名
- `properties` (可选): CAD 属性 JSON 字符串

**CAD 属性格式：**
```json
{
  "material": "铝合金",
  "finish": "阳极氧化",
  "weight": 150.5,
  "volume": 55000,
  "dimensions": {
    "length": 100,
    "width": 50,
    "height": 20
  },
  "source": "SolidWorks",
  "notes": "需要去毛刺"
}
```

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/cad" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/model.step" \
  -F 'properties={"material":"铝合金","weight":150.5}'
```

**响应示例：**
```json
{
  "success": true,
  "message": "CAD 文件上传成功",
  "data": {
    "success": true,
    "storagePath": "company-id/models/model-789.step",
    "fileName": "model.step",
    "fileSize": 123456,
    "fileType": "Other",
    "createdAt": "2026-07-04T10:00:00Z"
  },
  "modelId": "model-789",
  "modelPath": "company-id/models/model-789.step",
  "cadProperties": {
    "material": "铝合金",
    "weight": 150.5
  }
}
```

---

### 4. 批量操作

#### 4.1 批量创建物品

**POST** `/api/plm/batch`

**请求体：**
```json
{
  "items": [
    {
      "id": "MAT-ALU-001",
      "name": "铝板",
      "unitOfMeasureCode": "EA",
      "replenishmentSystem": "Buy",
      "unitCost": 50.00
    },
    {
      "id": "ASM-TOP-001",
      "name": "顶部装配件",
      "unitOfMeasureCode": "EA",
      "replenishmentSystem": "Make",
      "bom": [
        {
          "itemId": "MAT-ALU-001",
          "quantity": 2,
          "unitOfMeasureCode": "EA"
        }
      ]
    }
  ],
  "continueOnError": true
}
```

**必填字段：**
- `items`: 物品列表数组
  - `id`: 物品编号
  - `name`: 物品名称
  - `unitOfMeasureCode`: 计量单位

**可选字段：**
- `continueOnError`: 遇到错误时是否继续处理剩余物品，默认 true
- `bom`: BOM 物料清单（仅当 `replenishmentSystem` 为 "Make" 或 "Buy and Make" 时有效）

**注意：** 批量操作仅处理物品和 BOM 数据，文件上传（LOGO/文档/CAD）需单独调用对应端点。

**请求示例：**
```bash
curl -X POST "http://localhost:3000/api/plm/batch" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "id": "MAT-ALU-001",
        "name": "铝板",
        "unitOfMeasureCode": "EA"
      }
    ],
    "continueOnError": true
  }'
```

**响应示例：**
```json
{
  "success": true,
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "results": [
    {
      "itemId": "MAT-ALU-001",
      "success": true,
      "internalId": "item-789"
    },
    {
      "itemId": "ASM-TOP-001",
      "success": true,
      "internalId": "item-123",
      "bom": {
        "created": 1,
        "errors": []
      }
    }
  ]
}
```

---

## 完整工作流示例

### 场景：从 PLM 导入完整产品数据

**步骤 1：创建所有物料**
```bash
curl -X POST "http://localhost:3000/api/plm/items" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "MAT-ALU-001",
    "name": "铝板",
    "unitOfMeasureCode": "EA",
    "replenishmentSystem": "Buy",
    "unitCost": 50.00
  }'
```

**步骤 2：创建装配件**
```bash
curl -X POST "http://localhost:3000/api/plm/items" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ASM-TOP-001",
    "name": "顶部装配件",
    "unitOfMeasureCode": "EA",
    "replenishmentSystem": "Make"
  }'
```

**步骤 3：创建 BOM 关系**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/bom" \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "materials": [
      {
        "itemId": "MAT-ALU-001",
        "quantity": 2,
        "unitOfMeasureCode": "EA"
      }
    ]
  }'
```

**步骤 4：上传 LOGO**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/logo" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/logo.png"
```

**步骤 5：上传说明文档**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/documents" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/spec.pdf" \
  -F "description=产品规格说明书"
```

**步骤 6：上传 CAD 模型**
```bash
curl -X POST "http://localhost:3000/api/plm/items/ASM-TOP-001/cad" \
  -H "carbon-key: your-api-key" \
  -F "file=@/path/to/model.step" \
  -F 'properties={"material":"铝合金","weight":150.5}'
```

---

## Python 示例

```python
import requests
import json

API_BASE = "http://localhost:3000/api/plm"
API_KEY = "your-api-key-here"

headers = {
    "carbon-key": API_KEY
}

# 1. 创建物品
response = requests.post(
    f"{API_BASE}/items",
    headers=headers,
    json={
        "id": "ASM-TOP-001",
        "name": "顶部装配件",
        "unitOfMeasureCode": "EA",
        "replenishmentSystem": "Make"
    }
)
print(response.json())

# 2. 上传 LOGO
with open("logo.png", "rb") as f:
    response = requests.post(
        f"{API_BASE}/items/ASM-TOP-001/logo",
        headers=headers,
        files={"file": f}
    )
    print(response.json())

# 3. 创建 BOM
response = requests.post(
    f"{API_BASE}/items/ASM-TOP-001/bom",
    headers=headers,
    json={
        "materials": [
            {
                "itemId": "MAT-ALU-001",
                "quantity": 2,
                "unitOfMeasureCode": "EA"
            }
        ]
    }
)
print(response.json())
```

---

## Node.js 示例

```javascript
const API_BASE = "http://localhost:3000/api/plm";
const API_KEY = "your-api-key-here";

const headers = {
  "carbon-key": API_KEY,
  "Content-Type": "application/json"
};

// 1. 创建物品
const response = await fetch(`${API_BASE}/items`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    id: "ASM-TOP-001",
    name: "顶部装配件",
    unitOfMeasureCode: "EA",
    replenishmentSystem: "Make"
  })
});
const data = await response.json();
console.log(data);

// 2. 上传 LOGO
const formData = new FormData();
formData.append("file", fs.createReadStream("logo.png"));

const logoResponse = await fetch(`${API_BASE}/items/ASM-TOP-001/logo`, {
  method: "POST",
  headers: { "carbon-key": API_KEY },
  body: formData
});
console.log(await logoResponse.json());
```

---

## 枚举值参考

### 物品类型 (type)
- `Part`: 零件
- `Material`: 物料
- `Tool`: 工具
- `Service`: 服务
- `Consumable`: 耗材
- `Fixture`: 夹具

### 补货系统 (replenishmentSystem)
- `Buy`: 采购
- `Make`: 制造
- `Buy and Make`: 采购并制造

### 方法类型 (defaultMethodType)
- `Buy`: 采购
- `Make`: 制造
- `Pick`: 拣选

### 追踪类型 (itemTrackingType)
- `Inventory`: 库存追踪
- `Non-Inventory`: 非库存
- `Serial`: 序列号追踪
- `Batch`: 批次追踪

### 文档类型 (fileType)
- `Archive`: 压缩包
- `Document`: 文档
- `Presentation`: 演示文稿
- `PDF`: PDF 文件
- `Spreadsheet`: 电子表格
- `Text`: 文本文件
- `Image`: 图片
- `Video`: 视频
- `Audio`: 音频
- `Other`: 其他

---

## 错误处理

所有错误响应格式：
```json
{
  "success": false,
  "error": "错误描述信息"
}
```

**常见 HTTP 状态码：**
- `200`: 成功
- `201`: 创建成功
- `207`: 部分成功（批量操作）
- `400`: 请求参数错误
- `401`: 认证失败（API Key 无效或过期）
- `404`: 资源不存在
- `405`: 方法不允许
- `429`: 速率限制超出
- `500`: 服务器错误

---

## 注意事项

1. **物品编号唯一性**：`id`（readableId）在公司内必须唯一
2. **BOM 父物品要求**：创建 BOM 前，父物品的 `replenishmentSystem` 必须是 "Make" 或 "Buy and Make"
3. **文件上传限制**：单个文件大小限制取决于 Supabase Storage 配置
4. **批量操作**：建议单次批量不超过 100 个物品
5. **速率限制**：API Key 配置了速率限制，请合理控制请求频率

---

## 技术支持

如有问题，请联系 Carbon 开发团队。
