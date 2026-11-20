> **公开版说明：** 本文档描述的是参考实验室。文中提到的实验室私有内容（加密密钥包、`memory/`、`topology/`、SSH 私钥文件、演示 PPT）不在本仓库中。部署你自己的副本请从 [README](README.zh-CN.md) 开始。

# 环境运营总纲 (OPERATIONS.zh-CN.md)

> English: [OPERATIONS.md](OPERATIONS.md)

> **这份文档的目的**：任何时候在任何一台新电脑上，靠本仓库即可完整重建并运营整个 Palo Alto Networks 安全环境 ——
> SASE 云管理、4 台 NGFW、AI 安全、软件供应链安全，以及集中日志（ELK）。
>
> **跨电脑的唯一载体是本 GitHub 仓库**：`https://github.com/<your-org>/netsec-agentic`
> 本机 `~/.claude/` 下的记忆不会跟随换机，重要信息都固化在这里。

最后更新：2026/07/06

---

## 0. 30 秒速查：换了新电脑怎么办

```bash
# 1. 装好前置：Git / Python3.11+ / Node18+ / Claude Code CLI
# 2. 克隆仓库
git clone https://github.com/<your-org>/netsec-agentic.git scm-mcp && cd scm-mcp
# 3. 解密密钥包（提示输入口令，口令向仓库负责人索取），再一键恢复 7 个 MCP
bash secrets/unseal.sh
bash setup.sh --from-env-file secrets-plain/server/opt/netsec-agent/secrets/agent.env
#    Windows PowerShell: .\setup.ps1 -FromEnvFile secrets-plain\server\opt\netsec-agent\secrets\agent.env
# 4. 验证
claude mcp list      # 7 个全部 ✔ Connected
# 5. 恢复记忆（见下方「0.5 记忆恢复」）—— 让 Claude 找回全部上下文/踩坑/故障库
```

ELK 服务器（阿里云那台）本身不用重装 —— 它独立运行，只要能 SSH 上去就能查日志。真要重建 ELK 见 [elk/README.zh-CN.md](elk/README.zh-CN.md)（证书私钥在加密密钥包里）。NetSec-Agentic 平台的部署/恢复：`./deploy/deploy-platform.sh`（见 [README.zh-CN.md](README.zh-CN.md)）。

---

## 0.5 记忆恢复（memory/ → Claude 本地记忆目录）

仓库 `memory/` 里备份了 Claude 的**全部持久记忆**（14 条：换机步骤、NGFW 命名、ELK、PPT、故障复盘库、排障方法论、巡检基线、每日巡检机制等）。这些是 Claude 找回"我是谁、这套环境长什么样、踩过哪些坑、三大故障怎么复盘"的核心——**换机后必须手动拷回本地记忆目录**，Git clone 不会自动放到那里。

**恢复步骤**（克隆完仓库后执行一次）：

```bash
# 本地记忆目录（路径由项目工作目录决定，下面是本项目在 Windows 上的实际路径）
#   Windows: C:\Users\<你>\.claude\projects\<项目slug>\memory\
#   macOS/Linux: ~/.claude/projects/<项目slug>/memory/
# <项目slug> = 工作目录路径把 / \ : 都换成 - （如 <project-slug>）

# Windows PowerShell 示例：
$dst = "$env:USERPROFILE\.claude\projects\<project-slug>\memory"
New-Item -ItemType Directory -Force -Path $dst
Copy-Item -Force scm-mcp\memory\*.md $dst\

# macOS / Linux 示例：
DST=~/.claude/projects/<project-slug>/memory
mkdir -p "$DST" && cp -f scm-mcp/memory/*.md "$DST"/
```

拷完后 `MEMORY.md`（索引）+ 13 条正文就位，新会话启动即自动加载。**注意**：`<项目slug>` 取决于你在新机上把工作目录放哪；若换了目录名，slug 会不同，按上面规则换算即可。日常记忆有更新后，重新 `cp memory/*.md scm-mcp/memory/` 并 commit 即完成再备份（见 §8 铁律：改动后必更新+备份）。

