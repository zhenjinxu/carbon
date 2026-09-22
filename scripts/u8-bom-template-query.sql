/*
  U8 多级 BOM 查询模板（只读）

  用途：按一个根物料输出接近 Excel《整机BOM(多级)》模板的明细列，并额外输出
  标准件/外购件/原料的整机累计汇总。

  与最初 SQL 相比补齐：
  - Inventory / InventoryClass 名称、规格、分类、单位、重量；
  - BaseQtyN / BaseQtyD，区分“部件内数量”和“整机数量”；
  - 按已审核、有效期内 BOM 选版本；
  - 层级路径、父子序号、稳定排序和循环保护；
  - 根节点行与汇总结果集。
*/

DECLARE @RootInvCode NVARCHAR(80) = N'13110202010100';
DECLARE @AsOfDate DATE = CAST(GETDATE() AS DATE);

IF OBJECT_ID('tempdb..#BOM_Full') IS NOT NULL
  DROP TABLE #BOM_Full;

WITH PreferredBom AS (
  SELECT
    bp.ParentId,
    parentPart.InvCode AS ParentCode,
    b.BomId,
    b.Version,
    b.VersionDesc,
    b.VersionEffDate,
    b.VersionEndDate,
    b.Status,
    ROW_NUMBER() OVER (
      PARTITION BY bp.ParentId
      ORDER BY
        COALESCE(b.VersionEffDate, '19000101') DESC,
        COALESCE(b.Version, 0) DESC,
        b.BomId DESC
    ) AS rn
  FROM dbo.bom_parent bp
  JOIN dbo.bom_bom b ON b.BomId = bp.BomId
  JOIN dbo.bas_part parentPart ON parentPart.PartId = bp.ParentId
  WHERE b.Status = 3
    AND (b.VersionEffDate IS NULL OR CAST(b.VersionEffDate AS DATE) <= @AsOfDate)
    AND (b.VersionEndDate IS NULL OR CAST(b.VersionEndDate AS DATE) >= @AsOfDate)
),
RootPart AS (
  SELECT
    p.PartId,
    p.InvCode,
    i.cInvName,
    i.cInvStd,
    i.iInvWeight,
    i.cInvCCode,
    ic.cInvCName,
    i.bSelf,
    i.bPurchase,
    pb.BomId,
    pb.Version
  FROM dbo.bas_part p
  LEFT JOIN dbo.Inventory i ON i.cInvCode = p.InvCode
  LEFT JOIN dbo.InventoryClass ic ON ic.cInvCCode = i.cInvCCode
  JOIN PreferredBom pb ON pb.ParentId = p.PartId AND pb.rn = 1
  WHERE p.InvCode = @RootInvCode
),
Edges AS (
  SELECT
    b.BomId,
    bp.ParentId,
    parentPart.InvCode AS ParentCode,
    op.OpComponentId,
    op.SortSeq,
    op.OpSeq,
    op.ComponentId AS ChildPartId,
    childPart.InvCode AS ChildCode,
    childInv.cInvName AS ChildName,
    childInv.cInvStd AS ChildSpec,
    childInv.iInvWeight AS ChildWeight,
    childInv.cInvCCode AS ChildClassCode,
    childClass.cInvCName AS ChildClassName,
    childInv.bSelf AS ChildIsManufactured,
    childInv.bPurchase AS ChildIsPurchased,
    CAST(op.BaseQtyN AS DECIMAL(28, 10)) AS BaseQtyN,
    CAST(op.BaseQtyD AS DECIMAL(28, 10)) AS BaseQtyD,
    op.Remark,
    ROW_NUMBER() OVER (
      PARTITION BY b.BomId
      ORDER BY op.SortSeq, op.OpComponentId
    ) AS SiblingSeq
  FROM dbo.bom_bom b
  JOIN dbo.bom_parent bp ON bp.BomId = b.BomId
  JOIN dbo.bas_part parentPart ON parentPart.PartId = bp.ParentId
  JOIN dbo.bom_opcomponent op ON op.BomId = b.BomId
  JOIN dbo.bas_part childPart ON childPart.PartId = op.ComponentId
  LEFT JOIN dbo.Inventory childInv ON childInv.cInvCode = childPart.InvCode
  LEFT JOIN dbo.InventoryClass childClass ON childClass.cInvCCode = childInv.cInvCCode
  WHERE b.Status = 3
    AND (b.VersionEffDate IS NULL OR CAST(b.VersionEffDate AS DATE) <= @AsOfDate)
    AND (b.VersionEndDate IS NULL OR CAST(b.VersionEndDate AS DATE) >= @AsOfDate)
    AND (op.EffBegDate IS NULL OR CAST(op.EffBegDate AS DATE) <= @AsOfDate)
    AND (op.EffEndDate IS NULL OR CAST(op.EffEndDate AS DATE) >= @AsOfDate)
),
BOM_Full AS (
  SELECT
    root.InvCode AS RootCode,
    root.cInvName AS RootName,
    root.BomId AS RootBomId,
    edge.BomId,
    edge.OpComponentId,
    edge.ParentId,
    edge.ParentCode,
    edge.ChildPartId,
    edge.ChildCode,
    edge.ChildName,
    edge.ChildSpec,
    edge.ChildWeight,
    edge.ChildClassCode,
    edge.ChildClassName,
    edge.ChildIsManufactured,
    edge.ChildIsPurchased,
    CAST(edge.BaseQtyN / NULLIF(edge.BaseQtyD, 0) AS DECIMAL(28, 10)) AS DirectQty,
    CAST(edge.BaseQtyN / NULLIF(edge.BaseQtyD, 0) AS DECIMAL(28, 10)) AS CumulativeQty,
    1 AS LevelNo,
    edge.SiblingSeq,
    CAST(RIGHT('000000' + CAST(edge.SiblingSeq AS VARCHAR(6)), 6) AS VARCHAR(900)) AS PathSort,
    CAST('|' + CAST(root.PartId AS VARCHAR(30)) + '|' + CAST(edge.ChildPartId AS VARCHAR(30)) + '|' AS VARCHAR(900)) AS PartPath,
    CAST(root.InvCode + '>' + edge.ChildCode AS NVARCHAR(2000)) AS CodePath,
    edge.Remark
  FROM RootPart root
  JOIN Edges edge ON edge.BomId = root.BomId

  UNION ALL

  SELECT
    parent.RootCode,
    parent.RootName,
    parent.RootBomId,
    edge.BomId,
    edge.OpComponentId,
    edge.ParentId,
    edge.ParentCode,
    edge.ChildPartId,
    edge.ChildCode,
    edge.ChildName,
    edge.ChildSpec,
    edge.ChildWeight,
    edge.ChildClassCode,
    edge.ChildClassName,
    edge.ChildIsManufactured,
    edge.ChildIsPurchased,
    CAST(edge.BaseQtyN / NULLIF(edge.BaseQtyD, 0) AS DECIMAL(28, 10)) AS DirectQty,
    CAST(parent.CumulativeQty * edge.BaseQtyN / NULLIF(edge.BaseQtyD, 0) AS DECIMAL(28, 10)) AS CumulativeQty,
    parent.LevelNo + 1 AS LevelNo,
    edge.SiblingSeq,
    CAST(parent.PathSort + '.' + RIGHT('000000' + CAST(edge.SiblingSeq AS VARCHAR(6)), 6) AS VARCHAR(900)) AS PathSort,
    CAST(parent.PartPath + CAST(edge.ChildPartId AS VARCHAR(30)) + '|' AS VARCHAR(900)) AS PartPath,
    CAST(parent.CodePath + '>' + edge.ChildCode AS NVARCHAR(2000)) AS CodePath,
    edge.Remark
  FROM BOM_Full parent
  JOIN PreferredBom childBom ON childBom.ParentId = parent.ChildPartId AND childBom.rn = 1
  JOIN Edges edge ON edge.BomId = childBom.BomId
  WHERE parent.PartPath NOT LIKE '%|' + CAST(edge.ChildPartId AS VARCHAR(30)) + '|%'
)
SELECT *
INTO #BOM_Full
FROM BOM_Full
OPTION (MAXRECURSION 50);

