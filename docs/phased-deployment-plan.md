# Carbon 生产环境分阶段部署计划

## 概述

本计划将 Carbon 系统的生产部署分为两个阶段，逐步从厂内局域网过渡到公网访问。

**阶段一（当前）**：厂内局域网部署
- 使用服务器 IP 地址访问
- 无需域名和公网 HTTPS
- 仅厂内员工可使用
- 系统验证和稳定运行期

**阶段二（未来）**：公网部署
- 申请域名
- 配置 HTTPS（Let's Encrypt）
- 员工可远程访问
- 完整的安全加固

---

## 阶段一：厂内局域网部署

### 目标
- 在厂内服务器上部署完整系统
- 员工通过 IP 地址访问（如 `http://192.168.1.100`）
- 验证系统稳定性、数据完整性、业务流程
- 收集用户反馈，优化系统

### 网络架构

```
厂内局域网
┌─────────────────────────────────────────────────┐
│  服务器 (192.168.1.100)                          │
│  ┌───────────────────────────────────────────┐  │
│  │  Docker 容器                               │  │
│  │  ├─ Caddy (80端口)                        │  │
│  │  │   ├─ / → ERP (3000)                   │  │
│  │  │   ├─ /mes → MES (3001)                │  │
│  │  │   └─ /api → Kong (8000)               │  │
│  │  ├─ PostgreSQL (5432, 内部)               │  │
│  │  ├─ Redis (6379, 内部)                    │  │
│  │  └─ Supabase 服务 (内部)                   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         ↓
    员工电脑通过浏览器访问
    http://192.168.1.100      → ERP
    http://192.168.1.100/mes  → MES
    http://192.168.1.100/api  → Supabase API
```

### 部署步骤

#### 1. 服务器准备

**硬件要求：**
- CPU: 4 核心以上
- 内存: 16 GB 以上
- 磁盘: 100 GB SSD 以上
- 网络: 千兆网卡，固定 IP

**软件要求：**
```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 安装 Docker Compose
sudo apt-get install docker-compose-plugin

# 验证
docker --version
docker compose version
```

#### 2. 配置环境变量

```bash
# 复制阶段一配置
cp .env.stage1.example .env

# 编辑配置
nano .env
```

**关键配置项：**
```bash
# 服务器 IP（替换为实际 IP）
SERVER_IP=192.168.1.100

# 应用 URL（使用 IP）
ERP_URL=http://192.168.1.100
MES_URL=http://192.168.1.100/mes
SUPABASE_URL=http://192.168.1.100/api

# 数据库密码（必须修改）
POSTGRES_PASSWORD=your_strong_password_here

# Redis 密码（必须修改）
REDIS_PASSWORD=your_redis_password_here

# JWT 密钥（必须修改，至少 32 字符）
SUPABASE_JWT_SECRET=your_jwt_secret_at_least_32_chars

# Session 密钥（必须修改）
SESSION_SECRET=$(openssl rand -hex 32)

# 邮件（阶段一可用 Inbucket，或配置真实 SMTP）
SMTP_HOST=inbucket
SMTP_PORT=2500
```

#### 3. 启动服务

```bash
# 使用阶段一配置启动
docker compose -f docker-compose.stage1.yml --env-file .env up -d

# 查看状态
docker compose -f docker-compose.stage1.yml ps

# 查看日志
docker compose -f docker-compose.stage1.yml logs -f
```

#### 4. 初始化数据库

```bash
# 等待 PostgreSQL 就绪
sleep 10

# 运行迁移脚本
docker compose -f docker-compose.stage1.yml exec postgres \
  psql -U postgres -d postgres < scripts/db/supabase-init-local.sql

# 运行所有迁移文件
for file in packages/database/supabase/migrations/*.sql; do
  docker compose -f docker-compose.stage1.yml exec -T postgres \
    psql -U postgres -d postgres < "$file"
done
```

#### 5. 创建管理员账户

```bash
# 通过 API 创建用户
curl -X POST http://[redacted-ip]/api/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@company.com",
    "password": "Admin@123456",
    "data": { "name": "系统管理员" }
  }'
```

#### 6. 验证部署

```bash
# 测试访问
curl -I http://[redacted-ip]
curl -I http://[redacted-ip]/mes
curl -I http://[redacted-ip]/api/health

# 浏览器访问
# ERP: http://[redacted-ip]
# MES: http://[redacted-ip]/mes
```

### 阶段一验收清单

- [ ] ERP 系统可正常访问和登录
- [ ] MES 系统可正常访问和登录
- [ ] 基础数据（公司、用户、权限）配置完成
- [ ] 核心业务流程测试通过（采购、生产、销售）
- [ ] 文件上传下载功能正常
- [ ] 数据备份脚本运行正常
- [ ] 系统运行 7 天无严重故障
- [ ] 收集至少 5 个用户的反馈

### 阶段一运维要点

