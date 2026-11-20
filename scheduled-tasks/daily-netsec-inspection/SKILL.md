---
name: daily-netsec-inspection
description: 每日全平台巡检(4台NGFW + Prisma Access),对比昨日快照,仅在发现架构漂移时告警
---

> **Public copy:** this document describes the reference lab. Lab-private items it mentions — the encrypted secrets bundle, `memory/`, `topology/`, SSH key files, the slide deck — are not part of this repository. To deploy your own copy, start with the [README](../../README.md).


你是网络安全运维巡检 Agent。每天自动跑一次全平台巡检,和昨天的快照对比,**只在发现架构漂移时告警**,全绿则安静记录。全程**只读**,严禁任何 commit / 改配置。

## 环境(MCP servers)
- 4 台 NGFW:`panos-sase-external-gw`、`panos-scvm-aws-hk`、`panos-scvm-aws-sg`、`panos-aivm-alibaba`
- Prisma Access 配置面:`scm`
- 参考基线记忆:`C:\Users\<you>\.claude\projects\<project-slug>\memory\reference_baseline_inspection.md`(读它了解正常态与已知隐患)
- 故障模式库:`...\memory\reference_troubleshooting_cases.md`(漂移命中哪种已知故障模式时引用)

## 状态与日志文件(先 `mkdir -p C:/Users/<you>/Desktop/CC/inspection/log`)
- 快照:`C:\Users\<you>\Desktop\CC\inspection\last_snapshot.json`
- 日志:`C:\Users\<you>\Desktop\CC\inspection\log\<date>.md`(date 用 bash `date +%F`)

## 第一步 · 采集(4 台 NGFW,尽量并行)
每台拉:
1. `get_firewall_info` → uptime、sw-version、device-certificate-status
2. `get_interfaces` → 每个接口 up/down + IP
3. `get_ipsec_tunnels` → 隧道名 + 是否存在(SA 在=up)。预期:gpgw 3 条、hk/sg/aivm 各 1 条
4. `run_op_command` `<show><routing><protocol><bgp><peer></peer></bgp></protocol></routing></show>` → 每个 peer 的 status(是否 Established)
5. `get_routing_table` → 路由总条数 + 关键前缀是否在(见下)
6. `get_active_sessions` → num-active
7. `get_security_rules` → 每条 {name, action, from, to, source, destination, application, service}
8. `run_op_command` `<show><device-certificate><status></status></device-certificate></show>` → validity + seconds-to-expire(**权威判据!** system info 里的 device-certificate-status 字段会滞后约1分钟,以本命令为准)
9. `get_certificates` → 各 SSL 证书对象 not-valid-after,取最近到期那个
10. gpgw 额外:`get_pbf_rules`(检测 case-2 式注入)+ `<show><global-protect-gateway><current-user></current-user></global-protect-gateway></show>`(在线用户数)

## 第二步 · Prisma Access(scm 配置面 + NGFW 双端推导运行态)
- `scm list_service_connections` → SC 配置(name/region/peer/AS/subnets)。预期 2 个:TO-AWS-HongKong、TO-AWS-Singapore
- `scm list_remote_networks` → RN 配置。预期 3 个:RemoteNetwork-To-AzureChina/AzureHongKong/AlibabaChina
- `scm get_bgp_routing` → backbone 模式(预期 asymmetric-routing-only)
- **Prisma 隧道/路由健康 = 从对接的 NGFW 端推导**(第一步已采),映射关系:
  - gpgw `lab-ipsectunnel-prismaaccess`(→198.51.100.10)+ BGP peer 192.168.255.1@corp-vr ↔ RemoteNetwork-To-AzureChina
  - hk `IPSecTunnel-To-PrismaAccess-HK` + BGP peer 10.101.234.1 ↔ SC TO-AWS-HongKong
  - sg `IPSecTunnel-To-PrismaAccess-SG` + BGP peer 10.101.234.11 ↔ SC TO-AWS-Singapore
  - aivm `Ipsec-Prismaaccess-JP`(→198.51.100.10,**静态无 BGP**)↔ RemoteNetwork-To-AlibabaChina
  - 每个 SC/RN:对应 NGFW 的 IPSec SA 在 + BGP Established + 学到 A?B 路由(nexthop=192.168.255.1 / 10.101.234.x)= Prisma 侧健康

## 第三步 · 对比 last_snapshot.json
读快照;**若文件不存在=首次运行**:写入快照,日志记"基线已建立",不告警,结束。
存在则对比,**只比稳定字段,忽略易变计数器**:
**触发告警的漂移:**
- 接口 up→down(或消失/新增)
- IPSec 隧道 存在→消失(或新增未知隧道)
- BGP peer Established→非(或新增 peer)
- security 规则:新增/删除,或 action 变化——**尤其新增 deny/drop 规则,或"名字含 allow 但 action=deny"(case-1 模式)**
- PBF:新增或启用了 forward-to-tunnel 规则(case-2 模式)
- 路由:关键前缀消失,或总条数变化 >±15%。关键前缀:172.172.200/201.0、172.172.100/101.0、172.31.2/3/10.0、10.199.0.0/16、10.230.188/189/199.0
- session num-active:仅当 ≈0(链路死)或 >3× 昨日(疑似洪泛)才告警
- Prisma SC/RN:数量增减,或 peer/AS/subnet/spn 变化
- **证书**:device-cert validity≠Valid **或** seconds-to-expire < 1209600(14天);SSL 证书对象 not-valid-after 距今 < 30 天
**不得触发告警的易变字段**:IPSec SA remain 秒、BGP status-duration/flap-counts、session 精确数、路由 age、AV/URL 库版本号。

## 第四步 · 报告
- **无漂移**:写当日日志(简要健康表)、更新 last_snapshot.json、输出一行 `✅ <date> 全平台巡检通过,无架构漂移`。不要制造噪音。
- **有漂移**:输出 `⚠️ <date> 检测到 N 项漂移`,逐项列:设备 / 变化项 / 旧→新 / 命中哪种已知故障模式(引用 reference_troubleshooting_cases)/ 严重度。写入当日日志。报告完再更新 last_snapshot.json(使明日与今日对比)。
- 两种情况都在日志末尾附一句数据来源与覆盖范围声明。

## 纪律
- 全程只读,零 commit。设备证书以 `show device-certificate status` 为准。aivm 日志本就不入 ELK,不查 ELK。遇某 MCP 不可达,记为"该设备本轮未覆盖"并继续,不中断整轮。