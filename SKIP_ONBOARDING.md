# 跳过 Onboarding 的解决方案

## 问题分析

你被重定向到 onboarding 页面是因为你的浏览器 session 中没有设置 `companyId`。虽然数据库中已经有完整的公司信息,但需要完成一次 onboarding 流程来正确设置 session。

## 解决方案

### 方案 1: 完成 Onboarding 流程 (推荐)

1. 访问 http://localhost:3000/onboarding/company
2. 表单应该已经预填充了公司信息:
   - Company Name: Carbon Development
   - Address: 123 Tech Street
   - City: San Francisco
   - State: CA
   - Postal Code: 94105
   - Country: US
   - Currency: USD
3. 点击 "Next" 或 "Save" 按钮
4. 这会正确设置你的 session,之后就可以直接访问应用了

### 方案 2: 清除 Session 并重新登录

如果 onboarding 页面出现问题:

1. 清除浏览器 cookies:
   - 打开浏览器开发者工具 (F12)
   - 切换到 Application/Storage 标签
   - 删除 localhost:3000 的所有 cookies

2. 重新访问 http://localhost:3000/login
3. 使用 dev@carbon.local 登录
4. 系统会自动检测到你只有一个公司,应该能直接进入

### 方案 3: 手动设置 Session (高级)

如果上述方案都不行,可以通过浏览器控制台手动设置:

```javascript
// 在浏览器控制台执行
document.cookie = "companyId=d8s9bh4f8gm357312pbg; path=/; max-age=31536000";
```

然后刷新页面。

## 验证

完成上述步骤后,访问 http://localhost:3000/x 应该能直接看到应用主界面,而不会再被重定向到 onboarding。

## 数据库状态

当前数据库状态:
- ✅ 公司: Carbon Development (d8s9bh4f8gm357312pbg)
- ✅ 用户关联: dev@carbon.local → Carbon Development
- ✅ 地点: Headquarters
- ✅ 所有必填字段已设置

只需要完成一次 onboarding 流程来设置 session,之后就可以直接使用了。