> `inspection/`（每日巡检基线快照）与 `scheduled-tasks/`（每日巡检定时任务定义）同理已备份在仓库；巡检机制说明见 `memory/project_daily_inspection.md`，定时任务需在新机上按该文件重建。

---

## 1. 全局架构总览

```
                        ┌─────────────────────────────────────┐
                        │  Claude Code (本机，任意电脑)          │
                        │  7 个 MCP Server 桥接 REST API         │
                        └───────────────┬─────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
        │               │               │               │                │
   ┌────▼────┐    ┌─────▼────┐   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼───────┐
   │  scm    │    │  koi     │   │ prisma-airs │  │ 4× panos-*  │  │  (SSH)       │
   │ SASE云管 │    │ 供应链   │   │  AI 安全    │  │  NGFW 管理   │  │ Ubuntu ELK   │
   └─────────┘    └──────────┘   └─────────────┘  └──────┬──────┘  └──────▲───────┘
                                                         │                │ syslog
                                        ┌────────────────┼────────────────┘
                                        │                │
              ┌───────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐
              │ sase-external-gw│  │ scvm-aws-hk  │  │ scvm-aws-sg  │  │ aivm-alibaba  │
              │Azure GP网关│  │AWS-HK PrismaSC│  │AWS-SG PrismaSC│  │阿里云 保护ELK  │
              │52.131.236.│  │203.0.113.22│  │203.0.113.23│  │203.0.113.24 │
              │   112     │  │  SC 6.6.6.6  │  │  SC 5.5.5.5  │  │               │
              └───────────┘  └──────────────┘  └──────────────┘  └───────────────┘
                    ↓ 全部 syslog 汇聚 →  Ubuntu ELK (203.0.113.10)
```

---

## 2. 七个 MCP Server 详解

| MCP | 产品 | 工具数 | 传输/运行时 | 干什么 |
|---|---|---|---|---|
| `scm` | Strata Cloud Manager | 73 | Python stdio（本仓库 `src/scm_mcp`） | SASE 云端策略、地址/服务对象、安全规则、NAT、远程网络、服务连接、IAM、配置推送 |
| `koi` | KOI 软件供应链安全 | 12 | Node（npm `koi-mcp-server`） | 终端插件/包清单、风险发现、告警、审计日志、修复建议、策略 |
| `prisma-airs` | Prisma AIRS AI 安全 | 44 | Node（npm `prisma-airs-ops-mcp-server`） | AI 运行时提示扫描、红队测试、模型安全扫描、DLP、自定义主题 |
| `panos-sase-external-gw` | PAN-OS NGFW | 116 | Node（npm `@iflow-mcp/apius-tech-panos-mcp`） | Azure GP 网关：策略/对象/NAT/路由/BGP/日志/GP 用户 |
| `panos-scvm-aws-hk` | PAN-OS NGFW | 116 | 同上（同一包，`PANOS_HOST` 区分） | AWS 香港 Prisma SC(6.6.6.6)：HK 数据中心接入点 |
| `panos-scvm-aws-sg` | PAN-OS NGFW | 116 | 同上（同一包，`PANOS_HOST` 区分） | AWS 新加坡 Prisma SC(5.5.5.5)：SG 数据中心接入点 |
| `panos-aivm-alibaba` | PAN-OS NGFW | 116 | 同上 | 阿里云安全 VM：保护 ELK 服务器 |

> **4 台 panos 用的是同一个 npm 包**，靠环境变量 `PANOS_HOST` + `PANOS_API_KEY` 区分目标设备。工具名前缀不同（`mcp__panos-sase-external-gw__*` 等）。

### scm 工具能力速览（73 个）
- **对象**：address / address-group / service / service-group / application / application-group / tag / EDL
- **安全**：security rule（增删改查+移动位置）、profile（anti-spyware / vulnerability / URL / DoS）
- **部署**：remote-network / service-connection / bandwidth / site / BGP routing
- **运营**：candidate config 推送（`push_candidate_config` ⚠️改生产）、config version、job
- **IAM**：service-account（响应含明文 secret，注意）、access-policy、custom-role

