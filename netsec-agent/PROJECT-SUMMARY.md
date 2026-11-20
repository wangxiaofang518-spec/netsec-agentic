> **公开版说明：** 本文档描述的是参考实验室。文中提到的实验室私有内容（加密密钥包、`memory/`、`topology/`、SSH 私钥文件、演示 PPT）不在本仓库中。部署你自己的副本请从 [README](../README.zh-CN.md) 开始。

# NetSec-Agentic — 项目总结（P0–P4）

> 常驻 Ubuntu、嵌入实时网络安全拓扑监控页的**网络安全运营智能体**。运维人员在拓扑页对话框直接提问，即可完成**连通性排障 / 配置检查 / 用户访问路径取证 / 设备巡检 / 资产与 AI 安全查询**，无需每次开 Claude 会话。
>
> 覆盖平台：Palo Alto Networks NGFW ×4 · Prisma Access (SASE) · Prisma AIRS (AI Runtime Security) · KOI (资产/影子IT) · ELK 日志中台。
>
> 部署：Ubuntu 203.0.113.10（VPC 内网 10.199.3.47），容器 `netsec-agent`，大脑走 AWS Bedrock。建成并跑通日期 **2026-07-10**。

---

## 架构总览（一图读懂）

```
运维浏览器(10.199.1.4) ──┐  同 VPC 内网
                         ▼  http://10.199.3.47:8080  （中间防火墙只放行了 8080）
              ┌──────────────────────────────┐
              │  topo 容器 (Python stdlib http)│
              │   ├─ 拓扑页静态资源 + status.json（原有监控，30s 轮询）
              │   └─ /api/* ── 流式反代 ──┐    │   ← 关键：agent 走同一个 8080，免开 8081
              └──────────────────────────│────┘
                                         ▼ netsec-agent:8081（elk_elk 内网，不过中间防火墙）
              ┌──────────────────────────────┐
              │  netsec-agent 容器 (Node)      │
              │   Claude Agent SDK · SSE 流式   │
              │   ├─ 模型分级：Sonnet 4.5（快查+排障）/ Opus 可切
              │   ├─ 8×MCP(stdio)：scm + 4×panos + elk + koi + prisma-airs
              │   ├─ 系统提示词 = 蒸馏平台知识库（拓扑/黄金路径/四维方法论/案例/踩坑）
              │   └─ 安全护栏：AGENT_MODE + PreToolUse 审计/只读钩子
              └──────────────────────────────┘
                          ▼ AWS Bedrock (us.anthropic.claude-*)
```

**设计铁律**：完全不碰既有的 `/opt/elk`、`/opt/topo` 服务；独立 compose 项目；密钥走 env_file（600, gitignore）；审计落宿主。回滚 = `docker compose -p netsec-agent down`。

---

## P0 — 目标与决策（Why / What）

**目标**：把"人在 Claude 会话里做的排障/巡检/路径取证/配置检查"产品化为常驻服务，嵌进现有实时拓扑监控页，运维自助提问。

**用户三项关键决策**（AskUserQuestion 确认）：
1. **读写策略 = 完全自主**（autonomous，可改配置，无逐次确认）—— 因为是内网、所有 MCP 对接设备均自有可控。
2. **认证 = 内网无认证**（绑 VPC 内网 IP 10.199.3.47）。
3. **交互 = 仅独立对话框**（v1 不做点击拓扑联动）。

**大脑选型**：AWS Bedrock（非直连 Anthropic）。`CLAUDE_CODE_USE_BEDROCK=1` + `AWS_BEARER_TOKEN_BEDROCK`（Bedrock API key，非 AWS access key）+ `AWS_REGION=us-east-1` + 模型 `us.anthropic.claude-*`（US 跨区推理档）。

**架构选型**：自托管 **Claude Agent SDK**（`@anthropic-ai/claude-agent-sdk`，Node）——自带 agent 循环 / 上下文管理 / MCP 客户端(stdio 拉起现有 MCP) / PreToolUse 钩子 / 会话，最省代码。独立容器而非改 topo 的 app.py（collector 是 Python、大脑是 Node，解耦最干净）。

---

