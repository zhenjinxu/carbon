# PLM 集成 API - 装配与焊接场景范例数据说明

## 概述

本文档描述了为 PLM 集成 API 创建的装配与焊接场景范例数据。该数据模拟了一个**自动焊接工作站**的完整制造场景，包含多层级装配结构、焊接工艺、以及相关的物料、工具和消耗品。

**数据创建时间**: 2026-07-04  
**数据文件**: `docs/plm-sample-data-assembly-welding.sql`  
**目标数据库**: `postgres` (PostgREST 连接的数据库)  
**公司 ID**: `d8s9bh4f8gm357312pbg` (Carbon Development)

---

## 场景描述

### 产品：自动焊接工作站 (FIN-AWS-001)

这是一个六轴自动焊接工作站，用于汽车零部件的自动化焊接。产品包含三个主要子装配：
1. **底座框架** - 承载整个工作站的钢结构底座
2. **焊接臂组件** - 三轴焊接机械臂
3. **控制系统** - PLC 控制系统和 HMI 触摸屏

### 制造特点

- **焊接工艺**: 使用 MIG/MAG 气体保护焊
- **材料**: 钢材（Q235B）和铝材（6061-T6）
- **装配方式**: 多层级装配，支持递归 BOM
- **工艺路线**: 包含切割、焊接、机加工、喷涂、检验等工序

---

## 数据结构总览

### 物品统计

| 类型 | 数量 | 说明 |
|------|------|------|
| Part（零件） | 11 | 标准件、子装配、成品 |
| Material（材料） | 7 | 钢材、铝材 |
| Tool（工具） | 5 | 扭力扳手、钻头、砂轮片 |
| Consumable（消耗品） | 6 | 焊丝、保护气体、涂料 |
| **总计** | **29** | |

### BOM 结构

| 父物品 | BOM 行数 | 说明 |
|--------|----------|------|
| 底座框架 (SUB-FRM-001) | 8 | 钢材 + 焊接消耗品 + 紧固件 |
| 焊接臂组件 (SUB-ARM-001) | 6 | 铝材 + 轴承 + 紧固件 |
| 控制系统 (SUB-CTL-001) | 2 | 紧固件 |
| 自动焊接工作站 (FIN-AWS-001) | 6 | 3个子装配 + 紧固件 + 工具 |
| **总计** | **22** | |

### 工艺路线

| 物品 | 工序数 | 主要工序 |
|------|--------|----------|
| 底座框架 | 5 | 切割 → 焊接 → 机加工 → 喷涂 → 检验 |
| 焊接臂组件 | 4 | 切割 → 机加工 → 装配 → 检验 |
| 控制系统 | 2 | 电气装配 → 电气测试 |
| 自动焊接工作站 | 5 | 底座安装 → 焊接臂安装 → 控制系统安装 → 调试 → 检验 |
| **总计** | **16** | |

---

## 详细数据清单

### 1. 原材料 (Material)

#### 1.1 钢材类

| 物品编号 | 名称 | 规格 | 单位 | 补货方式 |
|----------|------|------|------|----------|
| MAT-STL-010 | 钢板 10mm | Q235B 热轧钢板，厚度 10mm | EA | 库存拉动 |
| MAT-STL-020 | 钢板 20mm | Q235B 热轧钢板，厚度 20mm | EA | 库存拉动 |
| MAT-STL-030 | 方管 50x50x3 | Q235B 方管，50x50x3mm | EA | 库存拉动 |
| MAT-STL-040 | 方管 80x80x4 | Q235B 方管，80x80x4mm | EA | 库存拉动 |
| MAT-STL-050 | 角钢 50x50x5 | Q235B 等边角钢，50x50x5mm | EA | 库存拉动 |

#### 1.2 铝材类

| 物品编号 | 名称 | 规格 | 单位 | 补货方式 |
|----------|------|------|------|----------|
| MAT-ALU-010 | 铝板 5mm | 6061-T6 铝板，厚度 5mm | EA | 库存拉动 |
| MAT-ALU-020 | 铝板 10mm | 6061-T6 铝板，厚度 10mm | EA | 库存拉动 |

### 2. 消耗品 (Consumable)

#### 2.1 焊接材料