### 4 台 panos 工具能力速览（各 116 个）
- **读**（`get_*`）：system info / interfaces / zones / routing / security & NAT rules / address & service objects / sessions / HA / IPSec / GlobalProtect users / traffic & threat & system logs …
- **写**（`add_* / delete_* / set_* / move_*`）：security/NAT/PBF/QoS/decryption rule、address/service 对象、static route、tag
- **改生产**：`commit`（⚠️改运行配置）、Panorama `panorama_commit` + `panorama_push_to_devices`
- **模式**：所有写操作先进 candidate config，`commit` 才生效 —— **commit 前必须与用户确认**

---

## 3. 网络拓扑与角色

| 设备 hostname (ELK `device_hostname`) | MCP 实例 | 管理 IP | 云 | 角色 |
|---|---|---|---|---|
| `PAVM300-Branch-GPGW-SH` | `panos-sase-external-gw` | 203.0.113.21 | Azure | GP VPN 网关，中国大陆用户接入，IPSec → Prisma Access Remote Network |
| `PAVM100-PrismaSC-HK` | `panos-scvm-aws-hk` | 203.0.113.22 | AWS 香港 | Prisma Access SC(6.6.6.6)，HK 数据中心 `172.172.0.0/16` 接入点 |
| `PAVM100-PrismaSC-SG` | `panos-scvm-aws-sg` | 203.0.113.23 | AWS 新加坡 | Prisma Access SC(5.5.5.5)，SG 数据中心 `10.188.241.0/24` 接入点 |
| `AI-SECVM-Branch-Alibaba-CN` | `panos-aivm-alibaba` | 203.0.113.24 | 阿里云 KVM | 保护阿里云 Ubuntu ELK，IPSec → Prisma Access Remote Network |

- **数据中心网段**：HK `172.172.0.0/16`（经 panos-scvm-aws-hk），SG `10.188.241.0/24`（经 panos-scvm-aws-sg）；两条 SC 同挂一个 Prisma Access
- **ELK 中 `device_hostname` 与 MCP 名是两套命名**，以上表为对应关系

### 对话约定（说这些词 → 操作哪台）
- "GPGW / GP 网关 / Azure 分支" → `panos-sase-external-gw`
- "SC / HK / 香港数据中心" → `panos-scvm-aws-hk`
- "SG / 新加坡 / 新加坡数据中心" → `panos-scvm-aws-sg`
- "阿里云 / Alibaba / AIVM / ELK 那台" → `panos-aivm-alibaba`
- ⚠️ 旧命名 `panos-gpgw` / `panos-dcfw` / `panos-border` 已废弃

---

## 4. ELK 日志服务器

集中收集 4 台 NGFW + Prisma Access 的 syslog，用于安全分析、网络/性能/访问路径分析。

| 项 | 值 |
|---|---|
| 公网 IP / SSH | `203.0.113.10` : `3333`（root） |
| SSH 密钥 | `<本机>/keys/ubuntu_login_fixed.key`（**私钥不在仓库**，自行保管） |
| 部署 | `/opt/elk/` — Docker Compose：ES + Logstash + Kibana 8.14.3 |
| Kibana | `http://203.0.113.10:5601` |
| 接收端口 | 514/udp（明文）、6514/tcp（TLS 自签 CA） |

### 日志如何流动
```
NGFW/Prisma syslog → Logstash(514/6514) → panos.conf 解析(grok+csv+按log_type分流)
                                          → ES 每日索引 panos-{type}-YYYY.MM.dd → Kibana
```

### 索引类型与保留（ILM delete-only，新日志零丢失）
| 索引 | 保留 | 索引 | 保留 |
|---|---|---|---|
| panos-traffic | 30 天 | panos-globalprotect | 30 天 |
| panos-threat | 90 天 | panos-config | 180 天 |
| panos-system | 14 天 | panos-hipmatch / other | 14 天 |

### 已落地的两处 pipeline 优化（2026/07/06）
1. SYSTEM 日志 drop `event_id=general`（占 94% 噪音）→ system 量降 ~88%
2. HIPMATCH 输出块修复（此前错落 panos-other）

