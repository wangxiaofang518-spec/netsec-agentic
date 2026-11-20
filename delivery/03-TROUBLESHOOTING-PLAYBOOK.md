# NetSec Agentic 只读版 — 排障 Playbook(诊断剧本)

> 这是方案包的知识核心。它让 Agent 在**客户环境**里也按同一套严谨方法工作。
> 客户工程师用自然语言提问,Agent 参照本剧本自主取证、给带证据的结论。
> 全部为**只读诊断**动作,不含任何变更。

---

## 核心方法论:四维并行取证 + 对照基线

任何"通不通 / 为什么"的排障,Agent 都应从**四个维度并行取证并交叉印证**,而不是只看一处:

| 维度 | 查什么(只读工具) | 关键点 |
|---|---|---|
| **① 设备节点** | 会话表(`show session`)、`test security-policy-match`、接口/IPSec 状态 | 看流量实际怎么走、命中哪条规则 |
| **② 路由** | `get_routing_table`、`get_pbf_rules`、`test routing fib-lookup` | **PBF 优先于路由表**;实际出接口 ≠ fib → 必有 PBF 覆盖 |
| **③ 策略/对象** | `get_security_rules`/`get_nat_rules`、地址对象、自定义 URL 分类 | **以 action 字段为准,别被规则名骗**;引用自定义对象时查其成员 |
| **④ 日志** | ELK 跨设备统一视图 / NGFW 本地 `get_traffic_logs`/`get_threat_logs` | action 分桶、时间线、正常流 vs 故障流对比 |

**铁律**:
1. 逐跳定位故障点,每个结论必须有证据、多源印证。
2. 对照**健康基线**(见 `baseline-template.md`)找偏差,而非只看当前态。
3. NGFW 常只是**转发节点**,真正裁决可能在 **Prisma Access 云端** —— 别在 NGFW 看到 allow 就断定"通了"。
4. 分清流量归属哪个平台/组件(NGFW 本地 vs Prisma Access 的 Mobile Users / Remote Network / Service Connection)。

---

## 剧本库(基于真实案例,客户可直接套用)

### 剧本 A:某用户/IP 访问某服务不通

**症状**:"用户 X 访问不了服务 Y"

**Agent 诊断步骤**:
1. 确认源身份:GP 用户?查 `get_globalprotect_users` 找虚拟 IP 归属
2. 入口 NGFW 查会话表:`show session filter source X destination Y` → 看 from/to zone、ingress/egress 接口、命中 rule、action
3. `test security-policy-match`(源→目标+应用+端口)→ 主动推演命中哪条规则、allow/deny
4. 若 NGFW allow 但仍不通 → 沿路径查下游(下一跳 NGFW / Prisma Access)
5. ELK 交叉:该流的 action 分桶(如 `ping 全 allow vs HTTP reset-both` 说明按应用/端口拦)
6. 对照基线找偏差 → 定位根因,给证据

**已知故障模式**(客户环境同样适用):
- **安全策略 deny**(案例1):某规则精确匹配源IP+应用,action=deny(**规则名可能叫 allow 但实为 deny → 看 action 字段**)。证据:policy-match 命中 deny + 日志 action=reset-both/policy-deny
- **仅某应用/端口不通、ping 通** → 说明是**按 application/service 的精细拦截**,不是路由问题

### 剧本 B:某主机全部服务不通(含 ping)

**症状**:"整个主机 X 什么都连不上"

**Agent 诊断步骤**:
1. 会话表看 egress 接口 → **对照基线,出接口变了吗?**
2. `test routing fib-lookup` → 若 fib 结果 ≠ 会话表实际出接口 → **必有 PBF 覆盖**
3. `get_pbf_rules` → 找是否有精确匹配该目标、forward 到异常接口的 PBF
4. 若被导向某隧道 → `get_ipsec_tunnels` 确认该隧道 IPSec SA 是否建立(未建立=黑洞)
5. 下游设备会话表若为空 → 证实流量根本没到达

**已知故障模式**:
- **PBF 改道进死隧道**(案例2):注入的 PBF 精确匹配目标 IP、强制 forward 到未建立的隧道,流量进黑洞。**教训:会话表实际出接口 ≠ fib-lookup → 查 PBF**

### 剧本 C:访问外部站点/SaaS 不通(经 Prisma Access)

**症状**:"访问不了 chatgpt.com / 某外部网站"

**Agent 诊断步骤**:
1. 确认流量路径:GP 用户经本地 NGFW → 以 **Remote Network** 身份进 Prisma Access(**不是 Mobile Users!先分清组件**)
2. 本地 NGFW 查:多半是 allow + 转发(NGFW 只是转发节点)
3. 查目标 URL 分类:`test url-info-cloud <域名>` → 得到 PAN-DB 内置分类
4. 查 Prisma Access 对应 folder(Remote Networks)的安全策略 + URL 过滤 profile
5. **若规则引用自定义 URL 分类 → 必须查该自定义分类的成员**(内置分类 ≠ 自定义分类!)
6. SCM 门户/API 确认自定义分类成员是否包含目标域

**已知故障模式**:
- **Prisma Access 自定义 URL 分类拦截**(案例3):Remote Networks 上自定义分类(如成员=`*.chatgpt.com`)被 deny。**两个关键教训:①分清是 Remote Network 而非 Mobile Users;②规则引用自定义分类时查其成员,不能用网站的 PAN-DB 内置分类判断**
- NGFW 日志的 tcp-fin + 有回包 ≠ 真访问成功,可能是云端拦截页/reset 的响应

---

## 故障模式矩阵(客户运营通病全景)

| 维度 | NGFW | Prisma Access |
|---|---|---|
| **路由** | PBF 改道 / 静态路由错 / 下一跳错 | PBF/BGP 同理 |
| **安全策略** | deny 规则(注意名不副实)/ 顺序错 / zone 错 | folder 策略 deny |
| **自定义对象** | 地址对象值写错 / 服务端口错 | 自定义 URL 分类 / EDL |
| **NAT** | 源/目标 NAT 错、端口映射错 | — |
| **隧道/互联** | IPSec SA 未建立、BGP 未收敛 | RN/SC 隧道、云骨干 |

客户遇到新故障,Agent 应先归类(哪个维度×哪个平台),再套对应剧本取证。

---

## 输出规范(Agent 给结论时)
1. **逐跳呈现**:流量从哪进、经过哪、在哪被拦
2. **每个结论带证据**:引用具体的会话表/policy-match/日志字段
3. **多源印证**:设备接口 + 日志中台交叉验证
4. **对照基线说偏差**:"当前 X,基线是 Y,故障在此"
5. **诚实边界**:查不到的说查不到(如某侧日志未接入),不臆断
6. **给修复方向,但不执行**(只读版)——变更交回客户工程师