**每日检查：**
```bash
# 检查服务状态
docker compose -f docker-compose.stage1.yml ps

# 检查磁盘空间
df -h

# 检查日志错误
docker compose -f docker-compose.stage1.yml logs --since 24h | grep -i error

# 执行备份
./scripts/backup.sh --compress
```

**每周检查：**
```bash
# 检查备份文件
ls -lh /var/backups/carbon/

# 检查数据库大小
docker compose -f docker-compose.stage1.yml exec postgres \
  psql -U postgres -d postgres -c "SELECT pg_size_pretty(pg_database_size('postgres'))"

# 清理旧日志
docker system prune -f
```

---

## 阶段二：公网部署升级

### 目标
- 申请域名
- 配置 HTTPS
- 开放公网访问
- 员工可远程办公

### 前置条件
- 阶段一系统稳定运行 3 个月以上
- 收集并解决所有关键问题
- 完成安全审计
- 获得管理层批准

### 升级步骤

#### 1. 申请域名

**推荐域名规划：**
- `erp.company.com` — ERP 系统
- `mes.company.com` — MES 系统
- `api.company.com` — API 接口

**域名注册商：**
- 阿里云（万网）
- 腾讯云
- GoDaddy

**费用预估：**
- .com 域名：约 60-80 元/年
- .cn 域名：约 30-50 元/年

#### 2. DNS 配置

```
类型    主机记录    记录值              TTL
A       erp        服务器公网IP        600
A       mes        服务器公网IP        600
A       api        服务器公网IP        600
```

#### 3. 服务器公网配置

**防火墙规则：**
```bash
# 开放必要端口
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 22/tcp    # SSH
sudo ufw enable

# 不要开放数据库端口
# sudo ufw deny 5432
# sudo ufw deny 6379
```

**路由器端口映射（如需要）：**
```
外部端口 80  → 服务器 [redacted-ip]:80
外部端口 443 → 服务器 [redacted-ip]:443
```

#### 4. 切换到阶段二配置

```bash
# 备份当前配置
cp .env .env.stage1.backup

# 复制阶段二配置
cp .env.production.example .env

# 编辑配置（更新域名）
nano .env
```

**关键配置变更：**
```bash
# 更新为域名
ERP_URL=https://erp.company.com
MES_URL=https://mes.company.com
SUPABASE_URL=https://api.company.com

# 配置真实 SMTP（必须）
SMTP_HOST=smtp.resend.com
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_ADMIN_EMAIL=admin@company.com

# 配置 OAuth（可选）
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=your_client_id
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=your_secret
```

#### 5. 重启服务

```bash
# 停止阶段一服务
docker compose -f docker-compose.stage1.yml down

# 启动阶段二服务
docker compose -f docker-compose.prod.yml --env-file .env up -d

# 查看状态
docker compose -f docker-compose.prod.yml ps

# Caddy 会自动申请 HTTPS 证书
docker compose -f docker-compose.prod.yml logs caddy
```

#### 6. 验证 HTTPS

```bash
# 测试 HTTPS
curl -I https://erp.company.com
curl -I https://mes.company.com
curl -I https://api.company.com/health

# 检查证书
echo | openssl s_client -connect erp.company.com:443 -servername erp.company.com 2>/dev/null | openssl x509 -noout -dates
```

### 阶段二安全加固

#### 1. 配置 VPN（推荐）

**方案 A：WireGuard VPN**
```bash
# 安装 WireGuard
sudo apt install wireguard

# 配置 VPN 服务器
# 参考：https://www.wireguard.com/quickstart/
```

**方案 B：OpenVPN**
```bash
# 使用 Docker 部署 OpenVPN
docker run -v /etc/openvpn:/etc/openvpn --cap-add=NET_ADMIN -p 1194:1194/udp kylemanna/openvpn
```

#### 2. 配置 Cloudflare（可选）

**优势：**
- DDoS 防护
- CDN 加速
- WAF（Web 应用防火墙）
- 隐藏真实 IP

**配置步骤：**
1. 注册 Cloudflare 账号
2. 添加域名
3. 修改 DNS 服务器
4. 配置 SSL/TLS 模式为 "Full (strict)"
5. 配置防火墙规则

#### 3. 配置双因素认证（2FA）

```bash
# 在 .env 中启用
GOTRUE_MFA_ENABLED=true
GOTRUE_MFA_TOTP_ISSUER=Carbon
```

### 阶段二验收清单

- [ ] 域名解析正常
- [ ] HTTPS 证书自动申请成功
- [ ] ERP 和 MES 通过域名可正常访问
- [ ] 移动端访问测试通过
- [ ] 远程办公场景测试通过
- [ ] 安全审计通过
- [ ] 备份恢复演练通过
- [ ] 制定应急预案

---

## 阶段对比