### Kibana Dashboards
| Dashboard | ID |
|---|---|
| PAN-OS Traffic Analysis | `0f1dd460-d816-4e2b-8e65-80dce721577f` |
| PAN-OS Threat Analysis | `996b0f0a-403b-45e7-8dfe-234ab7c6bec9` |
| PAN-OS System & GP Users | `9de4c0c9-696b-4b9d-b858-5c6bacd0d8d7` |

> ELK 完整重建步骤、证书生成、模板/ILM 恢复 → [elk/README.md](elk/README.md)。配置文件已备份在 `elk/`。

### 常用 ELK 查询（SSH 到服务器后）
```bash
# 各索引文档数与体积
curl -s "http://localhost:9200/_cat/indices/panos-*?v&s=store.size:desc"
# 今日流量按小时
curl -s "http://localhost:9200/panos-traffic-$(date +%Y.%m.%d)/_search" -H 'Content-Type: application/json' \
  -d '{"size":0,"aggs":{"h":{"date_histogram":{"field":"@timestamp","calendar_interval":"hour","time_zone":"Asia/Shanghai"}}}}'
# ILM 状态（确认每个索引 managed + 预计删除时间）
curl -s "http://localhost:9200/panos-*/_ilm/explain"
# Logstash 健康
docker logs logstash --since 5m | grep -iE "Pipeline started|error" | grep -vi ssl
```

### ELK 已知遗留问题
- **SLS → ELK TLS 转发未通**：SLS Test Connection 报 TCP timeout。已确认 SYN 到达 Ubuntu 且回 SYN-ACK，疑似边界防火墙回程未正确 un-NAT。排查：SLS 测试时在 Ubuntu `tcpdump -i eth0 tcp port 6514 -nn`，同时查防火墙会话表 + Ubuntu→SLS 回程 allow 规则。
- **内存偏紧**：7.1G 机器 ELK 占 ~4.7G（ES heap 2g），加数据源前评估。

---

## 4.5 动态拓扑监控（topo · 2026-07-08）

把架构拓扑做成**实时监控图**：4 台 NGFW（含 HK/SG 两条 SC）状态灯、IPSec 隧道 up/down、BGP 邻居、CPU/内存/会话/在线 GP/流量速率/威胁数，30 秒自刷新。**仅内网访问**。

- **源码**：仓库 `topo/`（静态原图在 `topology/network-security-topology.html`，用 PANW 官方产品图标）。
- **部署**：Ubuntu `/opt/topo`，单 Docker 容器 `topo`（python:3.12-slim，compose 项目名 `topo`）。
- **访问**：内网同段浏览器开 `http://10.199.3.47:8080`（绑 VPC 内网 IP，不碰公网安全组）。
  - 仅 SSH 隧道：compose 端口改 `127.0.0.1:8080:8080` 后 `ssh -L 8080:127.0.0.1:8080`。
- **数据源**：后台线程每 30s 轮询 **4 台 NGFW**（gpgw / scvm-aws-hk / scvm-aws-sg / aivm）XML API（只读 show）+ 查 `elasticsearch:9200` 聚合 → 原子写 `web/status.json`；前端 fetch 渲染。接现有 `elk_elk` 网络，**不改 /opt/elk**。新加坡 SC 接入后前端 `aws-sg` 已从幽灵节点升级为受管实时节点。
- **密钥**：`/opt/topo/secrets/topo.env`（600，gitignore，仓库只留 `.example`）。建议换只读 RBAC key。
- **起停**：`cd /opt/topo && docker compose -p topo up -d --build` / `down`（干净回滚，不影响 ELK）。
- **调试**：`docker compose -p topo run --rm topo python -u app.py --probe`（打印各 PAN-OS 命令原始 XML）。
- **能动/静态**：NGFW 真动；Prisma 由隧道+BGP+SLS 推断；AIRS/KOI/aws-sg/dc-hk 静态（服务器无云凭据）。
- 详见 `topo/README.md`。

---