## P1 — 后端骨架（Agent SDK + MCP + SSE）

**交付**：
- `agent/server.mjs`：HTTP/SSE 后端。`POST /api/chat`（SSE 事件流 session/text/thinking/tool/done/error）+ `GET /api/health`。按 sessionId 用 SDK `resume` 续多轮。
- `agent/mcp.mjs`：从 env 组装 stdio mcpServers（缺凭据的 server 跳过并记 missing，不崩）。
- `agent/system-prompt.md`：蒸馏 memory —— 设备拓扑/黄金路径/四维方法论/三大案例/证书判据等。
- `elk-mcp/index.mjs`：自写只读 ELK MCP（查 elasticsearch:9200，免 SSH key 进容器）。
- `Dockerfile` / `docker-compose.yml` / `secrets/agent.env.example`。

**关键配置**：内置工具全 disallow（`Bash/Write/Edit/Read/...`），智能体只能经 MCP 碰防火墙/云/日志，碰不到 shell/文件系统。`permissionMode:bypassPermissions`（无人值守）+ `settingSources:[]` + `strictMcpConfig:true`（与本机 .claude 隔离）+ `includePartialMessages:true`（文本增量）。

**遇到的问题 & 解法**：
| # | 问题 | 根因 | 解法 |
|---|---|---|---|
| P1-1 | 镜像构建期 `KeyError: SCM_CLIENT_ID` 崩 | Dockerfile 里 `from scm_mcp import server` 顶层实例化 ScmClient 读 env，而构建期无 env | 改为只 `import scm_mcp`（验证安装即可，不 import server） |
| P1-2 | `--dangerously-skip-permissions cannot be used with root` | `permissionMode:bypassPermissions` 传该 flag 给 SDK 捆绑的 Claude Code CLI，CLI 拒绝 root 运行 | Dockerfile `USER node`(uid1000) + `ENV HOME=/home/node` + chown /app；宿主 audit 目录 chown 1000:1000 |

---

## P2 — 安全护栏（AGENT_MODE + 审计 + 只读钩子）

**交付** `agent/guard.mjs`：两个 PreToolUse 钩子。
- **审计钩子**：每次工具调用落 `audit/<date>.jsonl`（时间/session/mode/tool/kind/op）。
- **只读钩子**：`AGENT_MODE=readonly` 时拦截写工具（`set_/add_/delete_/move_/create_/update_/commit/push_*`），`run_op_command` 仅放行 `<show>/<test>`（保留路径取证、挡写）；放行 `get_/list_/test_`。deny 用 `{hookSpecificOutput:{hookEventName,permissionDecision:"deny",permissionDecisionReason}}`。

**AGENT_MODE 秒切**：改 `secrets/agent.env` 的 `AGENT_MODE` 后 `up -d`/`restart`。`readonly`(推荐日常) ↔ `autonomous`(放行写，仍走 candidate + 审计强标记)。

⚠️ **工具层拦截非硬保证**（panos 包无只读开关）；真硬只读须 PAN-OS 侧发只读 RBAC key。生产环境请使用只读 RBAC key。

---

## P3 — 前端聊天面板 + 部署上线

**交付**：
- `topo/web/agent-chat.js`：增量 IIFE，右下角可收起对话框，SSE 流式渲染 + 工具步骤可视化。PANW 橙 #FA582D。
- `topo/web/index.html`：末尾加一行 `<script src="agent-chat.js?v=N">`（唯一改动，带缓存破坏版本号）。

**部署**：`scp` → `/opt/netsec-agent`；`docker compose -p netsec-agent up -d --build`（China↔PyPI 慢，用 `setsid` 脱离 SSH 后台跑）。

**端到端验证**：问"gpgw 上 alice 在线用户" → Bedrock 自主调 `get_globalprotect_users` → 流式返回真实数据。审计在落、ELK/topo 未受影响（ES 3 天未重启、RestartCount=0）。

**遇到的问题 & 解法（这是最曲折的一段）**：

