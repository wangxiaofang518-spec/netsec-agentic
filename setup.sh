#!/usr/bin/env bash
# ============================================================
# setup.sh — one-click restore of all 7 MCP servers on a new machine (macOS / Ubuntu / Linux / Git Bash)
#
# Easiest — take all 8 keys from the encrypted secrets bundle:
#   bash secrets/unseal.sh                       # asks for the bundle passphrase
#   bash setup.sh --from-env-file secrets-plain/server/opt/netsec-agent/secrets/agent.env
#
# Or pass the keys explicitly:
#   bash setup.sh --scm-secret "xxx" --koi-key "xxx" \
#                 --airs-key "xxx" --mgmt-secret "xxx" \
#                 --sase-external-gw-key "xxx" --scvm-aws-hk-key "xxx" \
#                 --scvm-aws-sg-key "xxx" --aivm-alibaba-key "xxx"
#   (explicit flags win over --from-env-file)
#
# All fixed settings (client IDs, TSG IDs, NGFW hosts) are built in; only the 8 keys are needed.
#
# 7 MCP servers:
#   scm                     Strata Cloud Manager
#   koi                     KOI software supply-chain security
#   prisma-airs             Prisma AIRS AI security
#   panos-sase-external-gw  PAN-OS NGFW — Azure GP gateway       203.0.113.21  (PAVM300-Branch-GPGW-SH)
#   panos-scvm-aws-hk       PAN-OS NGFW — AWS Prisma SC (HK)     203.0.113.22  (PAVM100-PrismaSC-HK)
#   panos-scvm-aws-sg       PAN-OS NGFW — AWS Prisma SC (SG)     203.0.113.23  (PAVM100-PrismaSC-SG)
#   panos-aivm-alibaba      PAN-OS NGFW — Alibaba Cloud security VM 203.0.113.24 (AI-SECVM-Branch-Alibaba-CN)
# ============================================================

set -euo pipefail

# ── Defaults — override each of them in your env file (--from-env-file) ──
SCM_CLIENT_ID="<your-service-account>@<your-tsg-id>.iam.panserviceaccount.com"
SCM_TSG_ID="<your-tsg-id>"
PANW_MGMT_CLIENT_ID="<your-service-account>@<your-tsg-id>.iam.panserviceaccount.com"
PANW_MGMT_TSG_ID="<your-airs-tsg-id>"
SASE_EXTERNAL_GW_HOST="203.0.113.21"
SCVM_AWS_HK_HOST="203.0.113.22"
SCVM_AWS_SG_HOST="203.0.113.23"
AIVM_ALIBABA_HOST="203.0.113.24"

# ── Arguments ────────────────────────────────────────────────
SCM_SECRET=""
KOI_KEY=""
AIRS_KEY=""
MGMT_SECRET=""
SASE_EXTERNAL_GW_KEY=""
SCVM_AWS_HK_KEY=""
SCVM_AWS_SG_KEY=""
AIVM_ALIBABA_KEY=""
ENV_FILE=""

usage() {
    echo "Usage: bash setup.sh --from-env-file <agent.env>"
    echo "   or: bash setup.sh --scm-secret <val> --koi-key <val> --airs-key <val> \\"
    echo "                     --mgmt-secret <val> --sase-external-gw-key <val> \\"
    echo "                     --scvm-aws-hk-key <val> --scvm-aws-sg-key <val> --aivm-alibaba-key <val>"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-env-file)     ENV_FILE="$2";          shift 2 ;;
        --scm-secret)        SCM_SECRET="$2";        shift 2 ;;
        --koi-key)           KOI_KEY="$2";           shift 2 ;;
        --airs-key)          AIRS_KEY="$2";          shift 2 ;;
        --mgmt-secret)       MGMT_SECRET="$2";       shift 2 ;;
        --sase-external-gw-key|--gpgw-azure-key)    SASE_EXTERNAL_GW_KEY="$2";    shift 2 ;;   # old flag name still accepted
        --scvm-aws-hk-key)   SCVM_AWS_HK_KEY="$2";   shift 2 ;;
        --scvm-aws-sg-key)   SCVM_AWS_SG_KEY="$2";   shift 2 ;;
        --aivm-alibaba-key)  AIVM_ALIBABA_KEY="$2";  shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# --from-env-file: read keys from a netsec-agent agent.env (unsealed from secrets/secrets.tar.gz.enc)
