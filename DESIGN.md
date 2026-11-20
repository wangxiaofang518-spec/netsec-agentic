# DESIGN.md — L2 设计

所有条目均来自 `C:\pan.dev\openapi-specs\scm\` 下真实 YAML 的 `paths` / `components.schemas`。不手抄、不臆造字段——每次实现前重新核对源文件。

---

## 0. 认证

**来源**: `auth/AuthService.yaml`

**⚠️ Host 事实**：该 YAML 的 `servers[0].url` = `https://auth.apps.paloaltonetworks.com`——**不是** `SCM_BASE_URL`（`api.strata.paloaltonetworks.com`）。Token 端点走独立域名，与业务 Config API 的 host 无关。

| 项 | 值 |
|---|---|
| Host（代码常量，非环境变量） | `https://auth.apps.paloaltonetworks.com` |
| Path | `POST /auth/v1/oauth2/access_token` |
| Content-Type | `application/x-www-form-urlencoded` |
| 请求字段 | `grant_type=client_credentials`（枚举唯一值）, `scope=tsg_id:<SCM_TSG_ID>` |
| 认证方式 | HTTP Basic：`SCM_CLIENT_ID` : `SCM_CLIENT_SECRET` |
| 响应 schema | `AccessToken` = `{access_token, token_type, expires_in, scope}` |

`auth.py` 中 `TokenManager` 缓存 `access_token`，在 `expires_in - 60` 秒后视为过期并重新请求。此逻辑不暴露为 MCP tool，仅被 `client.py` 内部调用。

---

## 1. Objects — `tools/objects.py`

**YAML 来源**: `config/sase/objects/objects-june.yaml`
**Base URL 后缀**: `/config/objects/v1`
**通用 list 参数**（`components/parameters` 复用）：`name`, `folder`, `snippet`, `device`, `offset`, `limit`

| MCP Tool | HTTP | Path | operationId | 入参 | 出参（200/201） |
|---|---|---|---|---|---|
| `list_addresses` | GET | `/addresses` | `ListAddresses` | `name?, folder?, snippet?, device?, offset?, limit?` | `{data: [addresses], limit, offset, total}` |
| `create_address` | POST | `/addresses` | `CreateAddresses` | body: `addresses` schema（`name` 必填 + 恰好一种地址类型：`ip_netmask`\|`ip_range`\|`ip_wildcard`\|`fqdn` + 恰好一种容器：`folder`\|`snippet`\|`device`） | `addresses` |
| `get_address` | GET | `/addresses/{id}` | `GetAddressesByID` | `id`（uuid，path） | `addresses` |
| `update_address` | PUT | `/addresses/{id}` | `UpdateAddressesByID` | `id` + body: `addresses` | `addresses` |
| `delete_address` | DELETE | `/addresses/{id}` | `DeleteAddressesByID` | `id` | `http_ok` |
| `list_address_groups` | GET | `/address-groups` | `ListAddressGroups` | 同通用 list 参数 | `{data: [...], limit, offset, total}` |
| `create_address_group` | POST | `/address-groups` | `CreateAddressGroups` | body | 对象 |
| `get_address_group` | GET | `/address-groups/{id}` | `GetAddressGroupsByID` | `id` | 对象 |
| `update_address_group` | PUT | `/address-groups/{id}` | `UpdateAddressGroupsByID` | `id` + body | 对象 |
| `delete_address_group` | DELETE | `/address-groups/{id}` | `DeleteAddressGroupsByID` | `id` | `http_ok` |
| `list_applications` | GET | `/applications` | `ListApplications` | 通用 list 参数 | `{data, limit, offset, total}` |
| `create_application` | POST | `/applications` | `CreateApplications` | body | 对象 |
| `get_application` | GET | `/applications/{id}` | `GetApplicationsByID` | `id` | 对象 |
| `update_application` | PUT | `/applications/{id}` | `UpdateApplicationsByID` | `id` + body | 对象 |
| `delete_application` | DELETE | `/applications/{id}` | `DeleteApplicationsByID` | `id` | `http_ok` |
| `list_application_groups` | GET | `/application-groups` | `ListApplicationGroups` | 通用 list 参数 | `{data, limit, offset, total}` |
| `create_application_group` | POST | `/application-groups` | `CreateApplicationGroups` | body | 对象 |
| `list_services` | GET | `/services` | `ListServices` | 通用 list 参数 | `{data: [services], limit, offset, total}` |
| `create_service` | POST | `/services` | `CreateServices` | body: `services` schema（`name` 必填 + `protocol.tcp\|protocol.udp`） | `services` |
| `get_service` | GET | `/services/{id}` | `GetServicesByID` | `id` | `services` |
| `update_service` | PUT | `/services/{id}` | `UpdateServicesByID` | `id` + body | `services` |
| `delete_service` | DELETE | `/services/{id}` | `DeleteServicesByID` | `id` | `http_ok` |
| `list_service_groups` | GET | `/service-groups` | `ListServiceGroups` | 通用 list 参数 | `{data, limit, offset, total}` |
| `list_tags` | GET | `/tags` | `ListTags` | 通用 list 参数 | `{data: [tags], limit, offset, total}` |
| `create_tag` | POST | `/tags` | `CreateTags` | body: `tags` schema（`name` 必填, `color` 枚举可选） | `tags` |
| `delete_tag` | DELETE | `/tags/{id}` | `DeleteTagsByID` | `id` | `http_ok` |
| `list_external_dynamic_lists` | GET | `/external-dynamic-lists` | `ListExternalDynamicLists` | 通用 list 参数 | `{data, limit, offset, total}` |

