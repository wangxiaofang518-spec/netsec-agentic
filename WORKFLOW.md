# WORKFLOW.md — L3 阶段协议

每个 Phase 有明确输入、输出、**完成判定命令**。判定命令跑不过，不进入下一 Phase。

---

## Phase 0 — 环境搭建

**输入**: 空仓库
**任务**:
1. 创建目录结构（见 CLAUDE.md 目录约定）
2. 写 `pyproject.toml`，声明依赖：`mcp`, `httpx`
3. `pip install -e .`
4. 确认 `C:\pan.dev\openapi-specs\scm\` 可读（只读引用，路径写死在人读文档里，不做环境变量——按用户决定）

**完成判定**:
```bash
python -c "import mcp, httpx; print('deps ok')"
python -c "from scm_mcp import server; print('tools registered:', len(server.mcp._tool_manager._tools))"
```
两条命令均不报错。**注意**：`python -m scm_mcp --help` 不是有效的判定命令——`mcp.run(transport="stdio")` 不解析命令行参数，会直接阻塞等待 stdin，没有 `--help` 出口。判定 import 是否干净，用上面第二条命令（会触发 `server.py` 顶层的全部 `add_tool` 调用，任何签名错误在此处就会抛异常）。

---

## Phase 1 — Auth 模块

**输入**: Phase 0 完成
**任务**:
1. 实现 `auth.py` 的 `TokenManager`：
   - 读取 `SCM_CLIENT_ID` / `SCM_CLIENT_SECRET` / `SCM_TSG_ID`（缺失则在启动时立即报错退出，不要等到第一次调用才发现）
   - `POST {SCM_BASE_URL}/auth/v1/oauth2/access_token`，`grant_type=client_credentials`，`scope=tsg_id:{SCM_TSG_ID}`，Basic Auth
   - 缓存 token + 过期时间；`get_token()` 在过期前 60 秒自动刷新
2. 单元测试：mock httpx 响应，验证刷新逻辑

**完成判定**:
```bash
# 需要真实凭据（放在环境变量，不写入文件）
python -c "
import asyncio
from scm_mcp.auth import TokenManager
tm = TokenManager()
print(asyncio.run(tm.get_token())[:20], '...')
"
```
打印出 token 前缀（非空、非异常）。

---

## Phase 2 — HTTP Client 封装

**输入**: Phase 1 完成
**任务**:
1. 实现 `client.py`：`ScmClient` 类，构造时读 `SCM_BASE_URL`（默认值见 CLAUDE.md），持有 `httpx.AsyncClient`
2. 每次请求前调用 `TokenManager.get_token()`，注入 `Authorization: Bearer <token>`
3. 统一异常处理（见 DESIGN.md「通用错误处理」）
4. 提供 `request(method, path_prefix, path, **kwargs)` 供各 tool 模块调用

**完成判定**:
```bash
python -c "
import asyncio
from scm_mcp.client import ScmClient
c = ScmClient()
r = asyncio.run(c.request_config('GET', '/config/objects/v1', '/addresses', params={'folder': 'Shared', 'limit': 5}))
print(r)
"
```
返回合法 JSON（含 `data` 字段或结构化 `error`），无未捕获异常。**注意**：方法名是 `request_config`（不是 `request`）——`ScmClient` 区分 `request_config`（拼 `SCM_BASE_URL + path_prefix + path`）和 `request_iam`（拼 `IAM_HOST + path`），因为核实 YAML 后发现 Config API 和 IAM/Tenancy API 走两个不同 host（见 DESIGN.md「Base URL 路由规则」）。

---

## Phase 3 — 首个 Tool 打通 MCP

**输入**: Phase 2 完成
**任务**:
1. 实现 `tools/objects.py` 中的 `list_addresses`（对齐 DESIGN.md 第 1 节表格第一行）
2. 在 `server.py` 中用 MCP SDK 注册该 tool，启动 stdio server
3. 手工构造一条 MCP `tools/call` 请求验证

**完成判定**：MCP stdio 协议要求先完成 `initialize` handshake（含 `notifications/initialized` 通知）才能调 `tools/list` / `tools/call`——裸的 `echo '{...}' | python -m scm_mcp` 不会返回任何东西，会一直挂起等待。用下面脚本跑完整握手：

```bash
python -c "
import asyncio, json, sys

