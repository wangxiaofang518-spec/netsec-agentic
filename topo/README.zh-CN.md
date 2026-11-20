# 动态网络安全拓扑监控（topo）

> English: [README.md](README.md)

把静态拓扑图升级为**实时监控图**：3 台 NGFW 状态灯、IPSec/SC/RN 隧道 up/down、BGP 邻居、CPU/内存/会话/在线 GP、流量速率、威胁计数，30 秒自动刷新。**仅内网/本地访问，不发公网、无 TLS/认证。**

## 架构
单容器 `topo`（`python:3.12-slim` + requests）：
- 主线程 stdlib http 托管 `web/`（绑 `127.0.0.1:8080`）
- 后台线程每 30s 轮询 3 台 NGFW XML API（只读 show）+ 查本机 ES 聚合 → 原子写 `web/status.json`
- 接入现有 `elk_elk` 网络访问 `elasticsearch:9200`；**不改 `/opt/elk` 任何文件**

数据分级：NGFW（真动）· Prisma（由隧道/BGP/SLS 推断）· AIRS/KOI/aws-sg/dc-hk（静态，服务器无云凭据）。

## 部署（服务器 /opt/topo）
```bash
cd /opt/topo
cp secrets/topo.env.example secrets/topo.env
# 填入 3 个 PANOS_API_KEY_*（Base64，只读），保存
chmod 600 secrets/topo.env
docker compose -p topo up -d --build
docker logs -f topo          # 看 "snapshot written: N nodes up"
curl -s 127.0.0.1:8080/status.json | python3 -m json.tool
```

## 访问（工作站）
```bash
ssh -i <key> -p 3333 -L 8080:127.0.0.1:8080 root@203.0.113.10
# 浏览器打开 http://localhost:8080
```

## 校准解析（首次部署后，只读）
PAN-OS 各命令返回结构因版本而异。用 probe 打印真实 XML，据此微调 app.py 解析：
```bash
docker compose -p topo run --rm topo python -u app.py --probe
```

## 回滚 / 停止
```bash
docker compose -p topo down          # 干净移除，不影响 ELK
```

## 安全
- `secrets/topo.env` 已 gitignore，含 API key，`chmod 600`，绝不 commit。
- 建议为采集器单建**只读 RBAC** API key（只需 show），不复用全权限 key。
- 8080 绑 loopback；要内网 LAN 访问再改 `0.0.0.0` + 云安全组放行。
- 本项目不修改 ELK 的 9200/5601 裸暴露（既有隐患，另行处理）。


## 登录门禁

本服务对外提供的一切（页面、`status.json`、到 agent 的 `/api/*` 反代）都在服务端会话登录之后，实现在 `collector/app.py`。默认账号密码 **`admin` / *(your `TOPO_AUTH_PASS`)***。

- 无需登录即可访问：`/login.html`、`/assets/*`、`/auth/*`。未登录访问页面会跳转到登录页；其他请求返回 `401`（`web/auth-guard.js` 会把浏览器带到登录页）。
- 会话：随机 token，`HttpOnly; SameSite=Lax` cookie，12 小时。退出：页头 ⎋ 按钮或 `/auth/logout`。
- 防爆破：同一客户端地址 5 分钟内失败 10 次 → 等待 5 分钟。
- 配置在 `secrets/topo.env`：`TOPO_AUTH_USER`、`TOPO_AUTH_PASS`、`TOPO_SESSION_TTL`；`TOPO_AUTH=off` 为应急开关（行为与之前完全一致）。生效：`docker compose -p topo up -d`。
- 纯 HTTP：cookie 无法带 `Secure`。请保留服务器前面的源地址白名单；如需更大范围开放，请在前面加 TLS。