> **范围说明**：`objects-june.yaml` 共 105 个 operationId（含 advanced-device-objects、auto-tag-actions、hip-objects、hip-profiles、http/syslog/log-forwarding-profiles、regions、schedules、device-context-segments、dynamic-user-groups、quarantined-devices 等）。上表覆盖最高频的资源类别（地址、应用、服务、标签）。其余资源按同一模式在 `tools/objects.py` 中追加，实现前必须重新读取 YAML 确认字段——不得凭表格外推。

---

## 2. Security — `tools/security.py`

**YAML 来源**: `config/sase/security/security-services-R2-2026.yaml`
**Base URL 后缀**: `/config/security/v1`

| MCP Tool | HTTP | Path | operationId | 入参 | 出参 |
|---|---|---|---|---|---|
| `list_security_rules` | GET | `/security-rules` | `ListRules` | `name?, position?, folder?, snippet?, device?, offset?, limit?` | `SecurityRuleListResponse` |
| `create_security_rule` | POST | `/security-rules` | `CreateSecurityRules` | query: `position?` + body: `security-rules` schema（`oneOf[security-rule-type, internet-rule-type]` discriminator=`policy_type`；且必须恰好一种容器 `folder`\|`snippet`\|`device`） | `security-rules` |
| `get_security_rule` | GET | `/security-rules/{id}` | `GetSecurityRulesByID` | `id`（uuid） | `security-rules` |
| `update_security_rule` | PUT | `/security-rules/{id}` | `UpdateSecurityRulesByID` | `id` + body | `security-rules` |
| `delete_security_rule` | DELETE | `/security-rules/{id}` | `DeleteSecurityRulesByID` | `id` | `http_ok` |
| `move_security_rule` | POST | `/security-rules/{id}:move` | `MoveSecurityRulesByID` | `id` + body（移动位置参数，实现前读 YAML 该路径的 requestBody） | — |
| `list_anti_spyware_profiles` | GET | `/anti-spyware-profiles` | `ListAntiSpywareProfiles` | 通用 list 参数 | 列表 |
| `create_anti_spyware_profile` | POST | `/anti-spyware-profiles` | `CreateAntiSpywareProfiles` | body | 对象 |
| `list_vulnerability_protection_profiles` | GET | `/vulnerability-protection-profiles` | `ListVulnerabilityProtectionProfiles` | 通用 list 参数 | 列表 |
| `list_url_access_profiles` | GET | `/url-access-profiles` | `ListURLAccessProfiles` | 通用 list 参数 | 列表 |
| `list_decryption_rules` | GET | `/decryption-rules` | `ListDecryptionRules` | 通用 list 参数 | 列表 |
| `list_dos_protection_rules` | GET | `/dos-protection-rules` | `ListDoSProtectionRules` | 通用 list 参数 | 列表 |

> **范围说明**：该 YAML 共 ~105 个 operationId，覆盖 Anti-Spyware / Vulnerability Protection / WildFire AV / DNS Security / File Blocking / DoS Protection / URL Filtering / Decryption 等全部安全 Profile 与 Rule 类型。首批实现聚焦 `security-rules`（核心策略）+ 各 Profile 的 List，其余 CRUD 按相同模式扩展。

