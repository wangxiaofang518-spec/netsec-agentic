# CLAUDE.md — L1 工程契约

## 项目身份

**名称**: `scm-mcp`  
**用途**: 将 Palo Alto Networks Strata Cloud Manager (SCM) REST API 桥接为 MCP tools，供 Claude CLI / Cursor 等 MCP 客户端调用。  
**传输**: stdio（MCP 标准 stdio 传输，不对外暴露任何 HTTP 端口）。

---

## 技术栈（钉死，不得替换）

| 组件 | 版本约束 | 说明 |
|---|---|---|
| 语言 | Python ≥ 3.11 | 使用 `match` / `tomllib` 等 3.11 特性 |
| MCP SDK | `mcp` 官方包（PyPI: `mcp`） | stdio 传输，不换成第三方封装 |
| HTTP 客户端 | `httpx` | 使用 `AsyncClient`，不用 `requests` / `aiohttp` |
| 依赖管理 | `pyproject.toml` + `pip install -e .` | 不用 Poetry / PDM / conda |

**禁止引入**: LangChain、FastAPI、Flask、Django、任何 web 框架、任何 AI SDK。

---

## 目录约定

```
scm-mcp/
├── src/scm_mcp/
│   ├── server.py        # MCP 入口：注册所有 tool，运行 stdio server
│   ├── auth.py          # OAuth2 token 管理（client_credentials）
│   ├── client.py        # httpx AsyncClient 封装，注入 base_url + Bearer token
│   └── tools/
│       ├── objects.py       # YAML: config/sase/objects/objects-june.yaml
│       ├── security.py      # YAML: config/sase/security/security-services-R2-2026.yaml
│       ├── deployment.py    # YAML: config/sase/deployment/deployment-services-june.yaml
│       ├── operations.py    # YAML: config/sase/operations/config-operations-march.yaml
│       └── iam.py           # YAML: iam/ServiceAccounts.yaml 等
├── tests/
├── pyproject.toml
├── CLAUDE.md
├── DESIGN.md
├── WORKFLOW.md
└── README.md
```

**规则**：`tools/` 下每个文件仅负责一个 YAML 来源对应的资源类别。跨 YAML 的操作不合并到同一文件。

---

## 禁止事项

1. **禁止硬编码任何 URL、Client ID、Secret、TSG ID**。
2. **禁止在 tool 实现里重写业务逻辑**——tool 函数体只做：构造参数 → 调用 `client.py` → 透传响应。
3. **禁止修改传输层**——保持 stdio，不改为 HTTP/SSE。
4. **禁止自行编造入参/出参字段**——所有 schema 必须来自 `C:/pan.dev/openapi-specs/scm/` 下对应 YAML 的 `components/schemas` 和 `paths.*.parameters`。
5. **禁止在 `auth.py` 之外发起 token 请求**——所有 HTTP 调用必须经过 `client.py`，由 `client.py` 调用 `auth.py` 取 token 并注入。

---

## 必须执行

- **每次新增 tool 前**：先读对应 YAML 的 `paths` 节和 `components/schemas` 节，确认 operationId、参数名、必填字段。
- **凭据读取**：
  ```python
  SCM_CLIENT_ID     = os.environ["SCM_CLIENT_ID"]
  SCM_CLIENT_SECRET = os.environ["SCM_CLIENT_SECRET"]
  SCM_TSG_ID        = os.environ["SCM_TSG_ID"]
  SCM_BASE_URL      = os.environ.get("SCM_BASE_URL", "https://api.strata.paloaltonetworks.com")
  ```
- **Token 刷新**：token 过期前 ≥60 秒自动刷新（在 `auth.py` 的 `TokenManager` 类中实现）。
- **错误响应格式**：SCM 4xx/5xx 统一转为 `{"error": "<HTTP status>", "detail": "<SCM error body>"}` 返回给 MCP，不抛 Python 异常到 MCP 层。
- **日志**：只写 `stderr`，不写 `stdout`（stdout 专属 MCP stdio 协议帧）。