async def main():
    proc = await asyncio.create_subprocess_exec(
        sys.executable, '-m', 'scm_mcp',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    proc.stdin.write((json.dumps({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'t','version':'0.1'}}}) + chr(10)).encode())
    await proc.stdin.drain()
    await asyncio.wait_for(proc.stdout.readline(), timeout=10)
    proc.stdin.write((json.dumps({'jsonrpc':'2.0','method':'notifications/initialized','params':{}}) + chr(10)).encode())
    await proc.stdin.drain()

    proc.stdin.write((json.dumps({'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}) + chr(10)).encode())
    await proc.stdin.drain()
    resp = await asyncio.wait_for(proc.stdout.readline(), timeout=10)
    print(resp.decode())
    proc.terminate(); await proc.wait()

asyncio.run(main())
"
```
返回的 tools 数组中包含 `list_addresses`，且其 `inputSchema` 字段名与 DESIGN.md 表格一致（`name`, `folder`, `snippet`, `device`, `offset`, `limit` 均为可选）。用同样的握手脚本，把最后的 `tools/list` 请求换成 `{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'list_addresses','arguments':{'folder':'Shared','limit':5}}}`，验证返回合法 JSON-RPC 响应，`result.content[0].text` 中含 SCM 返回的 `data`/`total` 字段（真实凭据下）或结构化错误 `{"error": "...", "detail": "..."}`（无凭据/凭据无效时）。

---

## Phase 4 — 按 DESIGN.md 扩展全部 Tool

**输入**: Phase 3 完成，MCP 链路已验证可用
**任务**: 按 DESIGN.md 各节表格顺序实现，**每加一个 tool 前先重新读一次对应 YAML 片段**，禁止凭記憶/上一个 tool 的结构类推字段。建议顺序：

1. `tools/objects.py` 剩余条目（address-groups → applications → services → tags）
2. `tools/security.py`（security-rules 优先，Profile 类 List 次之）
3. `tools/deployment.py`（remote-networks → service-connections → 其余）
4. `tools/operations.py`（jobs → config-versions；`push_candidate_config` 最后实现，且需在 tool 描述中加风险提示）
5. `tools/iam.py`（service-accounts → roles → access-policies）

**完成判定**（每个模块提交前跑一次，比走 stdio 子进程更快，等价于 Phase 0 的 import 判定）:
```bash
python -c "
from scm_mcp import server
names = sorted(server.mcp._tool_manager._tools.keys())
print(len(names), 'tools registered')
for n in names: print(' -', n)
"
```
数量与 DESIGN.md 当前已实现的表格行数一致（不多不少——多了说明有未文档化的 tool，少了说明漏注册）。当前实现（Phase 4 首批范围）应为 **73**：Objects 25 + Security 12 + Deployment 13 + Operations 7 + IAM 16。

**回归判定**（全部模块完成后）:
- 对每个 `list_*` tool 跑一次真实调用（需测试租户凭据），确认返回字段名与该 YAML `200 response schema` 完全一致，无额外臆造字段、无缺失必填字段。
- 对每个 `create_*` / `update_*` tool，构造一条最小合法 body（只含 schema `required` 字段），确认 SCM 返回 201/200 而非 400（400 说明字段名或必填项与 YAML 不符）。

---

## 变更纪律

- DESIGN.md 的映射表是唯一真源。若实现中发现某 YAML 字段与 DESIGN.md 记录不一致（例如 YAML 更新过），**先改 DESIGN.md，再改代码**，两者必须同步提交。
- 任何新增 tool 若其 YAML 来源不在 CLAUDE.md「禁止事项」允许范围内（即字段来自臆造而非 YAML），视为违反 L1 契约，需打回重做。