SELECT
  x.[层级],
  x.[序号],
  x.[图号/ERP编码],
  x.[名称],
  x.[部件内数量],
  x.[整机数量],
  x.[材料/类别],
  x.[单重(kg)],
  x.[总重(kg)],
  x.[图纸类别],
  x.[规格/标准],
  x.[备注],
  x.[合并图页]
FROM (
  SELECT
    0 AS SortRoot,
    CAST('' AS VARCHAR(900)) AS PathSort,
    N'整机' AS [层级],
    CAST(NULL AS NVARCHAR(30)) AS [序号],
    rootPart.InvCode AS [图号/ERP编码],
    rootInv.cInvName AS [名称],
    CAST(NULL AS DECIMAL(28, 10)) AS [部件内数量],
    CAST(1 AS DECIMAL(28, 10)) AS [整机数量],
    rootClass.cInvCName AS [材料/类别],
    CAST(rootInv.iInvWeight AS DECIMAL(28, 10)) AS [单重(kg)],
    CAST(rootInv.iInvWeight AS DECIMAL(28, 10)) AS [总重(kg)],
    N'整机' AS [图纸类别],
    rootInv.cInvStd AS [规格/标准],
    N'BomId ' + CAST(root.RootBomId AS NVARCHAR(30)) AS [备注],
    CAST(NULL AS NVARCHAR(30)) AS [合并图页]
  FROM (SELECT DISTINCT RootCode, RootBomId FROM #BOM_Full) root
  JOIN dbo.bas_part rootPart ON rootPart.InvCode = root.RootCode
  LEFT JOIN dbo.Inventory rootInv ON rootInv.cInvCode = rootPart.InvCode
  LEFT JOIN dbo.InventoryClass rootClass ON rootClass.cInvCCode = rootInv.cInvCCode

  UNION ALL

  SELECT
    1 AS SortRoot,
    f.PathSort,
    CAST(f.LevelNo AS NVARCHAR(30)) AS [层级],
    CAST(f.SiblingSeq AS NVARCHAR(30)) AS [序号],
    f.ChildCode AS [图号/ERP编码],
    f.ChildName AS [名称],
    f.DirectQty AS [部件内数量],
    f.CumulativeQty AS [整机数量],
    f.ChildClassName AS [材料/类别],
    CAST(f.ChildWeight AS DECIMAL(28, 10)) AS [单重(kg)],
    CAST(f.ChildWeight * f.CumulativeQty AS DECIMAL(28, 10)) AS [总重(kg)],
    CASE
      WHEN f.ChildCode LIKE '3201%' THEN N'标准件'
      WHEN f.ChildCode LIKE '3202%' THEN N'外购件'
      WHEN f.ChildIsPurchased = 1 AND (f.ChildClassName LIKE N'%原料%' OR f.ChildCode LIKE '37%') THEN N'原料'
      WHEN f.ChildIsPurchased = 1 THEN N'外购件'
      WHEN f.ChildIsManufactured = 1 THEN N'自制件'
      ELSE ISNULL(f.ChildClassName, N'未分类')
    END AS [图纸类别],
    f.ChildSpec AS [规格/标准],
    f.Remark AS [备注],
    CAST(NULL AS NVARCHAR(30)) AS [合并图页]
  FROM #BOM_Full f
) x
ORDER BY x.SortRoot, x.PathSort;

SELECT
  f.ChildCode AS [ERP编码],
  MAX(f.ChildName) AS [名称],
  SUM(f.CumulativeQty) AS [整机数量],
  MAX(f.ChildSpec) AS [规格/标准],
  MAX(f.ChildClassName) AS [材料/等级],
  CASE
    WHEN f.ChildCode LIKE '3201%' THEN N'标准件'
    WHEN f.ChildCode LIKE '3202%' THEN N'外购件'
    WHEN MAX(CASE WHEN f.ChildIsPurchased = 1 THEN 1 ELSE 0 END) = 1
      AND (MAX(f.ChildClassName) LIKE N'%原料%' OR f.ChildCode LIKE '37%') THEN N'原料'
    WHEN MAX(CASE WHEN f.ChildIsPurchased = 1 THEN 1 ELSE 0 END) = 1 THEN N'外购件'
    ELSE N'自制件'
  END AS [类别]
FROM #BOM_Full f
WHERE f.ChildIsPurchased = 1
   OR f.ChildCode LIKE '3201%'
   OR f.ChildCode LIKE '3202%'
GROUP BY f.ChildCode
ORDER BY f.ChildCode;
