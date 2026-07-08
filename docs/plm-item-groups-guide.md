# 物品组（Item Posting Groups）在 Carbon ERP 中的应用

## 什么是物品组？

物品组（Item Posting Groups）是 Carbon ERP 系统中用于**物料分类和财务核算**的核心概念。它借鉴了 Microsoft Dynamics 365 Business Central 等成熟 ERP 系统的最佳实践。

### 核心作用

1. **财务核算分类**：确定物料交易过账到哪个总账科目（GL Account）
2. **物料管理分组**：按功能和用途对物料进行分类管理
3. **报表过滤**：在报表、定价规则、存储规则中按组筛选
4. **成本分析**：支持按物料组进行成本分析和 ABC/FSN 分析

### 在 Carbon 中的实现

```
item (物料) 
  └── itemCost (物料成本)
        └── itemPostingGroupId (物品组ID)
              └── itemPostingGroup (物品组)
```

- 物品组通过 `itemCost.itemPostingGroupId` 与物料关联
- 每个公司可以有独立的物品组体系
- 系统自动为每个物品组生成库存/销售/采购的过账组合

---

## 行业最佳实践

### 制造业 ERP 物料分类标准

根据 Microsoft Dynamics 365、SAP、Oracle 等主流 ERP 系统的实践，制造业物料通常按以下维度分类：

| 分类维度 | 典型类别 | 说明 |
|---------|---------|------|
| **原材料** | RAW-MAT | 基础材料，可追溯到成品 |
| **零部件** | PARTS | 采购或加工的标准件、子装配件 |
| **消耗品** | CONS | 生产辅料，不可直接追溯到单个产品 |
| **工具** | TOOLS/MRO | 维护、修理和运营用品 |
| **成品** | FG | 可销售的最终产品 |
| **在制品** | WIP | 生产过程中的半成品 |
| **外协加工** | SUBCON | 外发加工的物料 |
| **废料** | SCRAP | 边角料、废品 |

### 分类方法

- **ABC 分析**：按价值/重要性分类（A=高价值钢材，C=低价值消耗品）
- **FSN 分析**：按周转速度分类（Fast/Slow/Non-moving）
- **直接/间接物料**：直接物料可追溯到产品，间接物料共享使用
- **按功能用途**：原材料、半成品、成品、备品备件、消耗品等

---

## 焊接工作站场景的物品组设计

### 物品组清单

我们为"自动焊接工作站"场景设计了 9 个物品组：

| 物品组ID | 名称 | 包含物料 | 财务科目类型 |
|---------|------|---------|-------------|
| `grp-raw-steel` | 原材料-钢材 | 钢板、方管、角钢 | 库存资产 |
| `grp-raw-alu` | 原材料-铝材 | 铝板 | 库存资产 |
| `grp-std-fastener` | 标准件-紧固件 | 螺栓、螺母、垫圈 | 库存资产 |
| `grp-std-bearing` | 标准件-轴承 | 深沟球轴承 | 库存资产 |
| `grp-consumable-weld` | 消耗品-焊接材料 | 焊丝、保护气体、喷嘴 | 间接材料费用 |
| `grp-consumable-paint` | 消耗品-涂料 | 工业漆、稀释剂 | 间接材料费用 |
| `grp-tool` | 工具 | 扭力扳手、钻头、砂轮片 | 工具设备资产 |
| `grp-subassembly` | 子装配 | 底座框架、焊接臂、控制系统 | 在制品库存 |
| `grp-finished` | 成品 | 自动焊接工作站 | 成品库存 |

### 物料分配统计

```
原材料-钢材:       5 个物料 (钢板 10mm/20mm, 方管 50/80, 角钢)
原材料-铝材:       2 个物料 (铝板 5mm/10mm)
标准件-紧固件:     5 个物料 (螺栓 M10/M12, 螺母 M10/M12, 垫圈)
标准件-轴承:       2 个物料 (轴承 6205/6208)
消耗品-焊接材料:   4 个物料 (焊丝, 保护气体, 喷嘴, 导电嘴)
消耗品-涂料:       2 个物料 (工业漆, 稀释剂)
工具:              5 个物料 (扭力扳手 M10/M12, 钻头 5/8mm, 砂轮片)
子装配:            3 个物料 (底座框架, 焊接臂, 控制系统)
成品:              1 个物料 (自动焊接工作站)
─────────────────────────────────────────
总计:             29 个物料
```

---

## 物品组的应用场景

### 1. 财务报表按组分析

```sql
-- 按物品组统计库存价值
SELECT 
  pg.name AS "物品组",
  COUNT(i.id) AS "物料数量",
  SUM(ic.standardCost) AS "标准成本合计"
FROM "itemPostingGroup" pg
JOIN "itemCost" ic ON ic."itemPostingGroupId" = pg.id
JOIN item i ON i.id = ic."itemId"
WHERE pg."companyId" = 'd8s9bh4f8gm357312pbg'
GROUP BY pg.name
ORDER BY "标准成本合计" DESC;
```

### 2. 采购规则按组配置

可以为不同物品组设置不同的采购策略：
- **原材料**：按批量采购，设置安全库存
- **标准件**：按经济批量采购，VMI 管理
- **消耗品**：定期补充，最小-最大库存
- **工具**：按需采购，定期盘点

### 3. 定价策略按组应用

