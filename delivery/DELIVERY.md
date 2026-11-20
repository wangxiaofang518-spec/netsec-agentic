# NetSec Agentic · 只读版交付方案包

> **一句话**:交付给客户一套"装在客户自己环境、由客户安全工程师用**对话**驱动的**只读**安全诊断助手" —— 面向 Palo Alto Networks 平台(NGFW / Prisma Access / Strata Cloud Manager),能看清一切、诊断一切、还原任何访问路径与根因,但**碰不了一根生产配置**。

版本:v1.0-readonly ·  面向:客户安全工程师 ·  模式:只读诊断优先

---

## 一、这是什么

NetSec Agentic = **三层能力组合**,作用于客户的 PANW 平台:

```
① Agent 引擎   Claude(对话理解 + 自主编排 + 关联推理)      ← Anthropic 订阅
② 连接层 MCP   scm / panos×N / prisma-airs 等 MCP Server    ← 本方案包(只读凭据驱动)
③ 知识与护栏   排障 Playbook + 基线模板 + 只读安全模型        ← 本方案包
        ↓ 作用于
   客户的 Palo Alto Networks 平台(NGFW / Prisma Access / SCM)
```

客户工程师打开 Claude,用自然语言提问("用户 X 为什么访问不了 Y"),Agent 自动按四维方法取证、给带证据的根因结论。**所有动作只读。**

---

## 二、能力边界(核心承诺)

| 能做 ✅ | 不能做 ❌ |
|---|---|
| 读所有配置(策略/NAT/PBF/路由/对象/隧道) | 新建/修改/删除任何配置 |
| 查运行状态、会话表、日志 | commit / push 生效变更 |
| policy-match / fib-lookup 主动推演 | 推送 candidate config |
| 还原端到端访问路径、定位根因 | 生成/重置密钥 |
| 跨设备关联、跨平台取证 | 任何 destructive 操作 |

**只读由三层强制保障**(详见 [01-READONLY-SECURITY-MODEL.md](01-READONLY-SECURITY-MODEL.md)):
1. **权限层(决定性)**:客户侧只读 RBAC 角色/API Key —— 即使写工具被调,设备也拒绝
2. **工具层**:只注册 get/list/test 只读工具
3. **审计层**:全调用留痕,汇入 ELK

> 变更永远回到客户工程师手里执行。风险归零,诊断价值全保留。

---

## 三、交付物清单

| 文件 | 用途 |
|---|---|
| **DELIVERY.md**(本文) | 方案包总入口 |
| [01-READONLY-SECURITY-MODEL.md](01-READONLY-SECURITY-MODEL.md) | 只读安全模型 + 工具白/黑名单 + RBAC 配置 |
| [02-CLIENT-DEPLOY.md](02-CLIENT-DEPLOY.md) | 客户部署指南(4 步) |
| [03-TROUBLESHOOTING-PLAYBOOK.md](03-TROUBLESHOOTING-PLAYBOOK.md) | 排障剧本(3 类场景 + 故障模式矩阵) |
| [baseline-template.md](baseline-template.md) | 健康基线采集模板 |
| [setup-readonly.sh](setup-readonly.sh) / [setup-readonly.ps1](setup-readonly.ps1) | 只读版一键部署脚本 |
| ../elk/ | (可选)ELK 日志中台部署,用于集中可观测 + 审计 |

上层依赖仓库已有:`src/scm_mcp`(SCM MCP 实现)、`pyproject.toml`、`README.md`/`OPERATIONS.md`(全量版参考)。

---

## 四、快速开始(客户视角)

```
① 客户侧建只读 RBAC 凭据(NGFW Admin Role 只读 / SCM 只读服务账号)
② 装前置:Git / Python3.11+ / Node18+ / Claude Code CLI
③ git clone → 跑 delivery/setup-readonly.sh(或 .ps1),填只读 Key
④ 验证:claude mcp list 全 Connected;让 Agent 试一次变更→应被拒(证明只读生效)
⑤ 开始对话式排障(参照 Playbook)
```

---

## 五、可随时修改与更新

- 本方案包是普通 Git 仓库子目录(`delivery/`),可 `git pull` 更新、改文档、扩剧本、加新 MCP。
- **知识库(Playbook / 基线)与代码解耦** —— 沉淀新故障模式只需更新 Playbook,不动连接层。
- 版本管理:交付打 tag(`v1.0-readonly`),客户可锁版本。
- 演进路径(未来可选):只读诊断 → 受控变更(candidate+人确认)→ 自主响应。当前交付锁定在**只读**这一最稳档位。

---

## 六、交付前对齐清单
- [ ] 客户 NGFW 台数与管理 IP、是否用 Panorama
- [ ] 客户是否有 SCM / Prisma Access / AIRS
- [ ] 只读 RBAC 角色已在客户侧建好并生成 Key
- [ ] 工程师工作站可达管理面 + 有 Claude 订阅
- [ ] 是否需要 ELK 日志中台(含在 ../elk/)
- [ ] 采集一次健康基线并存档

---