---

## 3. Deployment — `tools/deployment.py`

**YAML 来源**: `config/sase/deployment/deployment-services-june.yaml`
**Base URL 后缀**: `/config/deployment/v1`

| MCP Tool | HTTP | Path | operationId | 入参 | 出参 |
|---|---|---|---|---|---|
| `list_remote_networks` | GET | `/remote-networks` | `ListRemoteNetworks` | `folder`（**required**，枚举唯一值 `"Remote Networks"`，有 default 故可省略后由 client 端补默认值）, `limit?, offset?, name?` | `{data: [remote-networks], limit, offset, total}` |
| `create_remote_network` | POST | `/remote-networks` | `CreateRemoteNetworks` | body: `remote-networks` schema（`name`, `folder`, `ipsec_tunnel`, `region`, `subnets`, `license_type`, `spn_name` 等） | `remote-networks` |
| `get_remote_network` | GET | `/remote-networks/{id}` | `GetRemoteNetworksByID` | `id` | `remote-networks` |
| `update_remote_network` | PUT | `/remote-networks/{id}` | `UpdateRemoteNetworksByID` | `id` + body | `remote-networks` |
| `delete_remote_network` | DELETE | `/remote-networks/{id}` | `DeleteRemoteNetworksByID` | `id` | `http_ok` |
| `list_service_connections` | GET | `/service-connections` | `ListServiceConnections` | `folder`（**required**，枚举唯一值 `"Service Connections"`，有 default） + 通用 list 参数 | 列表 |
| `create_service_connection` | POST | `/service-connections` | `CreateServiceConnections` | body | 对象 |
| `list_locations` | GET | `/locations` | `ListLocations` | — | 列表 |
| `get_bgp_routing` | GET | `/bgp-routing` | `GetBGPRouting` | — | 对象 |
| `update_bgp_routing` | PUT | `/bgp-routing` | `UpdateBGPRouting` | body | 对象 |
| `list_bandwidth_allocations` | GET | `/bandwidth-allocations` | `ListBandwidthAllocations` | — | 列表 |
| `get_shared_infrastructure_settings` | GET | `/shared-infrastructure-settings` | `GetSharedInfrastructureSettings` | — | 对象 |
| `list_sites` | GET | `/sites` | `ListSites` | 通用 list 参数 | 列表 |

---

## 4. Operations — `tools/operations.py`

**YAML 来源**: `config/sase/operations/config-operations-march.yaml`
**Base URL 后缀**: `/config/operations/v1`

| MCP Tool | HTTP | Path | operationId | 入参 | 出参 |
|---|---|---|---|---|---|
| `list_jobs` | GET | `/jobs` | `ListJobs` | — | `{data: [jobs], limit, offset, total}` |
| `get_job` | GET | `/jobs/{id}` | `GetJobsByID` | `id`（jobid） | `jobs-response` |
| `list_config_versions` | GET | `/config-versions` | `ListConfigVersions` | — | 列表 |
| `get_config_version` | GET | `/config-versions/{version}` | `GetConfigVersionsByID` | `version`（**整数**，非 uuid——参数名是 `version` 不是 `id`） | `[config-version]`（数组） |
| `get_running_config_version` | GET | `/config-versions/running` | `GetRunningConfigVersions` | — | 对象 |
| `load_config_version` | POST | `/config-versions:load` | `LoadConfigVersions` | body: `load-config` schema = `{version: integer}` | — |
| `push_candidate_config` | POST | `/config-versions/candidate:push` | `PushCandidateConfigVersions` | body: `{admin?: [string], description?: string}` + 恰好一种 `{folder: [string]}` 或 `{devices: [number]}` | `http_created` |
| `delete_candidate_config` | DELETE | `/config-versions/candidate` | `DeleteCandidateConfigVersions` | — | — |

