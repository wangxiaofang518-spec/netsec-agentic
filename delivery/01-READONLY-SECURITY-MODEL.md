# NetSec Agentic 只读版 — 安全模型与工具边界

> 本文档定义"只读诊断优先"方案包的**能力边界**。客户交付版必须遵守此边界。
> 核心原则:Agent 只能**观测与诊断**,不能变更任何生产配置。

---

## 一、为什么需要三层保障(重要认知)

PANW 的 MCP 包(`@iflow-mcp/apius-tech-panos-mcp`、`scm-mcp` 等)**默认同时暴露读工具和写工具**,包本身没有"只读开关"。因此"只读"不能只靠"少调用几个工具"的自觉,必须靠**三层强制保障**,任何一层都能独立拦住变更:

| 层 | 机制 | 强度 | 说明 |
|---|---|---|---|
| **① 权限层(最硬)** | 给 Agent 用的 API Key / 服务账号配**只读 RBAC 角色** | ★★★ 决定性 | 即使写工具被调用,设备/云端直接拒绝。这是"只读"的真正保证 |
| **② 工具层** | 只在 Claude 里注册 `get_*`/`list_*`/`test_*` 只读工具,不注册写工具 | ★★ | Agent 手里没有变更工具,减少误触面 |
| **③ 审计层** | 所有调用留痕(NGFW/SCM 审计日志 + ELK 汇聚) | ★★ | 事后可追溯,发现异常调用 |

**交付要求:三层都要配。** 只做②不做①是不安全的(有人手工加回写工具就破防);只做①不做②则 Agent 会尝试写操作再被拒、产生噪音和困惑。①+②+③ 组合才是产品级只读。

---

## 二、工具白名单(进只读版)

按 MCP 分类。**只有下列前缀/名称的工具进入只读交付版。**

### panos-*(3 台 NGFW,每台同一套工具)
✅ **全部 `get_*` 只读工具**(约 70+),典型:
- 配置读取:`get_security_rules` `get_nat_rules` `get_pbf_rules` `get_qos_rules` `get_decryption_rules` `get_address_objects` `get_address_groups` `get_service_objects` `get_zones` `get_static_routes` `get_security_profiles` `get_tags` 等
- 运行状态:`get_firewall_info` `get_interfaces` `get_routing_table` `get_active_sessions` `get_ha_status` `get_ipsec_tunnels` `get_arp_table` `get_dhcp_leases` `get_globalprotect_users` `get_userid_mappings` `get_system_resources` 等
- 日志:`get_traffic_logs` `get_threat_logs` `get_system_logs` `get_config_logs`
- Panorama 只读:`panorama_get_*`
- `get_config_xpath`(只读查询任意 xpath)

### scm(Strata Cloud Manager)
✅ **全部 `list_*` 和 `get_*`**,典型:`list_security_rules` `list_addresses` `list_services` `list_remote_networks` `list_service_connections` `get_security_rule` `get_bgp_routing` `list_url_access_profiles` `list_decryption_rules` `list_jobs` `get_job` 等

### prisma-airs
✅ **只读查询类**:`airs_*_list` `airs_*_get`(profiles/topics/scans/targets/redteam scans 等的 list/get)
✅ `airs_runtime_scan` / `airs_runtime_bulk_scan_*`(扫描是只读判断,不改配置)
✅ `airs_scan_logs_query`

### koi(软件供应链)
✅ **全部**:`koi_list_*` `koi_get_report_status` `koi_create_report`(报表是只读导出,不改终端)

---

## 三、工具黑名单(严禁进只读版)

❌ 以下工具**必须从 Claude 注册中排除**(或即便注册,靠①权限层拦住):

### panos-*
- 变更:`add_*`(security/nat/pbf/qos/decryption rule、address/service object、static route、tag…)
- 删除:`delete_*`(含 `delete_config`)
- 修改:`set_*`(`set_config` `set_security_rule_disabled` 等)、`move_*`
- 生效:**`commit`**、Panorama 的 **`panorama_commit`** / **`panorama_push_to_devices`**
- ⚠️ **`run_op_command`**:高危!它能跑任意 XML 操作命令,包括改配置。**只读版必须排除**,或严格限制为只跑 `<show>`/`<test>` 类(实现难度高,建议直接排除,用结构化 get_* 代替)

### scm
- `create_*` `update_*` `delete_*` `move_security_rule`
- **`push_candidate_config`**(推生产,最高危)
- `create_service_account` / `reset_service_account`(生成明文密钥)

### prisma-airs(destructive,默认禁用)
- `airs_*_delete`、`airs_redteam_scan_abort`、`airs_topics_revert_from_profile`、返回明文密钥的 `airs_*_credentials` / `airs_model_security_pypi_auth`

---

## 四、① 权限层:客户侧只读 RBAC 配置(交付必做)

给 Agent 用的凭据,在客户 PANW 平台侧配成**只读**:

- **NGFW(PAN-OS)**:创建 Admin Role Profile,所有功能设为 **Read Only** / **Enable(只读)**,禁用 Commit 权限;用此角色生成 API Key 给 MCP 用。
- **SCM(Strata Cloud Manager)**:IAM 里给服务账号分配**只读角色**(如 "View Only" / 自定义只读 role),不授予 Push/Deploy 权限。
- **Prisma AIRS**:用扫描/只读 scope 的 API Key。

> 交付验证:配好后,让 Agent 尝试一次 `commit` 或 `set_config`,应被设备以权限不足拒绝 —— 这证明只读 RBAC 生效(这是唯一可信的"只读"证明,不能只看工具清单)。

---

## 五、③ 审计层
- NGFW/SCM 的 config/admin 日志 + API 调用审计
- 汇聚到 ELK(方案包含 ELK 部署,见 elk/)
- 定期审查:是否有非预期的写尝试(应全部被 RBAC 拒绝)

---

## 六、边界总结(一句话给客户)
> **Agent 能看清一切、诊断一切、还原任何访问路径与根因,但碰不了一根配置** —— 变更永远回到你的工程师手里执行。风险归零,价值(诊断/取证/可观测)全保留。