| 项目 | 阶段一（厂内） | 阶段二（公网） |
|------|---------------|---------------|
| **访问方式** | IP 地址 | 域名 |
| **协议** | HTTP | HTTPS |
| **网络** | 局域网 | 公网 |
| **用户范围** | 厂内员工 | 任意位置 |
| **安全性** | 基础（内网隔离） | 高级（HTTPS + VPN + 2FA） |
| **邮件** | Inbucket 或简单 SMTP | 真实 SMTP（Resend/SendGrid） |
| **证书** | 无 | Let's Encrypt 自动 |
| **配置文件** | `docker-compose.stage1.yml` | `docker-compose.prod.yml` |
| **环境变量** | `.env.stage1.example` | `.env.production.example` |
| **复杂度** | 低 | 中 |
| **成本** | 服务器 + 人力 | 服务器 + 域名 + 人力 |

---

## 时间规划建议

### 阶段一（3-6 个月）

**第 1 个月：部署与测试**
- 第 1 周：服务器准备、环境安装
- 第 2 周：系统部署、数据初始化
- 第 3 周：内部测试、问题修复
- 第 4 周：用户培训、试运行

**第 2-3 个月：稳定运行**
- 收集用户反馈
- 修复 Bug
- 优化性能
- 完善文档

**第 4-6 个月：评估与决策**
- 系统稳定性评估
- 用户满意度调查
- 公网部署可行性分析
- 制定阶段二计划

### 阶段二（1-2 个月）

**第 1 个月：准备工作**
- 第 1 周：申请域名、配置 DNS
- 第 2 周：安全审计、加固措施
- 第 3 周：配置 VPN、测试远程访问
- 第 4 周：切换配置、验证 HTTPS

**第 2 个月：上线与监控**
- 第 1 周：试运行（仅部分用户）
- 第 2 周：全面上线
- 第 3 周：监控与优化
- 第 4 周：总结与文档

---

## 风险与应对

### 阶段一风险

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 服务器硬件故障 | 系统不可用 | 每日备份、准备备用服务器 |
| 数据丢失 | 业务中断 | 每日自动备份、定期恢复演练 |
| 性能瓶颈 | 用户体验差 | 监控资源使用、及时扩容 |
| 用户抵触 | 推广困难 | 充分培训、收集反馈、持续优化 |

### 阶段二风险

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 网络安全攻击 | 数据泄露 | 防火墙、WAF、定期安全审计 |
| DDoS 攻击 | 服务不可用 | Cloudflare 防护、限流措施 |
| 证书过期 | HTTPS 失效 | Caddy 自动续期、监控告警 |
| 远程访问慢 | 用户体验差 | CDN 加速、优化网络 |

---

## 成本预估

### 阶段一成本

| 项目 | 一次性成本 | 月度成本 | 说明 |
|------|-----------|---------|------|
| 服务器 | 8,000-15,000 元 | - | 4核16G 100G SSD |
| 网络设备 | 500-1,000 元 | - | 交换机、网线等 |
| 人力成本 | - | 2,000-3,000 元 | 运维人员（兼职） |
| **总计** | **8,500-16,000 元** | **2,000-3,000 元** | |

### 阶段二新增成本

| 项目 | 一次性成本 | 年度成本 | 说明 |
|------|-----------|---------|------|
| 域名 | - | 60-80 元 | .com 域名 |
| 公网 IP | - | 0-600 元 | 固定 IP（如需要） |
| SMTP 服务 | - | 0-1,200 元 | Resend/SendGrid |
| VPN 服务 | - | 0-2,400 元 | 如使用第三方 |
| **总计** | **-** | **60-4,280 元** | |

---

## 下一步行动

### 立即执行（阶段一）

1. **采购服务器**
   - 确定硬件配置
   - 联系供应商
   - 预计 1-2 周到货

2. **准备网络环境**
   - 申请固定 IP
   - 配置交换机
   - 测试网络连通性

3. **安装基础软件**
   - 安装 Linux 系统
   - 安装 Docker
   - 配置防火墙

4. **部署系统**
   - 按照本文档步骤部署
   - 初始化数据
   - 创建管理员账户

5. **内部测试**
   - 功能测试
   - 性能测试
   - 用户培训

### 3 个月后评估（阶段二准备）

1. **系统评估**
   - 稳定性：故障次数、停机时间
   - 性能：响应时间、并发用户数
   - 用户满意度：调查问卷

2. **安全评估**
   - 漏洞扫描
   - 渗透测试
   - 安全加固

3. **决策会议**
   - 汇报阶段一成果
   - 讨论阶段二计划
   - 确定时间表和预算

---

## 相关文档

- `docs/production-deployment.md` — 完整部署指南
- `docker-compose.stage1.yml` — 阶段一配置
- `docker-compose.prod.yml` — 阶段二配置
- `.env.stage1.example` — 阶段一环境变量
- `.env.production.example` — 阶段二环境变量
- `scripts/backup.sh` — 备份脚本
- `scripts/restore.sh` — 恢复脚本

---

## 联系与支持

如有问题，请联系：
- 技术支持：IT 部门
- 业务咨询：项目经理
- 紧急故障：运维负责人

**文档版本：** v1.0  
**最后更新：** 2026-07-08  
**维护人员：** Carbon 团队
