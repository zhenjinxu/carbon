-- Seed script for Carbon local development
-- Disable ALL triggers during seed (including constraint triggers)
SET session_replication_role = replica;

BEGIN;

-- 1. Create system user
INSERT INTO "user" (id, email, "firstName", "lastName", active)
VALUES ('system', 'system@carbonos.dev', 'System', 'User', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Create company group
INSERT INTO "companyGroup" (id, name, "createdBy")
VALUES ('cg-dev', 'Carbon Development Group', 'system')
ON CONFLICT (id) DO NOTHING;

-- 3. Create currency codes (reference table)
INSERT INTO "currencyCode" (code, name)
VALUES
  ('CNY', '人民币'),
  ('USD', 'US Dollar'),
  ('EUR', 'Euro')
ON CONFLICT (code) DO NOTHING;

-- 4. Create currencies (linked to company group)
INSERT INTO "currency" (id, code, "companyGroupId", "createdBy")
VALUES
  ('curr-cny', 'CNY', 'cg-dev', 'system'),
  ('curr-usd', 'USD', 'cg-dev', 'system'),
  ('curr-eur', 'EUR', 'cg-dev', 'system')
ON CONFLICT (id) DO NOTHING;

-- 5. Create company (baseCurrencyCode references currencyCode)
INSERT INTO "company" (id, name, "companyGroupId", "countryCode", email, "baseCurrencyCode")
VALUES ('co-dev', 'Carbon Development', 'cg-dev', 'CN', 'dev@carbon.local', 'CNY')
ON CONFLICT (id) DO NOTHING;

-- 5. Create company settings
INSERT INTO "companySettings" (id) VALUES ('co-dev')
ON CONFLICT (id) DO NOTHING;

-- 6. Create dev user
INSERT INTO "user" (id, email, "firstName", "lastName", active, admin, developer)
VALUES ('u-dev-001', 'dev@carbon.local', 'Dev', 'User', true, true, true)
ON CONFLICT (id) DO UPDATE SET active = true, admin = true, developer = true;

-- 7. Link user to company
INSERT INTO "userToCompany" ("userId", "companyId", role)
VALUES ('u-dev-001', 'co-dev', 'employee'::role)
ON CONFLICT ("userId", "companyId") DO NOTHING;

-- 8. Create identity group for the user
INSERT INTO "group" (id, name, "companyId", "isIdentityGroup")
VALUES ('g-dev-identity', 'Dev User', 'co-dev', true)
ON CONFLICT (id) DO NOTHING;

-- 9. Membership: user -> identity group
INSERT INTO "membership" ("groupId", "memberUserId")
VALUES ('g-dev-identity', 'u-dev-001')
ON CONFLICT DO NOTHING;

-- 10. Employee group
INSERT INTO "group" (id, name, "companyId", "isEmployeeTypeGroup")
VALUES ('g-employees', 'Employees', 'co-dev', true)
ON CONFLICT (id) DO NOTHING;

-- 11. Add user to employees group
INSERT INTO "membership" ("groupId", "memberUserId")
VALUES ('g-employees', 'u-dev-001')
ON CONFLICT DO NOTHING;

-- 12. Config
INSERT INTO "config" (id, "apiUrl", "anonKey")
VALUES (true, 'http://localhost:54321', '')
ON CONFLICT (id) DO NOTHING;

-- 13. Default location
INSERT INTO "location" (id, name, "addressLine1", city, "postalCode", timezone, "companyId", "createdBy")
VALUES ('loc-main', '主仓库', '', '', '', 'Asia/Shanghai', 'co-dev', 'system')
ON CONFLICT (id) DO NOTHING;

-- 14. Dimensions (use companyGroupId)
INSERT INTO "dimension" (id, name, "entityType", "companyGroupId", active, required, "createdBy")
VALUES
  ('dim-dept', '部门', 'Department', 'cg-dev', true, false, 'system'),
  ('dim-cc', '成本中心', 'CostCenter', 'cg-dev', true, false, 'system')
ON CONFLICT (id) DO NOTHING;

-- 15. Unit of measures
INSERT INTO "unitOfMeasure" (id, code, name, active, "companyId", "createdBy")
VALUES
  ('uom-pcs', 'PCS', '件', true, 'co-dev', 'system'),
  ('uom-kg', 'KG', '千克', true, 'co-dev', 'system'),
  ('uom-m', 'M', '米', true, 'co-dev', 'system'),
  ('uom-set', 'SET', '套', true, 'co-dev', 'system')
ON CONFLICT (id) DO NOTHING;

-- 16. Customer status
INSERT INTO "customerStatus" (id, name, "companyId", "createdBy")
VALUES
  ('cs-active', '活跃', 'co-dev', 'system'),
  ('cs-inactive', '非活跃', 'co-dev', 'system'),
  ('cs-lead', '潜在客户', 'co-dev', 'system')
ON CONFLICT (id) DO NOTHING;

-- 17. Payment terms
INSERT INTO "paymentTerm" (id, name, "daysDue", "daysDiscount", "discountPercentage", active, "companyId", "createdBy")
VALUES
  ('pt-net30', 'Net 30', 30, 0, 0, true, 'co-dev', 'system'),
  ('pt-net60', 'Net 60', 60, 0, 0, true, 'co-dev', 'system'),
  ('pt-cod', '货到付款', 0, 0, 0, true, 'co-dev', 'system')
ON CONFLICT (id) DO NOTHING;

-- 18. Update company group owner
UPDATE "companyGroup" SET "ownerId" = 'u-dev-001' WHERE id = 'cg-dev';

COMMIT;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

SELECT '✓ Seed complete!' AS status;
SELECT '  User: dev@carbon.local' AS info;
SELECT '  Company: Carbon Development (co-dev)' AS info;
