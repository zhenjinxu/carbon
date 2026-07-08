-- ============================================================================
-- ASM-TOP-001 Recovery Script
-- ============================================================================

-- Disable triggers
ALTER TABLE item DISABLE TRIGGER ALL;

-- Insert items
INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-leaf-001', 'ASM-LEAF-001', '深沟球轴承', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-002', 'ASM-LEAF-002', '传动齿轮', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-003', 'ASM-LEAF-003', '箱体铸件', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-004', 'ASM-LEAF-004', '控制芯片', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-005', 'ASM-LEAF-005', '电容阵列', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-006', 'ASM-LEAF-006', '电机定子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-007', 'ASM-LEAF-007', '电机转子', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-a', 'ASM-SUB-A', '齿轮箱组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-b', 'ASM-SUB-B', '电路板组件', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-top-001', 'ASM-TOP-001', '精密减速电机总成', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Re-enable triggers
ALTER TABLE item ENABLE TRIGGER ALL;