## 5. 项目实施阶段回顾（做过什么，怎么做的）

| 阶段 | 内容 | 关键产物 |
|---|---|---|
| 1. scm-mcp 开发 | 按 SCM OpenAPI 规范把 REST 桥接为 73 个 MCP tool | `src/scm_mcp/`，见 CLAUDE.md/DESIGN.md/WORKFLOW.md |
| 2. 接入 koi + prisma-airs | npm 安装 + claude mcp add | setup 脚本 Step 2/3 |
| 3. 接入 3 台 PAN-OS NGFW | 同一 npm 包按 host 注册 3 实例 | setup 脚本 Step 4/5 |
| 4. 跨平台恢复脚本 | Windows/macOS/Linux 一键恢复 + GitHub 备份 | setup.ps1 / setup.sh |
| 5. Ubuntu ELK 部署 | Docker Compose 装 ES+Logstash+Kibana，PAN-OS syslog 解析管道 | `elk/` |
| 6. TLS 加固 | 自签 CA + 服务器证书，Logstash 6514 TCP TLS | `elk/certs-config/` |
| 7. Dashboard | 3 个 Kibana 可视化面板 | `elk/scripts/create_dashboards.sh` |
| 8. 日志治理 | SYSTEM 噪音过滤 + HIPMATCH 路由修复 + ILM 分级保留 | `elk/logstash/pipeline/panos.conf`、`elk/es-templates/` |
| 9. 动态拓扑监控 | 轮询 4 台 NGFW + 查 ELK 的实时监控图，内网发布（10.199.3.47:8080） | `topo/`、`topology/`（见 §4.5） |

---

## 6. 常用运营场景速查

> 下列为「说什么 → Claude 用哪个 MCP 做什么」。所有**改配置操作先进 candidate，commit/push 前会与你确认**。

### 查询类（只读，随时用）
| 你要做的 | 怎么做 |
|---|---|
| 看某台 NGFW 的安全策略 | `panos-*` 的 `get_security_rules` |
| 看接口/路由/会话状态 | `get_interfaces` / `get_routing_table` / `get_active_sessions` |
| 看谁连了 GP VPN | `panos-sase-external-gw` 的 `get_globalprotect_users` |
| 看威胁/流量日志 | NGFW `get_threat_logs` / `get_traffic_logs`，或直接查 ELK（数据更全、可跨设备） |
| SASE 云端有哪些策略/对象 | `scm` 的 `list_security_rules` / `list_addresses` / `list_services` |
| 终端软件供应链风险 | `koi` 的 `koi_list_findings` / `koi_list_inventory` / `koi_list_alerts` |
| 扫一段 AI 提示是否有风险 | `prisma-airs` 的 `airs_runtime_scan` |

### 配置类（改生产，需确认）
| 你要做的 | 怎么做 |
|---|---|
| 加一条防火墙放行/拦截规则 | `panos-*` `add_security_rule` → 确认 → `commit` |
| 加地址/服务对象 | `add_address_object` / `add_service_object` → `commit` |
| SASE 云端下发策略 | `scm` `create_security_rule` → `push_candidate_config`（⚠️影响生产） |
| 加静态路由/NAT | `add_static_route` / `add_nat_rule` → `commit` |

### 排障类
| 现象 | 切入点 |
|---|---|
| 某 IP 通不通 | NGFW `get_traffic_logs` 过滤该 IP + `get_security_rules` 看命中规则；ELK 查 `panos-traffic-*` |
| VPN 连不上 | `get_globalprotect_users` + ELK `panos-globalprotect-*` + `panos-system-*` 的 ike-* 事件 |
| 日志没进 ELK | SSH 查 `docker logs logstash`、`_cat/indices`；确认 NGFW syslog profile 指向 203.0.113.10 |

---

## 7. 密钥与凭据清单（值只以加密形式存于 `secrets/secrets.tar.gz.enc`，见 [secrets/README.md](secrets/README.md)）

