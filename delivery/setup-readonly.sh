#!/usr/bin/env bash
# ============================================================
# setup-readonly.sh — NetSec Agentic 只读版部署 (macOS/Linux)
#
# 面向客户:用客户自己的【只读 RBAC 凭据】注册 MCP Server,
# 实现对话式只读诊断。变更能力由客户侧只读角色在设备端拦截。
#
# 用法(NGFW 可重复 --panos-host-N/--panos-key-N,支持 1~N 台):
#   bash setup-readonly.sh \
#     --scm-client-id "..." --scm-secret "..." --scm-tsg-id "..." \
#     --panos-name-1 "fw-hq"  --panos-host-1 "10.0.0.1" --panos-key-1 "KEY1" \
#     --panos-name-2 "fw-dc"  --panos-host-2 "10.0.0.2" --panos-key-2 "KEY2" \
#     [--airs-key "..." --airs-tsg-id "..."]
#
# 重要:传入的凭据必须是客户侧配置的【只读】角色所生成。
# 只读的强制来自 RBAC 权限,不是本脚本。见 01-READONLY-SECURITY-MODEL.md
# ============================================================
set -euo pipefail

SCM_CLIENT_ID=""; SCM_SECRET=""; SCM_TSG_ID=""
AIRS_KEY=""; AIRS_TSG_ID=""; AIRS_CLIENT_ID=""
declare -a PANOS_NAMES=(); declare -a PANOS_HOSTS=(); declare -a PANOS_KEYS=()

usage() {
  echo "Usage: bash setup-readonly.sh --scm-client-id <id> --scm-secret <s> --scm-tsg-id <t> \\"
  echo "         --panos-name-N <name> --panos-host-N <ip> --panos-key-N <readonly-key>  (可重复 N=1..)"
  echo "         [--airs-key <k> --airs-client-id <id> --airs-tsg-id <t>]"
  exit 1
}

# 解析:支持 --panos-name-1 / --panos-host-1 / --panos-key-1 这类带序号参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scm-client-id) SCM_CLIENT_ID="$2"; shift 2;;
    --scm-secret)    SCM_SECRET="$2";    shift 2;;
    --scm-tsg-id)    SCM_TSG_ID="$2";    shift 2;;
    --airs-key)      AIRS_KEY="$2";      shift 2;;
    --airs-client-id) AIRS_CLIENT_ID="$2"; shift 2;;
    --airs-tsg-id)   AIRS_TSG_ID="$2";   shift 2;;
    --panos-name-*)  idx="${1##*-}"; PANOS_NAMES[$idx]="$2"; shift 2;;
    --panos-host-*)  idx="${1##*-}"; PANOS_HOSTS[$idx]="$2"; shift 2;;
    --panos-key-*)   idx="${1##*-}"; PANOS_KEYS[$idx]="$2";  shift 2;;
    *) echo "Unknown: $1"; usage;;
  esac
done

[[ -z "$SCM_CLIENT_ID" || -z "$SCM_SECRET" || -z "$SCM_TSG_ID" ]] && { echo "ERROR: SCM 三个参数必填"; usage; }

# ── 工具检测 ──
detect() { for c in "$@"; do command -v "$c" &>/dev/null && { echo "$c"; return; }; done; echo "ERROR: 缺少 $*" >&2; exit 1; }
PYTHON=$(detect python3 python); NODE=$(detect node); CLAUDE=$(detect claude)
NPM_MODULES=$(npm root -g)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"  # 仓库根

echo "=== 环境: Python=$PYTHON Node=$NODE Claude=$CLAUDE ==="

# ── 装依赖 ──
echo "=== 安装 scm-mcp + MCP 包 ==="
cd "$SCRIPT_DIR"
"$PYTHON" -m pip install -e . -q
npm install -g prisma-airs-ops-mcp-server "@iflow-mcp/apius-tech-panos-mcp" >/dev/null 2>&1 || true

AIRS_INDEX="$NPM_MODULES/prisma-airs-ops-mcp-server/dist/index.js"
PANOS_INDEX="$NPM_MODULES/@iflow-mcp/apius-tech-panos-mcp/dist/index.js"

# ── 注册 scm(只读凭据)──
echo "=== 注册 scm (只读) ==="
"$CLAUDE" mcp add scm \
  -e SCM_CLIENT_ID="$SCM_CLIENT_ID" -e SCM_CLIENT_SECRET="$SCM_SECRET" -e SCM_TSG_ID="$SCM_TSG_ID" \
  -- "$PYTHON" -m scm_mcp

# ── 注册 prisma-airs(可选)──
if [[ -n "$AIRS_KEY" ]]; then
  echo "=== 注册 prisma-airs ==="
  "$CLAUDE" mcp add prisma-airs \
    -e PANW_AI_SEC_API_KEY="$AIRS_KEY" \
    -e PANW_MGMT_CLIENT_ID="${AIRS_CLIENT_ID:-$SCM_CLIENT_ID}" \
    -e PANW_MGMT_CLIENT_SECRET="$SCM_SECRET" \
    -e PANW_MGMT_TSG_ID="${AIRS_TSG_ID:-$SCM_TSG_ID}" \
    -- "$NODE" "$AIRS_INDEX"
fi

# ── 注册每台 NGFW(只读 API Key)──
for i in "${!PANOS_HOSTS[@]}"; do
  name="${PANOS_NAMES[$i]:-panos-$i}"; host="${PANOS_HOSTS[$i]}"; key="${PANOS_KEYS[$i]}"
  [[ -z "$host" || -z "$key" ]] && continue
  echo "=== 注册 NGFW: $name ($host) [只读] ==="
  "$CLAUDE" mcp add "$name" -e PANOS_HOST="$host" -e PANOS_API_KEY="$key" -- "$NODE" "$PANOS_INDEX"
done

echo ""
echo "=== 验证 ==="
"$CLAUDE" mcp list
echo ""
echo "✅ 只读版部署完成。"
echo "⚠️  下一步必做:在 Claude 里让 Agent 试一次变更(如新建测试对象),确认被设备以'只读/权限不足'拒绝。"
echo "    这是唯一可信的只读证明。见 delivery/02-CLIENT-DEPLOY.md 第四步。"