if [[ -n "$ENV_FILE" ]]; then
    [[ -f "$ENV_FILE" ]] || { echo "ERROR: env file not found: $ENV_FILE"; exit 1; }
    envval() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r"' || true; }
    SCM_SECRET="${SCM_SECRET:-$(envval SCM_CLIENT_SECRET)}"
    KOI_KEY="${KOI_KEY:-$(envval KOI_API_KEY)}"
    AIRS_KEY="${AIRS_KEY:-$(envval PANW_AI_SEC_API_KEY)}"
    MGMT_SECRET="${MGMT_SECRET:-$(envval PANW_MGMT_CLIENT_SECRET)}"
    SASE_EXTERNAL_GW_KEY="${SASE_EXTERNAL_GW_KEY:-$(envval PANOS_API_KEY_SASE_EXTERNAL_GW)}"
    [[ -n "$SASE_EXTERNAL_GW_KEY" ]] || SASE_EXTERNAL_GW_KEY="$(envval PANOS_API_KEY_GPGW_AZURE)"   # pre-rename env files
    SCVM_AWS_HK_KEY="${SCVM_AWS_HK_KEY:-$(envval PANOS_API_KEY_SCVM_AWS_HK)}"
    SCVM_AWS_SG_KEY="${SCVM_AWS_SG_KEY:-$(envval PANOS_API_KEY_SCVM_AWS_SG)}"
    AIVM_ALIBABA_KEY="${AIVM_ALIBABA_KEY:-$(envval PANOS_API_KEY_AIVM_ALIBABA)}"
    # optional overrides of the "fixed settings" (tenant IDs, firewall hosts) for other environments
    ov() { local v; v="$(envval "$1")"; [[ -n "$v" ]] && printf -v "$2" '%s' "$v"; return 0; }
    ov SCM_CLIENT_ID SCM_CLIENT_ID; ov SCM_TSG_ID SCM_TSG_ID; ov PANW_MGMT_CLIENT_ID PANW_MGMT_CLIENT_ID; ov PANW_MGMT_TSG_ID PANW_MGMT_TSG_ID
    ov PANOS_HOST_SASE_EXTERNAL_GW SASE_EXTERNAL_GW_HOST; ov PANOS_HOST_SCVM_AWS_HK SCVM_AWS_HK_HOST
    ov PANOS_HOST_SCVM_AWS_SG SCVM_AWS_SG_HOST; ov PANOS_HOST_AIVM_ALIBABA AIVM_ALIBABA_HOST
    echo "Loaded keys from $ENV_FILE"
fi
for v in SCM_CLIENT_ID SCM_TSG_ID PANW_MGMT_CLIENT_ID PANW_MGMT_TSG_ID SASE_EXTERNAL_GW_HOST SCVM_AWS_HK_HOST SCVM_AWS_SG_HOST AIVM_ALIBABA_HOST; do
    [[ -z "${!v}" || "${!v}" == *"<"* ]] && { echo "ERROR: $v is not set — put it in your env file (see netsec-agent/secrets/agent.env.example)"; exit 1; }
done

[[ -z "$SCM_SECRET"           ]] && { echo "ERROR: --scm-secret is required";           usage; }
[[ -z "$KOI_KEY"              ]] && { echo "ERROR: --koi-key is required";              usage; }
[[ -z "$AIRS_KEY"             ]] && { echo "ERROR: --airs-key is required";             usage; }
[[ -z "$MGMT_SECRET"          ]] && { echo "ERROR: --mgmt-secret is required";          usage; }
[[ -z "$SASE_EXTERNAL_GW_KEY" ]] && { echo "ERROR: --sase-external-gw-key is required"; usage; }
[[ -z "$SCVM_AWS_HK_KEY"      ]] && { echo "ERROR: --scvm-aws-hk-key is required";      usage; }
[[ -z "$SCVM_AWS_SG_KEY"      ]] && { echo "ERROR: --scvm-aws-sg-key is required";      usage; }
[[ -z "$AIVM_ALIBABA_KEY"     ]] && { echo "ERROR: --aivm-alibaba-key is required";     usage; }

# ── Tool detection ───────────────────────────────────────────
detect_python() {
    for cmd in python3 python; do
        if command -v "$cmd" &>/dev/null; then
            ver=$("$cmd" -c "import sys; print(sys.version_info >= (3,11))" 2>/dev/null)
            if [[ "$ver" == "True" ]]; then echo "$cmd"; return; fi
        fi
    done
    echo "ERROR: Python 3.11+ not found. Install it first." >&2; exit 1
}

detect_node() {
    if command -v node &>/dev/null; then echo "node"; return; fi
    echo "ERROR: Node.js not found. Install it first (https://nodejs.org)." >&2; exit 1
}