| 物品编号 | 名称 | 规格 | 单位 | 用途 |
|----------|------|------|------|------|
| CON-WELD-001 | 焊丝 ER50-6 | CO2 气体保护焊丝，直径 1.2mm，15kg/盘 | EA | MIG/MAG 焊接 |
| CON-WELD-002 | 保护气体 CO2 | 工业级 CO2 气体，99.9% 纯度，40L/瓶 | EA | 焊接保护 |
| CON-WELD-003 | 焊接喷嘴 | MIG 焊接喷嘴，标准型 | EA | 焊接耗材 |
| CON-WELD-004 | 导电嘴 | MIG 焊接导电嘴，1.2mm 孔径 | EA | 焊接耗材 |

#### 2.2 涂料类

| 物品编号 | 名称 | 规格 | 单位 | 用途 |
|----------|------|------|------|------|
| CON-PNT-001 | 工业漆 RAL7035 | 环氧底漆，浅灰色，20L/桶 | EA | 表面喷涂 |
| CON-PNT-002 | 稀释剂 | 工业稀释剂，5L/瓶 | EA | 涂料稀释 |

### 3. 标准件 (Part - Buy)

| 物品编号 | 名称 | 规格 | 单位 | 用途 |
|----------|------|------|------|------|
| STD-BLT-001 | 螺栓 M10x30 | 8.8 级六角螺栓，M10x30mm | EA | 机械连接 |
| STD-BLT-002 | 螺栓 M12x40 | 8.8 级六角螺栓，M12x40mm | EA | 机械连接 |
| STD-NUT-001 | 螺母 M10 | 8 级六角螺母，M10 | EA | 机械连接 |
| STD-NUT-002 | 螺母 M12 | 8 级六角螺母，M12 | EA | 机械连接 |
| STD-WAS-001 | 垫圈 M10 | 平垫圈，M10 | EA | 机械连接 |
| STD-BRG-001 | 深沟球轴承 6205 | SKF 6205-2Z，双面密封 | EA | 旋转支撑 |
| STD-BRG-002 | 深沟球轴承 6208 | SKF 6208-2Z，双面密封 | EA | 旋转支撑 |

### 4. 工具 (Tool)

| 物品编号 | 名称 | 规格 | 单位 | 用途 |
|----------|------|------|------|------|
| TOL-WRN-001 | 扭力扳手 M10 | 数显扭力扳手，范围 10-100 Nm | EA | 螺栓紧固 |
| TOL-WRN-002 | 扭力扳手 M12 | 数显扭力扳手，范围 20-200 Nm | EA | 螺栓紧固 |
| TOL-DRL-001 | 钻头 5mm | HSS 高速钢钻头，5mm | EA | 钻孔 |
| TOL-DRL-002 | 钻头 8mm | HSS 高速钢钻头，8mm | EA | 钻孔 |
| TOL-GRD-001 | 砂轮片 | 角磨机砂轮片，125mm | EA | 打磨 |

### 5. 子装配 (Part - Make)

| 物品编号 | 名称 | 描述 | 追踪方式 | 工艺特点 |
|----------|------|------|----------|----------|
| SUB-FRM-001 | 底座框架 | 焊接底座框架，含喷涂 | 序列号 | 焊接件 |
| SUB-ARM-001 | 焊接臂组件 | 三轴焊接臂，含电机和导轨 | 序列号 | 精密装配 |
| SUB-CTL-001 | 控制系统 | PLC 控制系统，含 HMI 触摸屏 | 序列号 | 电气装配 |

### 6. 成品 (Part - Make)

| 物品编号 | 名称 | 描述 | 追踪方式 |
|----------|------|------|----------|
| FIN-AWS-001 | 自动焊接工作站 | 六轴自动焊接工作站，含底座、焊接臂、控制系统 | 序列号 |

---

## BOM 结构详解

### 底座框架 (SUB-FRM-001)

```
底座框架 (1 EA)
├── 钢板 20mm (4 EA) - 主要结构件
├── 方管 80x80x4 (8 EA) - 支撑框架
├── 角钢 50x50x5 (12 EA) - 加强筋
├── 焊丝 ER50-6 (2 EA) - 焊接消耗品
├── 保护气体 CO2 (1 EA) - 焊接保护
├── 工业漆 RAL7035 (1 EA) - 表面喷涂
├── 螺栓 M12x40 (24 EA) - 机械连接
└── 螺母 M12 (24 EA) - 机械连接
```

