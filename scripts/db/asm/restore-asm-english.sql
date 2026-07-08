-- ============================================================================
-- ASM-TOP-001 Simple Recovery Script (English names first)
-- ============================================================================

-- Disable all triggers temporarily
ALTER TABLE item DISABLE TRIGGER ALL;

-- Clean up old data
DELETE FROM item WHERE id LIKE 'item-asm%';

-- Insert items with English names
INSERT INTO item (id, "readableId", name, type, "itemTrackingType", "replenishmentSystem",
                  "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt")
VALUES
  ('item-asm-leaf-001', 'ASM-LEAF-001', 'Ball Bearing', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-002', 'ASM-LEAF-002', 'Gear', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-003', 'ASM-LEAF-003', 'Housing', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-004', 'ASM-LEAF-004', 'Control Chip', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-005', 'ASM-LEAF-005', 'Capacitor Array', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-006', 'ASM-LEAF-006', 'Motor Stator', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-leaf-007', 'ASM-LEAF-007', 'Motor Rotor', 'Part', 'Batch', 'Buy', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-a', 'ASM-SUB-A', 'Gearbox Assembly', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-sub-b', 'ASM-SUB-B', 'Circuit Board Assembly', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW()),
  ('item-asm-top-001', 'ASM-TOP-001', 'Precision Gear Motor Assembly', 'Part', 'Serial', 'Make', 'PCS', true, 'co-dev', 'a0000000-0000-0000-0000-000000000001', NOW());

-- Re-enable all triggers
ALTER TABLE item ENABLE TRIGGER ALL;

-- Update names to Chinese
UPDATE item SET name = '深沟球轴承' WHERE id = 'item-asm-leaf-001';
UPDATE item SET name = '传动齿轮' WHERE id = 'item-asm-leaf-002';
UPDATE item SET name = '箱体铸件' WHERE id = 'item-asm-leaf-003';
UPDATE item SET name = '控制芯片' WHERE id = 'item-asm-leaf-004';
UPDATE item SET name = '电容阵列' WHERE id = 'item-asm-leaf-005';
UPDATE item SET name = '电机定子' WHERE id = 'item-asm-leaf-006';
UPDATE item SET name = '电机转子' WHERE id = 'item-asm-leaf-007';
UPDATE item SET name = '齿轮箱组件' WHERE id = 'item-asm-sub-a';
UPDATE item SET name = '电路板组件' WHERE id = 'item-asm-sub-b';
UPDATE item SET name = '精密减速电机总成' WHERE id = 'item-asm-top-001';
