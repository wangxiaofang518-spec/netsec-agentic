# NetSec Agentic 只读版 — 客户部署指南

> 面向:客户的安全工程师
> 目标:在客户自己的环境里,用对话式 AI Agent 对 Palo Alto Networks 平台做**只读诊断与排障**。
> 前提:客户平台为 Palo Alto Networks(NGFW / Prisma Access / Strata Cloud Manager),可选 ELK 日志中台。

---

## 部署总览(4 步,约 30 分钟)

```
① 客户侧建只读凭据  →  ② 装前置(Git/Python/Node/Claude)  →  ③ 跑部署脚本(填只读Key)  →  ④ 验证只读生效
```

---

## 第一步:在 PANW 平台侧建"只读凭据"(最关键,先做)

**这是"只读"的真正保障,必须先配。** 详见 [01-READONLY-SECURITY-MODEL.md](01-READONLY-SECURITY-MODEL.md) 第四节。

| 平台 | 操作 | 产出 |
|---|---|---|
| **NGFW (PAN-OS)** | Device → Admin Roles 建只读角色(所有 Read Only、无 Commit)→ 建管理员用此角色 → 生成 API Key | `PANOS_API_KEY`(只读) |
| **Strata Cloud Manager** | IAM → 服务账号分配只读角色(View/自定义只读,无 Push/Deploy) | `SCM_CLIENT_ID/SECRET/TSG_ID`(只读) |
| **Prisma AIRS**(可选) | 只读/扫描 scope 的 API Key | `PANW_AI_SEC_API_KEY` |

> ⚠️ 不要用超级管理员或读写账号的 Key。方案包的"只读"承诺依赖这一步。

---

## 第二步:安装前置

客户机器(工程师工作站或跳板机)装好:
1. **Git**
2. **Python 3.11+**(scm-mcp 运行时)
3. **Node.js 18+**(panos/koi/airs MCP 运行时)
4. **Claude Code CLI**(对话入口,从 claude.ai/code 装,需有效订阅)

---

## 第三步:克隆 + 只读部署

```bash
git clone <你交付给客户的仓库地址> netsec-agentic
cd netsec-agentic

# 只读部署脚本(见 setup-readonly.sh / setup-readonly.ps1)
# 只需填客户自己的只读 Key,脚本只注册 get/list/test 只读工具
```

### Linux / macOS
```bash
bash delivery/setup-readonly.sh \
  --scm-client-id   "客户SCM服务账号ID" \
  --scm-secret      "客户SCM只读Secret" \
  --scm-tsg-id      "客户TSG_ID" \
  --panos-host-1    "客户NGFW-1 IP" --panos-key-1 "只读APIKey1" \
  --panos-host-2    "客户NGFW-2 IP" --panos-key-2 "只读APIKey2" \
  --airs-key        "客户AIRS Key(可选)"
```

### Windows(PowerShell)
```powershell
.\delivery\setup-readonly.ps1 `
  -ScmClientId "..." -ScmSecret "..." -ScmTsgId "..." `
  -PanosHost1 "..." -PanosKey1 "..." `
  -PanosHost2 "..." -PanosKey2 "..."
```

> 说明:只读脚本与主 setup 的区别 —— 它注册相同的 MCP Server,但**依赖第一步的只读 RBAC 凭据**来保证只读;并在客户上手文档里明确"不要注册/使用写工具"。真正的强制来自凭据权限,不是脚本。

> **多台 NGFW**:按客户实际设备数量重复 `--panos-host-N/--panos-key-N`。客户设备命名由客户定(不必沿用我们的 sase-external-gw 等名字)。

---

## 第四步:验证(两件事都要过)

### 4.1 连接验证
```bash
claude mcp list
# 期望:scm / panos-xxx / (airs) 全部 ✔ Connected
```

### 4.2 只读验证(证明 RBAC 生效 —— 关键)
在 Claude 里让 Agent 尝试一次**只读查询**和一次**变更**:
```
你: 查一下 NGFW-1 的安全策略      → 应成功返回(只读工作)
你: 试着在 NGFW-1 新建一条测试地址对象  → 应被设备以"权限不足/只读"拒绝
```
若变更被拒 = 只读 RBAC 真正生效 ✅。**这是唯一可信的只读证明。**

---

## 上手即用:让 Agent 干活

工程师直接用自然语言,Agent 会按 [03-TROUBLESHOOTING-PLAYBOOK.md](03-TROUBLESHOOTING-PLAYBOOK.md) 的方法四维取证:
```
"用户 10.x.x.x 访问不了某服务,帮我查原因"
"还原 A 到 B 的完整访问路径,给证据"
"这条 NGFW 策略为什么没生效"
"最近有哪些威胁日志命中了 critical"
```

---

## 可随时修改与更新

- 方案包是普通 Git 仓库。客户/你都可:`git pull` 拿更新、改 delivery/ 下文档、加新 MCP、扩 Playbook。
- 版本管理:每次交付打 tag(如 `v1.0-readonly`),客户环境 `git checkout <tag>` 可锁定版本。
- 知识库(Playbook/基线模板)独立于代码,更新知识不影响连接层。

---

## 客户环境适配清单(交付前对齐)
- [ ] 客户 NGFW 数量与管理 IP
- [ ] 客户是否用 Panorama 集中管理(影响只读工具集)
- [ ] 客户是否有 SCM / Prisma Access
- [ ] 客户是否需要 ELK 日志中台(方案含部署,见 elk/)
- [ ] 只读 RBAC 角色已在客户侧建好
- [ ] 工程师工作站可达设备管理面 + 有 Claude 订阅