**工艺路线**:
1. 钢板切割下料 (1h 准备 + 0.5h/件 人工 + 2h/件 机器)
2. 框架焊接 (2h 准备 + 1h/件 人工 + 8h/件 机器) ⭐ **关键工序**
3. 焊接后加工 (1h 准备 + 0.5h/件 人工 + 3h/件 机器)
4. 喷涂底漆 (1h 准备 + 0.5h/件 人工 + 2h/件 机器)
5. 尺寸检验 (0.5h 准备 + 1h/件 人工 + 0.5h/件 机器)

### 焊接臂组件 (SUB-ARM-001)

```
焊接臂组件 (1 EA)
├── 铝板 10mm (6 EA) - 臂体结构
├── 方管 50x50x3 (4 EA) - 支撑结构
├── 深沟球轴承 6208 (4 EA) - 旋转关节
├── 螺栓 M10x30 (32 EA) - 机械连接
├── 螺母 M10 (32 EA) - 机械连接
└── 焊丝 ER50-6 (1 EA) - 焊接消耗品
```

**工艺路线**:
1. 铝板切割 (0.5h 准备 + 0.3h/件 人工 + 1.5h/件 机器)
2. 精密加工 (1h 准备 + 0.5h/件 人工 + 4h/件 机器)
3. 轴承装配 (0.5h 准备 + 2h/件 人工)
4. 装配检验 (0.5h 准备 + 1.5h/件 人工 + 0.5h/件 机器)

### 控制系统 (SUB-CTL-001)

```
控制系统 (1 EA)
├── 螺栓 M10x30 (16 EA) - 电气柜安装
└── 螺母 M10 (16 EA) - 电气柜安装
```

**工艺路线**:
1. 电气装配 (1h 准备 + 4h/件 人工)
2. 电气测试 (0.5h 准备 + 2h/件 人工 + 1h/件 机器)

### 自动焊接工作站 (FIN-AWS-001)

```
自动焊接工作站 (1 EA)
├── 底座框架 (1 EA) - 子装配 [Make to Order]
├── 焊接臂组件 (1 EA) - 子装配 [Make to Order]
├── 控制系统 (1 EA) - 子装配 [Make to Order]
├── 螺栓 M12x40 (16 EA) - 总装紧固件
├── 螺母 M12 (16 EA) - 总装紧固件
└── 扭力扳手 M12 (1 EA) - 装配工具
```

**工艺路线**:
1. 底座安装 (1h 准备 + 2h/件 人工)
2. 焊接臂安装 (1h 准备 + 3h/件 人工)
3. 控制系统安装 (1h 准备 + 2h/件 人工)
4. 整机调试 (2h 准备 + 4h/件 人工 + 2h/件 机器) ⭐ **关键工序**
5. 最终检验 (1h 准备 + 2h/件 人工 + 1h/件 机器)

---

## 工作中心与工序

### 工作中心

| 工作中心 ID | 名称 | 人工费率 | 机器费率 | 能力 |
|-------------|------|----------|----------|------|
| wc-welding-01 | 焊接工位 #1 | ¥80/h | ¥120/h | MIG/MAG 焊接 |
| wc-assembly-01 | 装配工位 #1 | ¥60/h | ¥0/h | 机械装配 |
| wc-cutting-01 | 切割工位 | ¥50/h | ¥150/h | 激光/等离子切割 |
| wc-machining-01 | 机加工工位 | ¥70/h | ¥180/h | CNC 加工 |
| wc-painting-01 | 喷涂工位 | ¥40/h | ¥100/h | 自动喷涂 |
| wc-inspection-01 | 检验工位 | ¥90/h | ¥200/h | 三坐标测量 |

### 工序定义

| 工序 ID | 名称 | 类型 | 默认时间单位 |
|---------|------|------|--------------|
| proc-welding | 焊接 | 内部 | Hours/Piece |
| proc-assembly | 装配 | 内部 | Hours/Piece |
| proc-cutting | 切割下料 | 内部 | Hours/Piece |
| proc-machining | 机加工 | 内部 | Hours/Piece |
| proc-painting | 喷涂 | 内部 | Hours/Piece |
| proc-inspection | 检验 | 内部 | Hours/Piece |

---

## 数据关系图

```
自动焊接工作站 (FIN-AWS-001)
│
├─┬─ 底座框架 (SUB-FRM-001) [Make]
│ │  ├─ 钢材 (MAT-STL-*) [Buy]
│ │  ├─ 焊接消耗品 (CON-WELD-*) [Buy]
│ │  └─ 紧固件 (STD-BLT-*, STD-NUT-*) [Buy]
│ │
├─┬─ 焊接臂组件 (SUB-ARM-001) [Make]
│ │  ├─ 铝材 (MAT-ALU-*) [Buy]
│ │  ├─ 轴承 (STD-BRG-*) [Buy]
│ │  └─ 紧固件 (STD-BLT-*, STD-NUT-*) [Buy]
│ │
└─┬─ 控制系统 (SUB-CTL-001) [Make]
   └─ 紧固件 (STD-BLT-*, STD-NUT-*) [Buy]
```