> **重要**：`push_candidate_config` 是唯一会把候选配置真正推送到生产设备/租户的 tool——高风险操作。`server.py` 注册该 tool 时必须在描述中标注"此操作影响生产环境"，供 MCP 客户端（Claude/Cursor）在调用前向用户确认。
>
> **YAML 自身缺陷（如实记录，不代表实现依据此错误）**：`PushCandidateConfigVersions` 的 requestBody 用 `allOf` 声明两个互斥分支（folder 分支 / devices 分支），但**两个分支的 `required` 都写成 `[folders]`**（多了个 s，且第二个分支明显是复制第一个分支忘改）。而两个分支 `properties` 里真实字段名是单数 `folder` 和 `devices`。`required: [folders]` 在两个分支里都无法匹配到任何 `properties` 字段——这是 spec 本身的 typo。实现以 `properties` 字段名（`folder`、`devices`）为准，因为这是请求体实际会被 SCM 解析的字段名；`required` 列表的 typo 不具备约束力，仅在代码里以「二者恰好提供一个」的运行时校验替代。

---

## 5. IAM — `tools/iam.py`

**YAML 来源**: `iam/ServiceAccounts.yaml`, `iam/Roles.yaml`, `iam/CustomRoles.yaml`, `iam/AccessPolicies.yaml`, `iam/PermissionSets.yaml`, `iam/Permissions.yaml`, `iam/UserAccounts.yaml`
**Base URL**: `https://api.sase.paloaltonetworks.com`（这几个 YAML 未定义 `/config/...` 前缀，走根路径）

| MCP Tool | HTTP | Path | operationId | 入参 | 出参 |
|---|---|---|---|---|---|
| `list_service_accounts` | GET | `/iam/v1/service_accounts` | `get-iam-v1-service_accounts` | **无参数**（YAML 确认：该 List 端点不支持任何查询参数，非分页） | `[service_account]`（数组，无 total/offset 包裹） |
| `create_service_account` | POST | `/iam/v1/service_accounts` | `post-iam-v1-service_accounts` | body: `service_account_create` = `{name（必填）, contact_email?, description?}` | `service_account` + `client_id`, `client_secret`（响应独有，body 里没有这两个字段） |
| `get_service_account` | GET | `/iam/v1/service_accounts/{id}` | `get-iam-v1-service_accounts-id` | `id` | `service_account` |
| `update_service_account` | PUT | `/iam/v1/service_accounts/{id}` | `put-iam-v1-service_accounts-id` | `id` + body: `service_account_update` = `{contact_email?, description?}`（不含 `name`——name 不可改） | `service_account` |
| `delete_service_account` | DELETE | `/iam/v1/service_accounts/{id}` | `delete-iam-v1-service_accounts-id` | `id` | `service_account` |
| `reset_service_account` | POST | `/iam/v1/service_accounts/{id}/operations/reset` | `post-iam-v1-service_accounts-id-operations-reset` | `id` | 新 `client_id` + `client_secret` |
| `list_roles` | GET | `/iam/v1/roles` | `get-iam-v1-roles` | — | 列表（角色为 PANW 内置，无 create/update/delete） |
| `list_custom_roles` | GET | `/iam/v1/custom_roles` | `get-iam-v1-custom_roles` | — | 列表 |
| `create_custom_role` | POST | `/iam/v1/custom_roles` | `post-iam-v1-custom_roles` | body: `custom_role_create` = `{name（必填）, description（必填）, permission_sets?, permissions?}` | 对象 |
| `list_access_policies` | GET | `/iam/v1/access_policies` | `get-iam-v1-access_policies` | `role?`, `principal?`（均为可选查询参数） | `access_policy_list` |
| `get_access_policy` | GET | `/iam/v1/access_policies/{id}` | `get-iam-v1-access_policies-id` | `id` | `access_policy` |
| `create_access_policy` | POST | `/iam/v1/access_policies` | `post-iam-v1-access_policies` | body: `access_policy_create_required` = `{principal, resource, role}`（三者均必填；`resource` 格式 `prn:<TSG_ID>::::`） | `access_policy_create`（含 `id`） |
| `delete_access_policy` | DELETE | `/iam/v1/access_policies/{id}` | `delete-iam-v1-access_policies-id` | `id` | `access_policy` |

> **敏感性提示**：`create_service_account` / `reset_service_account` 的响应体含明文 `client_secret`（YAML 示例已展示）。`server.py` 不得将这类响应写入任何日志文件。

---

## 6. Tenancy — `tools/tenancy.py`（可选，二期）

**YAML 来源**: `tenancy/TenantServiceGroup.yaml`
**Base URL**: `https://api.sase.paloaltonetworks.com`（`servers[0].url` 核实结果，与 IAM 共用同一 host——代码常量 `IAM_HOST`，非 `SCM_BASE_URL`），路径 `/tenancy/v1/...`