| # | 问题（症状） | 真因（逐层排查得出） | 解法 |
|---|---|---|---|
| P3-1 | 空 SSE 流：`[chat] head sent` 后无任何消息 | `req.on("close")` 在请求 body 读完后**立即触发**，在 query 产出前就误调 `q.interrupt()` | 改用 `res.on("close")` 判客户端离开 |
| P3-2 | 后端进程崩溃、连 health 都不应答 | query 已收尾还调 `interrupt()` → SDK 在**下一个 tick 同步 throw** `ProcessTransport is not ready for writing`，**不是 promise reject**（`.catch` 抓不到）→ `uncaughtException` 崩进程 → 容器反复重启 | ①`res.on("close")` **彻底不调 interrupt**，只置 clientGone 标记让循环自然 break ②顶部 `process.on("uncaughtException"/"unhandledRejection")` 只记日志不退出=最后防线。实测复现中途断连：RestartCount=0、无崩溃栈 |
| P3-3 | 浏览器"连接中断 network error"（工具执行期） | agent 查防火墙时 SSE 有 30–60s 无字节静默，浏览器/中间层掐断长连接（但后端正常、curl 长超时能成功） | server.mjs 加 **10s SSE 心跳** `res.write(": hb\n\n")`；前端加 **90s→240s 空闲看门狗**（心跳在就不误判） |
| P3-4 | **【真正的根因】** 浏览器仍报 network error，HAR 显示 chat 请求活 68s 被服务端关、后端日志 ProcessTransport 崩栈 | 后端 8081 端口被 **10.199.1.4↔10.199.3.47 之间的中间防火墙 deny**（防火墙日志大量拒绝）；8080 短请求能过、8081 长连接不稳。**是一条防火墙策略，不是 SSE/心跳问题**（前几轮全排错了方向） | **agent 改走 8080 同源反代**（见 P3-5），绕开 8081 |
| P3-5 | 实现同源反代不缓冲 SSE | Python stdlib `SimpleHTTPRequestHandler` 反代默认会缓冲整体响应 | topo 的 `Handler` 加 `_proxy()`：`requests.request(...,stream=True,timeout=(6,300))` + `iter_content(chunk_size=1)` **逐块 `wfile.flush()`**，SSE 响应加 `X-Accel-Buffering:no`。实测：心跳每 10s 实时穿过反代、事件分布与直连一致=零缓冲 |
| P3-6 | 改了 app.py 反代但 `restart` 不生效 | collector 只挂载 `./web`，**app.py 是 COPY 进镜像的**（容器内 `/app/app.py`） | 必须 `docker cp /opt/topo/collector/app.py topo:/app/app.py` 再 restart（web/ 是热挂载则例外） |

**教训**：应用层症状（network error）**先查网络层可达性**，别一头扎进应用逻辑 —— 这正是"四维取证-策略维度"的价值。用户看防火墙 deny 日志一句话点破，比在应用层折腾几轮高效得多。

---

## P4 — 体验与性能优化

### 4.1 前端体验（agent-chat.js 版本演进，`?v=N` 破缓存）
- **v3** 空闲看门狗 + 明确中断诊断
- **v4** 同源（`location.host`，配合 8080 反代）
- **v5** 面板放大 520×720
- **v6** 左上角**拖拽调整大小**（localStorage 记忆尺寸，最小 320×360）
- **v7** **完成态状态反馈**：进行中脉冲点 + 实时秒计时器 + "正在执行 XXX"；收尾绿条"✓ 完成 · 耗时 Ns · N 步 · 模型档"；出错红条"✗"
- **v8** 看门狗 90s→240s（深排障多轮不误报）

### 4.2 模型分级路由（server.mjs）
**问题**：agent 比 Claude Code 慢很多。实测拆解一次 SG 查询 43s = Bedrock 建连 2s + 模型决策 4s + **工具往返新加坡 ~30s(物理延迟，大头)** + Opus 生成回答 ~7s。慢的三因：① 走 Bedrock（比直连慢）② Opus 最强但最慢 ③ 跨洲查设备。

**解法**：`pickModel(message)` 按问题分级 —— 命中排障词（不通/故障/报错/为什么/排查/路径/取证/why/troubleshoot…）→ `MODEL_HEAVY`；否则 → `MODEL_LIGHT`（快查/巡检）。session 事件带 modelTier，前端显示档位。