---

## 使用方法

### 1. 执行 SQL 脚本

```bash
# 连接到 postgres 数据库
PGPASSWORD=postgres psql -h localhost -p 56251 -U postgres -d postgres

# 执行脚本
\i docs/plm-sample-data-assembly-welding.sql
```

### 2. 通过 PLM API 查询

#### 查询成品信息

```bash
curl -H "carbon-key: plm-api-key-1783138347447" \
  http://localhost:3000/api/plm/items/FIN-AWS-001
```

#### 查询 BOM 结构

```bash
curl -H "carbon-key: plm-api-key-1783138347447" \
  http://localhost:3000/api/plm/items/FIN-AWS-001/bom
```

#### 查询子装配 BOM

```bash
curl -H "carbon-key: plm-api-key-1783138347447" \
  http://localhost:3000/api/plm/items/SUB-FRM-001/bom
```

### 3. 验证数据

```sql
-- 查询所有创建的物品
SELECT type, COUNT(*) as count
FROM item
WHERE id LIKE 'item-%' OR id LIKE 'tool-%' OR id LIKE 'mat-%' OR id LIKE 'std-%' OR id LIKE 'con-%' OR id LIKE 'sub-%' OR id LIKE 'fin-%'
GROUP BY type;

-- 查询 BOM 结构
SELECT 
  i."readableId" as parent,
  i.name as parent_name,
  COUNT(mml.id) as bom_lines
FROM "makeMethod" mm
JOIN item i ON i.id = mm."itemId"
LEFT JOIN "methodMaterial" mml ON mml."makeMethodId" = mm.id
WHERE i."readableId" IN ('FIN-AWS-001', 'SUB-FRM-001', 'SUB-ARM-001', 'SUB-CTL-001')
GROUP BY i."readableId", i.name;

-- 查询工艺路线
SELECT 
  i."readableId",
  i.name,
  COUNT(mo.id) as operations
FROM "makeMethod" mm
JOIN item i ON i.id = mm."itemId"
LEFT JOIN "methodOperation" mo ON mo."makeMethodId" = mm.id
WHERE i."readableId" IN ('FIN-AWS-001', 'SUB-FRM-001', 'SUB-ARM-001', 'SUB-CTL-001')
GROUP BY i."readableId", i.name;
```

---

## 关键特性

### 1. 多层级 BOM

- 支持递归装配结构
- 子装配使用 `Make to Order` 方法类型
- 通过 `materialMakeMethodId` 建立父子关系

### 2. 焊接工艺

- 包含焊接消耗品（焊丝、保护气体）
- 焊接工序作为关键工序，设置较长的机器时间
- 焊接工位配置 MIG/MAG 焊接设备

### 3. 工具管理

- 装配工具作为 BOM 的一部分
- 工具使用 `Inventory` 追踪方式（非序列号）
- 支持工具消耗跟踪

### 4. 工艺路线

- 每个制造物品都有完整的工艺路线
- 工序包含准备时间、人工时间、机器时间
- 支持工作中心能力映射

---

## 扩展建议

### 1. 添加更多焊接变体

- 不同焊接方法（TIG、激光焊）
- 不同材料组合（不锈钢、铝合金）
- 不同厚度规格

### 2. 添加质量控制

- 焊接检验标准
- 无损检测（NDT）工序
- 尺寸公差要求

### 3. 添加成本核算

- 材料成本
- 人工成本
- 机器成本
- 外协成本

### 4. 添加文档关联

- CAD 模型文件
- 焊接工艺卡
- 检验报告

---

## 相关文件

- **SQL 脚本**: `docs/plm-sample-data-assembly-welding.sql`
- **API 文档**: `docs/plm-api.md`
- **工作总结**: `docs/plm-api-work-summary.md`
- **类型定义**: `apps/erp/app/modules/plm/types.ts`

---

## 联系与支持

如有问题或需要更多范例数据，请参考：
- PLM API 文档：`docs/plm-api.md`
- 工作总结：`docs/plm-api-work-summary.md`
