# 跳过 Onboarding 直接使用 Carbon ERP

## 问题
用户登录后被重定向到 onboarding 页面,因为 session 中没有正确设置 companyId。

## 解决方案

### 方法 1: 清除浏览器数据并重新登录 (推荐)

1. **清除浏览器 Cookie 和 Local Storage**:
   - 打开浏览器开发者工具 (F12)
   - 切换到 "Application" 标签
   - 左侧选择 "Storage" → 点击 "Clear site data"
   - 或者手动删除 localhost:3000 的所有 cookies

2. **重新登录**:
   - 访问 http://localhost:3000/login
   - 输入邮箱: `dev@carbon.local`
   - 点击登录 (不需要密码,使用 magic link)
   - 系统应该自动识别你只有一个公司,直接进入主界面

### 方法 2: 手动设置 Company Cookie

如果方法 1 不起作用,可以手动设置 cookie:

1. 打开浏览器开发者工具 (F12)
2. 切换到 "Application" → "Cookies" → "http://localhost:3000"
3. 添加以下 cookies:

```
名称: carbon
值: (从登录后的响应中获取完整的 session cookie)

名称: companyId  
值: d8s9bh4f8gm357312pbg
```

### 方法 3: 使用 API 直接测试

如果还是遇到问题,可以直接通过 API 测试系统功能:

```bash
# 获取 service role key
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTg1MjExMywiZXhwIjoyMDk3MjEyMTEzfQ.AJblY9T0wlpIjvD_oZ_1qJXW0NKELZTVCs5V3KQs26I"

# 测试查询物料
curl "http://localhost:54321/rest/v1/item?select=*&limit=10" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"

# 测试查询工单
curl "http://localhost:54321/rest/v1/job?select=*&limit=10" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"
```

## 验证公司数据

公司数据已完整设置:
- **Company ID**: d8s9bh4f8gm357312pbg
- **Name**: Carbon Development
- **Address**: 123 Tech Street, San Francisco, CA 94105, US
- **Currency**: USD
- **Location**: Headquarters

## 如果仍然遇到问题

检查 ERP 服务器的控制台日志,查看具体的错误信息:

```bash
# 查看 ERP 开发服务器日志
# 在运行 `pnpm dev` 的终端窗口中查看输出
```

## 数据库验证

```sql
-- 验证用户公司关联
SELECT * FROM companies WHERE "userId" = 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc';

-- 验证公司信息
SELECT id, name, "addressLine1", city, "baseCurrencyCode" FROM company;

-- 验证用户权限
SELECT * FROM "userPermission" WHERE id = 'ec76ca4d-f4b5-4458-9924-bdbc8f7f6ebc';
```