**★关键决策：heavy 与 light 都用 Sonnet 4.5，不用 Opus**：
- 实测深排障"多维证据链"：**Opus 8 工具 / 3 轮 / 180s+ 跑不完**（真因：Opus 每轮之间"思考 + 中间解说"太久，轮间隔 55–67s 远超工具往返 30s；SDK 其实已支持一轮并发多工具，模型也在并发，但轮次太多 + 每轮碎碎念拖死）。
- **换 Sonnet 4.5 后同一句：7 工具 / 53s / 完整出结论，质量反而更好**（精准命中根因 + 路由/策略/ELK 多维证据链）。
- 结论：这类"照黄金路径查已知设备找已知模式"的排障不需要 Opus 创造性推理，Sonnet 又快又听话又并发。**提速 3×+**。
- env `AGENT_MODEL_HEAVY=us.anthropic.claude-opus-4-8` 可随时切回 Opus。

**性能画像**：快查 ~14s · 深排障 ~53s · 跨洲查新加坡/香港设备 ~30s/次（物理下限，换模型省不掉）。

### 4.3 排障执行纪律（system-prompt）
加了「响应分级」+「排障执行纪律」：快查只查 1–2 个直接相关工具、点到为止；真排障才四维取证；同一轮并发发起、总工具 ≤5 分 ≤2 轮、途中禁大段解说、先查黄金路径最可疑环节。补 PAN-OS 日志语法坑（`get_system_logs` query 用 `eq`、无 `contains`）。

### 4.4 接入 KOI + Prisma AIRS（8 MCP 全接）
v1 聚焦排障四类只接 6 个，核心跑顺后补上 koi（软件/SaaS 资产、影子IT）+ prisma-airs（AI Runtime Security）。改 3 处：Dockerfile 的 `npm -g` 追加两包 + mcp.mjs 加两 server 块 + agent.env 补 5 凭据。**改依赖须重建镜像**。实测通：KOI→15,882 资产；AIRS→一轮并发 3 工具 39s 出配置概况。

### 4.5 平台知识库重构（system-prompt）
把巡检基线快照融入系统提示词，形成"最新最干净"的平台知识库：4 台 NGFW（角色/hostname/版本/巡检态）、Prisma Access（SC×2/RN×3/backbone）、IPSec 隧道对端、BGP 会话基线、黄金路径、已知隐患。供 agent 日常巡检对照找偏差、排障有基准。

---

## 关键文件清单

```
netsec-agent/
├── agent/
│   ├── server.mjs         # HTTP/SSE 后端 + 模型分级 + 心跳 + 崩溃兜底
│   ├── mcp.mjs            # 组装 8×stdio MCP
│   ├── guard.mjs          # PreToolUse：审计 + 只读钩子
│   └── system-prompt.md   # 平台知识库 + 方法论 + 案例 + 踩坑 + 纪律
├── elk-mcp/index.mjs      # 自写只读 ELK MCP
├── Dockerfile             # node22 + py3 + 3×npm MCP包 + pip -e scm-mcp
├── docker-compose.yml     # 绑 10.199.3.47:8081，接 elk_elk 外部网
├── secrets/agent.env.example   # 15 个 env 模板（真值不进 Git）
└── PROJECT-SUMMARY.md     # 本文档

topo/                      # （反代改动落在既有 topo 项目）
├── collector/app.py       # Handler 加 _proxy()：/api/* 流式反代到 8081
└── web/agent-chat.js      # 前端聊天面板（v8）
```

## 运维速查

- **秒切只读**：`agent.env` 改 `AGENT_MODE=readonly` → `docker compose -p netsec-agent up -d`。
- **切回 Opus 深排障**：`agent.env` 加 `AGENT_MODEL_HEAVY=us.anthropic.claude-opus-4-8` → restart。
- **改后端代码**（server/mcp/guard/system-prompt）：`scp` → `docker cp <file> netsec-agent:/app/agent/<file>` → `docker restart netsec-agent`（免重建）。
- **改依赖/Dockerfile**：`docker compose -p netsec-agent up -d --build`（setsid 后台跑）。
- **改前端**：`scp` 到 `/opt/topo/web/` + 改 `index.html` 的 `?v=N` 破缓存（web 热挂载，无需 restart）。
- **改 topo 的 app.py**：`docker cp` 到 `topo:/app/app.py` + restart（app.py 非挂载）。
- **健康检查**：`curl http://10.199.3.47:8080/api/health`（经反代）→ 应见 8 MCP、missing:[]。
- **回滚**：`docker compose -p netsec-agent down`（topo/ELK 不受影响）。

