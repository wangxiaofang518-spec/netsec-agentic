# NetSec-Agentic 容器
# node22 base + python3（跑 scm-mcp）+ 全局 panos npm 包 + Agent SDK + elk-mcp 依赖
FROM node:22-bookworm-slim

# —— 系统依赖：python3 + pip（scm-mcp 是 Python MCP）——
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# —— 全局安装 MCP npm 包：PAN-OS(4台共用) + KOI + Prisma-AIRS ——
RUN npm install -g @iflow-mcp/apius-tech-panos-mcp koi-mcp-server prisma-airs-ops-mcp-server

# —— Agent SDK + elk-mcp 的 MCP SDK 依赖 ——
COPY package.json ./
RUN npm install \
    && npm install @modelcontextprotocol/sdk

# —— 装入 scm-mcp（Python MCP，可编辑安装）——
# 构建上下文需包含 scm-mcp（见 compose build.context 或部署时并列拷贝）
COPY scm-mcp /app/scm-mcp
# 仅安装；不在构建期 import server（server.py 顶层会实例化 ScmClient→读 SCM_CLIENT_ID，
# 而凭据是运行时经 env_file 注入的，构建期不存在，import 必崩）。
RUN pip3 install --break-system-packages -e /app/scm-mcp \
    && python3 -c "import scm_mcp; print('scm-mcp installed OK')"

# —— 应用代码 ——
COPY agent /app/agent
COPY elk-mcp /app/elk-mcp
COPY public /app/public

# 让 mcp.mjs 里的默认 PANOS_MCP_INDEX 命中全局包路径
ENV PANOS_MCP_INDEX=/usr/local/lib/node_modules/@iflow-mcp/apius-tech-panos-mcp/dist/index.js
ENV ELK_MCP_INDEX=/app/elk-mcp/index.mjs
ENV PYTHON_BIN=python3
ENV NODE_BIN=node
ENV HTTP_PORT=8081
ENV AUDIT_DIR=/app/audit
# Claude Code CLI 需要一个可写的 HOME；且 --dangerously-skip-permissions(=bypassPermissions)
# 拒绝以 root 运行——故切到内置非 root 用户 node(uid 1000)。
ENV HOME=/home/node

# 建审计目录 + 交出 /app 所有权给 node（audit 卷在 compose 里也会挂，宿主侧需可写）
RUN mkdir -p /app/audit /home/node \
    && chown -R node:node /app /home/node

USER node

EXPOSE 8081
CMD ["node", "agent/server.mjs"]