| MCP Tool | HTTP | Path | operationId |
|---|---|---|---|
| `get_tenant_service_group` | GET | `/tenancy/v1/tenant_service_groups/{tsg_id}` | `get-tenancy-v1-tenant_service_groups-tsg_id` |
| `list_tsg_ancestors` | POST | `/tenancy/v1/tenant_service_groups/{tsg_id}/operations/list_ancestors` | `post-tenancy-v1-tenant_service_groups-tsg_id-operations-list_ancestors` |
| `list_tsg_children` | POST | `/tenancy/v1/tenant_service_groups/{tsg_id}/operations/list_children` | `post-tenancy-v1-tenant_service_groups-tsg_id-operations-list_children` |

---

## Base URL 路由规则（重要）

**核实结果：SCM 实际有 3 个互不相同的 host，不是 1 个。** 逐一读取全部相关 YAML 的 `servers[0].url` 得到：

| Host | 来源 YAML | 覆盖模块 | 如何配置 |
|---|---|---|---|
| `https://api.strata.paloaltonetworks.com` | `config/sase/{objects,security,deployment,operations}/*.yaml` | `tools/objects.py`, `tools/security.py`, `tools/deployment.py`, `tools/operations.py` | 环境变量 `SCM_BASE_URL`（默认值即此） |
| `https://auth.apps.paloaltonetworks.com` | `auth/AuthService.yaml` | `auth.py`（不对应任何 tool 模块） | **代码常量** `AUTH_HOST`，不读环境变量 |
| `https://api.sase.paloaltonetworks.com` | `iam/*.yaml`, `tenancy/TenantServiceGroup.yaml`, `subscription/*.yaml` | `tools/iam.py`, `tools/tenancy.py` | **代码常量** `IAM_HOST`，不读环境变量 |

按用户决定：后两个 host 硬编码为 Python 常量（不做成环境变量），因为它们是 PANW 基础设施的固定端点，不是租户可配置项。只有 `SCM_BASE_URL`（Config API）保留环境变量，因为 CLAUDE.md 已将其列为必须走环境变量的四项之一。

各 tool 模块的 path 前缀常量（`servers[0].url` 减去 host 部分）：

```python
# auth.py
AUTH_HOST = "https://auth.apps.paloaltonetworks.com"
# 完整 URL = AUTH_HOST + "/auth/v1/oauth2/access_token"（无额外前缀）

# tools/objects.py
PATH_PREFIX = "/config/objects/v1"        # 拼接: SCM_BASE_URL + PATH_PREFIX + <path>

# tools/security.py
PATH_PREFIX = "/config/security/v1"

# tools/deployment.py
PATH_PREFIX = "/config/deployment/v1"

# tools/operations.py
PATH_PREFIX = "/config/operations/v1"

# tools/iam.py
IAM_HOST = "https://api.sase.paloaltonetworks.com"
# 完整 URL = IAM_HOST + <path>（YAML 路径已含 /iam/v1/... 前缀，不再叠加 PATH_PREFIX）

# tools/tenancy.py
# 复用 IAM_HOST；YAML 路径已含 /tenancy/v1/... 前缀
```

**注意**：`objects.py` / `security.py` / `deployment.py` / `operations.py` 四个模块最终请求 URL = `SCM_BASE_URL + PATH_PREFIX + <path from YAML>`；而 `iam.py` / `tenancy.py` 最终请求 URL = `IAM_HOST + <path from YAML>`（不经过 `SCM_BASE_URL`，也不叠加 `PATH_PREFIX`）。`client.py` 需要支持这两种拼接模式，不能假设所有 tool 都走 `SCM_BASE_URL`。

---

## 通用错误处理

所有工具函数遵循同一模式（在 `client.py` 统一实现，tool 层不重复）：

```python
try:
    resp = await client.request(method, url, **kwargs)
    resp.raise_for_status()
    return resp.json()
except httpx.HTTPStatusError as e:
    return {"error": str(e.response.status_code), "detail": e.response.text}
```

对应 YAML 中反复出现的 `bad_request_errors_basic` / `auth_errors` / `access_errors` / `not_found` / `conflict_errors` / `default_errors` 均落在此统一分支，不逐个特判。