---

## P5 — 国际化 + Agentic 平台化改版（2026-11-20，前端 v16）

**背景**：平台转为面向境外客户使用。界面全英文；agent **回答语言跟随提问语言**（中文问→中文答，英文问→英文答）。

**前端（topo/web，热挂载，无需重启 topo）**
- `index.html`：深色科技风 + 单行顶栏；布局改为「左拓扑 + 右侧常驻 Agent Dock」(可拖宽/收起)；拓扑节点卡片、图例、详情面板全英文；DC 节点补内部网段（HK `172.172.0.0/16`、SG `172.31.0.0/16`）；详情面板加 "Ask NetSec-Agentic" 快捷提问；修复 `CURRENT_NODE` 用 let 导致详情面板实时区从不刷新的旧 bug。
- `agent-chat.js`（Copilot 页签）：Agent trace 折叠步骤；agent 查哪台设备拓扑上哪台发光；PATH 路径叠加（编号 hop + 顶部路径条）；写操作审批卡（Approve/Reject + 倒计时）；只读护栏拦截卡。
- `agent-insights.js`（新）：Insights 页签 = 每个 status.json 快照跑检测规则（设备 down/采集失败、隧道 down、BGP 未建立、CPU/内存、1h 高危威胁、SLS 日志断流、数据陈旧），一键交给 agent 排查；Activity 页签 = MCP 连接器状态 + 护栏模式 + 审计流。
- `topo-live.js`：广播 `topo:snapshot` 事件；英文化。

**后端（netsec-agent/agent，bind-mount，改后 `docker restart netsec-agent`）**
- `detectLang()`：消息含汉字→zh，否则 en；每次请求在 system prompt 末尾追加最高优先级语言指令（系统提示词本身仍是中文）。
- PATH 契约：仅"源→目的连通性/访问路径"类问题，结论末行输出 `PATH: id > id > …`，前端画图并隐藏该行（前端要求 ≥3 hop）。
- **人在回路审批**：`AGENT_MODE=autonomous` 下写操作先推 SSE `approval`，`POST /api/approve {id,decision}` 批准才执行；拒绝/超时(默认 180s，`AGENT_APPROVAL_TIMEOUT_MS`)/关页 = deny；等待期间暂停生成看门狗。`AGENT_APPROVAL=off` 可回退为旧的无确认自主。审批结果落审计（kind=approval）。
- 新端点 `GET /api/audit?limit=N`（近 3 天 MCP 调用/审批，新→旧）；health 增加 `approval` 字段；HEAVY_HINTS 补英文关键词；超时提示双语。
- `collector/app.py`：Prisma 推断 note 改英文（`docker cp` 进 topo 容器 + restart）。

**回滚**：服务器各文件旁均有 `*.bak-v13-20261120`（/opt/topo/web、/opt/topo/collector/app.py、/opt/netsec-agent/agent）；中文版前端另存本地 `topo/web-zh-backup/`。

### P5.1 — 对外命名 + SASE 枢纽强化（2026-11-20，前端 v17）
- **gpgw-azure 对外显示为 `sase-external-gw`**：仅改展示层（卡片/详情/Insights/Activity/agent trace 别名）；内部 id（`data-id="gpgw"`、MCP server `panos-gpgw-azure`、hostname）不变。后端 `NAMING_DIRECTIVE` 让 agent 回答中用新名、并把用户说的 sase-external-gw 映射到 panos-gpgw-azure 工具（已线上实测）。
- **Prisma Access 中央卡片改为 SASE 枢纽**（470×545）：大号流光 "SASE" 字标 + 渐变流动边框/光晕；ZTNA 2.0 横幅；12 项安全能力（ATP/AURL/ADNS/AWF/FVP=Frontier Virtual Patching/IPD/SWG/CASB/DLP/FWaaS/RBI/ADEM）；Palo Alto 官方平台指标（30.9B/天、8.95M 新威胁/天、99.999% SLA）。详情面板补全每项能力的官方描述。syslog 曲线/标签相应绕开。
- 回滚：服务器 `*.bak-v16-20261120`。