```typescript
// 销售定价规则可以按物品组设置折扣
pricingRule = {
  itemPostingGroupId: 'grp-finished',
  discountPercentage: 15,
  customerType: 'wholesale'
}
```

### 4. 存储规则按组过滤

```typescript
// 存储规则可以按物品组限制存储位置
storageRule = {
  filteredItemGroupIds: ['grp-raw-steel', 'grp-raw-alu'],
  allowedLocations: ['原材料仓'],
  temperature: 'ambient'
}
```

### 5. BOM 成本分析按组汇总

```sql
-- 按物品组分析 BOM 成本构成
SELECT 
  pg.name AS "物料类别",
  SUM(mm.quantity * ic.unitCost) AS "成本小计"
FROM "methodMaterial" mm
JOIN "itemCost" ic ON ic."itemId" = mm."itemId"
JOIN "itemPostingGroup" pg ON pg.id = ic."itemPostingGroupId"
WHERE mm."makeMethodId" = 'mm-welding-station'
GROUP BY pg.name;

-- 结果示例：
-- 原材料-钢材:       ¥ 2,400
-- 标准件-紧固件:     ¥   180
-- 消耗品-焊接材料:   ¥   350
-- 子装配:            ¥ 8,500
```

---

## 与 PLM 系统的集成

### PLM 数据导入时的物品组映射

当 PLM 系统通过 API 导入物料时，可以根据物料类型自动分配物品组：

```python
# PLM 导入映射规则
item_group_mapping = {
    'Material': {
        'Steel': 'grp-raw-steel',
        'Aluminum': 'grp-raw-alu',
    },
    'Part': {
        'Standard': 'grp-std-fastener',  # 或 grp-std-bearing
        'SubAssembly': 'grp-subassembly',
        'Finished': 'grp-finished',
    },
    'Tool': 'grp-tool',
    'Consumable': {
        'Welding': 'grp-consumable-weld',
        'Paint': 'grp-consumable-paint',
    }
}
```

### API 使用示例

```bash
# 通过 PLM API 创建物料并指定物品组
curl -X POST http://localhost:3000/api/plm/items \
  -H "carbon-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "MAT-STL-NEW",
    "name": "新钢板规格",
    "type": "Material",
    "postingGroupId": "grp-raw-steel",
    "unitOfMeasureCode": "EA"
  }'
```

---

## 最佳实践建议

### 1. 物品组设计原则

- **粒度适中**：不要过细（导致管理复杂）也不要过粗（失去分析价值）
- **业务导向**：按业务流程和财务核算需求设计，而非技术属性
- **可扩展性**：预留扩展空间，支持未来业务增长
- **一致性**：保持命名和分类的一致性

### 2. 常见陷阱

❌ **错误做法**：
- 按物料编码前缀分组（如 "MAT-" 开头的一组）
- 一个物品组包含太多不相关的物料
- 频繁修改物品组定义

✅ **正确做法**：
- 按业务功能和财务科目分组
- 每个物品组有明确的业务范围
- 建立物品组变更审批流程

### 3. 实施建议

1. **初始设计**：从 5-10 个核心物品组开始
2. **逐步细化**：根据实际运营需求逐步增加
3. **定期审查**：每季度审查物品组使用情况
4. **培训宣导**：确保所有用户理解物品组的含义和用途

---

## 参考资源

### ERP 系统最佳实践

- [Microsoft Dynamics 365 Posting Groups](https://learn.microsoft.com/en-au/dynamics365/business-central/finance-posting-groups)
- [Inventory Posting Group Setup](https://community.dynamics.com/forums/thread/details/?threadid=75239c9c-9166-4afa-98fd-df209ac724f4)
- [Posting Groups in Business Central](https://www.elian-solutions.com/what-are-the-posting-groups-in-business-central/)

### 物料分类方法

- [ERP 物料分类对比分析](https://www.jiandaoyun.com/news/article/68ae9f66229b892d5257a894)
- [制定物料分类规则的标准和常见方法](https://zhuanlan.zhihu.com/p/496464306)
- [制造业 ERP 的八大基本价值](https://www.solidworks.com/sites/default/files/2021-06/Eight%20Essential%20Values%20of%20Manufacturing%20ERP_ZH-CN.pdf)

### PLM-ERP 集成

- [PLM+ERP Solutions: Best Practices](https://beyondplm.com/2023/10/27/plmerp-questions-best-practices-and-industrial-examples/)
- [Managing Product Data in PLM and ERP](https://staedean.com/manufacturing/blog/managing-product-data-plm-erp)
- [Best PLM ERP Integration for Manufacturing 2025](https://www.cudio.com/blog/best-plm-erp-integration-for-manufacturing)

---

## 总结

物品组是连接**物料管理**和**财务核算**的桥梁。在 Carbon ERP 中：

- ✅ 9 个物品组覆盖了焊接工作站的完整物料体系
- ✅ 29 个物料已正确分配到对应物品组
- ✅ 支持按组进行财务分析、采购管理、定价策略
- ✅ 为 PLM 系统集成提供了标准化的分类框架

通过合理使用物品组，可以实现：
- 📊 更精准的财务核算和成本分析
- 📦 更高效的库存管理和采购优化
- 💰 更灵活的定价策略和利润分析
- 📈 更有价值的业务洞察和决策支持