| 凭据 | 是否会变 | 获取/说明 |
|---|---|---|
| `SCM_CLIENT_SECRET` | 固定 | SASE 服务账号密钥（= PANW_MGMT_CLIENT_SECRET） |
| `KOI_API_KEY` | 约1年 | KOI 控制台 Settings → API Access 重新生成 |
| `PANW_AI_SEC_API_KEY` | 固定 | Prisma AIRS 扫描密钥 |
| `PANW_MGMT_CLIENT_SECRET` | 固定 | 与 SCM_CLIENT_SECRET 相同 |
| `PANOS_API_KEY_SASE_EXTERNAL_GW` | 固定 | 203.0.113.21 的 API Key |
| `PANOS_API_KEY_SCVM_AWS_HK` | 固定 | 203.0.113.22 (AWS 香港 SC) 的 API Key |
| `PANOS_API_KEY_SCVM_AWS_SG` | 固定 | 203.0.113.23 (AWS 新加坡 SC) 的 API Key |
| `PANOS_API_KEY_AIVM_ALIBABA` | 固定 | 203.0.113.24 的 API Key |
| Ubuntu SSH 私钥 | 固定 | `server-ssh-key.pem`（root@203.0.113.10:3333），在加密密钥包 `ssh/` 下 |
| AWS Bedrock 凭据 | 视 token 而定 | `AWS_BEARER_TOKEN_BEDROCK` 等，在加密密钥包 `agent.env` 中 |
| ELK TLS 证书/私钥 | 固定 | CA / server / OCSP，在加密密钥包 `server/opt/elk/certs/` 下 |

> **固定的非机密配置**（Client ID / TSG ID / Host）已内置于 setup 脚本，见 README「固定配置值」。
> **PAN-OS API Key 若丢失**：SSH/Web 登录设备，`https://<IP>/api/?type=keygen&user=...&password=...` 重新生成。

---

## 8. 铁律（操作红线）

1. **改生产必确认**：所有 `commit` / `push_candidate_config` / `panorama_push_to_devices` 前，向用户说明影响范围并等确认。
2. **candidate 优先**：NGFW 写操作先进 candidate config，绝不直接改运行配置。
3. **明文密钥不进 Git**：`*.key` / `*.pem` / SSH 私钥 / env 文件永不以明文提交，只以加密包 `secrets/secrets.tar.gz.enc` 入库；口令带外传递。
4. **secret 不落日志**：`create_service_account` / `reset_service_account` 响应含明文 secret，不写任何日志文件。
5. **ELK 备份不放 pipeline 目录**：Logstash 加载整个 pipeline 目录，备份文件放里面会导致端口冲突崩溃（详见 elk/README.md）。
6. **SCM schema 唯一来源**：`C:\pan.dev\openapi-specs\scm\`，不手抄、不臆造。

---

## 9. 文档地图

| 文件 | 看这个当你要… |
|---|---|
| **OPERATIONS.zh-CN.md**（本文）· [English](OPERATIONS.md) | 了解全局 / 换机恢复 / 日常运营 |
| [README.zh-CN.md](README.zh-CN.md) | 一键恢复命令、密钥清单、平台一键部署 |
| [secrets/README.md](secrets/README.md) | 加密密钥包：解密 / 轮换 / 改口令 |
| [deploy/deploy-platform.sh](deploy/deploy-platform.sh) | NetSec-Agentic 平台一键部署 / 版本恢复 |
| **memory/**（14 条 .md） | 换机后恢复 Claude 记忆（见 §0.5）；含故障复盘库、命名、基线、每日巡检机制 |
| **inspection/** | 每日巡检基线快照 + 日志（漂移对比基准） |
| **scheduled-tasks/** | 每日巡检定时任务定义（换机后按 memory/project_daily_inspection.md 重建） |
| [elk/README.zh-CN.md](elk/README.zh-CN.md) | 重建或排障 ELK 日志服务器 |
| [CLAUDE.md](CLAUDE.md) | 改 scm-mcp 代码（工程契约） |
| [DESIGN.md](DESIGN.md) | 查 scm tool ↔ REST 端点映射 |
| [WORKFLOW.md](WORKFLOW.md) | scm-mcp 分阶段开发协议 |