### P5.2 — MCP 全面更名 + 一键部署/恢复（2026-11-20，前端 v19）
- **MCP server `panos-gpgw-azure` → `panos-sase-external-gw`**（取代 P5.1 中"内部 id 不变"的做法）：netsec-agent（mcp.mjs/server.mjs/guard/system-prompt）、topo 前端与 collector、`mcp-configs/`（文件改名）、setup.sh/ps1、claude-config-template、README/OPERATIONS/delivery、memory、daily-netsec-inspection SKILL、inspection 基线 key、本机 Claude Code 注册（user + local scope）全部对齐。hostname `PAVM300-Branch-GPGW-SH` 不变；历史巡检日志保持原样。
- env 改名 `PANOS_API_KEY_SASE_EXTERNAL_GW` / `PANOS_HOST_SASE_EXTERNAL_GW`，服务器 agent.env/topo.env 已迁移（备份 `*.bak-rename-20261120`）；代码仍回落读旧名，旧 env 文件也能跑。
- **一键部署/恢复 `deploy/deploy-platform.sh`**：本仓库版本 → 服务器（先备份 `*.bak-deploy-<ts>`，上传 topo/ + netsec-agent/，topo `up -d --build` 重建镜像固化 app.py，agent `up -d` + restart，最后健康检查）。恢复任意历史版本：`git checkout <tag> && ./deploy/deploy-platform.sh`。不碰 secrets 与 ELK。


### P5.3 — 加密密钥包 + 双语恢复文档（2026-11-20）
- **`secrets/secrets.tar.gz.enc`**（AES-256-CBC + PBKDF2 60 万次）：Bedrock/全部 MCP key（agent.env、topo.env、7 个 mcp-configs）、ELK TLS 证书与私钥、Ubuntu SSH 私钥。`seal.sh`/`unseal.sh`/`collect.sh`；Windows/Linux 互解已实测。
- `setup.sh --from-env-file` / `setup.ps1 -FromEnvFile`：8 个 key 直接取自解密后的 agent.env；setup 脚本全部英文化，并修复 setup.ps1 在 Windows PowerShell 5.1 下无法解析（`?.` 运算符）的问题。
- `deploy-platform.sh`：SSH key 自动取自密钥包；`--with-secrets` 同时恢复 agent.env/topo.env。
- 文档英文为默认（README / OPERATIONS / elk / topo），中文原文移到 `*.zh-CN.md`，互相链接；修正原文"六个 MCP / 3 台 panos"等计数错误。


### P5.4 — 平台登录门禁（2026-11-20）
- `topo/collector/app.py` 加服务端会话登录：页面、`status.json`、`/api/*` 反代全部需登录（默认 admin/<TOPO_AUTH_PASS>，`TOPO_AUTH_USER/PASS` 可改，`TOPO_AUTH=off` 应急关闭）；HttpOnly 会话 cookie 12h；同一地址 5 分钟失败 10 次锁 5 分钟；HEAD 也门禁。
- 新增 `topo/web/login.html`（深色 agentic 风格，主标题 NetSec-Agentic Autonomous Security Operations Platform）与 `auth-guard.js`（会话过期自动回登录页 + 页头 Sign out 按钮）；`index.html` 仅新增一行 script。
- 本地 25 项自动化测试全过（含 SSE 流式经门禁逐块到达不受影响、TOPO_AUTH=off 行为与之前一致）；线上真实浏览器 admin/<TOPO_AUTH_PASS> 登录→平台→退出全流程通过。deploy 脚本健康检查改为先登录。
- 注意：所有客户端经上游防火墙 SNAT 后源地址都是 10.199.3.46，防爆破计数实际是全局的。