detect_claude() {
    for p in \
        "$HOME/.local/bin/claude" \
        "/usr/local/bin/claude" \
        "/opt/homebrew/bin/claude" \
        "$(command -v claude 2>/dev/null || true)"; do
        [[ -x "$p" ]] && { echo "$p"; return; }
    done
    echo "ERROR: Claude CLI not found. Install Claude Code first." >&2; exit 1
}

PYTHON=$(detect_python)
NODE=$(detect_node)
CLAUDE=$(detect_claude)
NPM_MODULES=$(npm root -g)

echo ""
echo "=== Detected environment ==="
echo "  Python : $PYTHON ($("$PYTHON" --version))"
echo "  Node   : $NODE ($(node --version))"
echo "  Claude : $CLAUDE"
echo "  npm modules: $NPM_MODULES"
echo ""

# ── Step 1: install scm-mcp Python package ───────────────────
echo "=== Step 1: install scm-mcp Python package ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
"$PYTHON" -m pip install -e . -q
"$PYTHON" -c "from scm_mcp import server; print('scm-mcp tools:', len(server.mcp._tool_manager._tools))"

# ── Step 2: install KOI MCP server ───────────────────────────
echo ""
echo "=== Step 2: install KOI MCP server ==="
npm install -g koi-mcp-server

# ── Step 3: install Prisma AIRS MCP server ───────────────────
echo ""
echo "=== Step 3: install Prisma AIRS MCP server ==="
npm install -g prisma-airs-ops-mcp-server

# ── Step 4: install PAN-OS NGFW MCP server (one package shared by all 4 firewalls) ──
echo ""
echo "=== Step 4: install PAN-OS NGFW MCP server ==="
npm install -g "@iflow-mcp/apius-tech-panos-mcp"

# ── Step 5: register all MCP servers with Claude Code ────────
echo ""
echo "=== Step 5: register MCP servers ==="

KOI_INDEX="$NPM_MODULES/koi-mcp-server/dist/index.js"
AIRS_INDEX="$NPM_MODULES/prisma-airs-ops-mcp-server/dist/index.js"
PANOS_INDEX="$NPM_MODULES/@iflow-mcp/apius-tech-panos-mcp/dist/index.js"

"$CLAUDE" mcp add scm \
    -e SCM_CLIENT_ID="$SCM_CLIENT_ID" \
    -e SCM_CLIENT_SECRET="$SCM_SECRET" \
    -e SCM_TSG_ID="$SCM_TSG_ID" \
    -- "$PYTHON" -m scm_mcp

"$CLAUDE" mcp add koi \
    -e KOI_API_KEY="$KOI_KEY" \
    -- "$NODE" "$KOI_INDEX"

"$CLAUDE" mcp add prisma-airs \
    -e PANW_AI_SEC_API_KEY="$AIRS_KEY" \
    -e PANW_MGMT_CLIENT_ID="$PANW_MGMT_CLIENT_ID" \
    -e PANW_MGMT_CLIENT_SECRET="$MGMT_SECRET" \
    -e PANW_MGMT_TSG_ID="$PANW_MGMT_TSG_ID" \
    -- "$NODE" "$AIRS_INDEX"

"$CLAUDE" mcp add panos-sase-external-gw \
    -e PANOS_HOST="$SASE_EXTERNAL_GW_HOST" \
    -e PANOS_API_KEY="$SASE_EXTERNAL_GW_KEY" \
    -- "$NODE" "$PANOS_INDEX"

"$CLAUDE" mcp add panos-scvm-aws-hk \
    -e PANOS_HOST="$SCVM_AWS_HK_HOST" \
    -e PANOS_API_KEY="$SCVM_AWS_HK_KEY" \
    -- "$NODE" "$PANOS_INDEX"

"$CLAUDE" mcp add panos-scvm-aws-sg \
    -e PANOS_HOST="$SCVM_AWS_SG_HOST" \
    -e PANOS_API_KEY="$SCVM_AWS_SG_KEY" \
    -- "$NODE" "$PANOS_INDEX"

"$CLAUDE" mcp add panos-aivm-alibaba \
    -e PANOS_HOST="$AIVM_ALIBABA_HOST" \
    -e PANOS_API_KEY="$AIVM_ALIBABA_KEY" \
    -- "$NODE" "$PANOS_INDEX"

# ── Step 6: verify ───────────────────────────────────────────
echo ""
echo "=== Step 6: verify connections ==="
"$CLAUDE" mcp list

echo ""
echo "✅ Done! All 7 MCP servers should show Connected:"
echo "   scm / koi / prisma-airs / panos-sase-external-gw / panos-scvm-aws-hk / panos-scvm-aws-sg / panos-aivm-alibaba"
echo "   (restart Claude Code to load them)"
