#!/usr/bin/env bash
# =============================================================================
# deploy-platform.sh — one-click deploy / restore of the NetSec-Agentic platform
#
# Pushes THIS repo's version of the platform to the server and restarts it:
#   topo/          → /opt/topo          (topology page + status collector + /api proxy)
#   netsec-agent/  → /opt/netsec-agent  (agent backend, prompt, MCP wiring)
#
# Restore any earlier version:   git checkout <tag-or-commit> && ./deploy/deploy-platform.sh
#
# By default never touches secrets on the server (/opt/*/secrets/*.env stay as they are)
# and never touches ELK (/opt/elk). Every overwritten file is backed up first as
# <file>.bak-deploy-<timestamp>.
#
# --with-secrets  also restores agent.env + topo.env from the unsealed bundle
#                 (run secrets/unseal.sh first) — use when rebuilding a server or after key rotation.
#
# SSH key: --key, else secrets-plain/ssh/<key>.pem (from the bundle), else ../<key>.pem next to the repo.
# Uses only 3 SSH connections (one archive upload, one apply session, one health check), so it
# does not trip OpenSSH's per-source connection-rate penalties.
#
# Usage:
#   ./deploy/deploy-platform.sh [--host 203.0.113.10] [--port 3333] [--user root]
#                               [--key <ssh-private-key>] [--with-secrets] [--dry-run]
# =============================================================================
set -euo pipefail

HOST="${NETSEC_HOST:-}"; PORT="${NETSEC_SSH_PORT:-22}"; USER_="${NETSEC_SSH_USER:-root}"
KEYNAME=server-ssh-key.pem
KEY=""
DRY=0; WITH_SECRETS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --user) USER_="$2"; shift 2 ;;
    --key)  KEY="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --with-secrets) WITH_SECRETS=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
[[ -n "$HOST" ]] || { echo "set the server with --host <addr> or NETSEC_HOST"; exit 1; }
if [[ -z "$KEY" ]]; then
  for k in "$REPO/secrets-plain/ssh/$KEYNAME" "$REPO/../$KEYNAME"; do [[ -f "$k" ]] && { KEY="$k"; break; }; done
fi
[[ -n "$KEY" && -f "$KEY" ]] || { echo "SSH key not found — run secrets/unseal.sh (bundle contains it) or pass --key <file>"; exit 1; }
chmod 600 "$KEY" 2>/dev/null || true
TS="$(date +%Y%m%d-%H%M%S)"
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)

# retry wrapper: transient SSH refusals (e.g. connection-rate penalties) back off and retry
retry() { local n=0; until "$@"; do n=$((n+1)); [[ $n -ge 5 ]] && return 1; echo "   ssh/scp failed — retry $n/4 in $((n*15))s"; sleep $((n*15)); done; }
rssh() { retry ssh "${SSH_OPTS[@]}" -p "$PORT" "$USER_@$HOST" "$@"; }

# local path (repo-relative) → remote absolute path
FILES=(
  "topo/web/index.html:/opt/topo/web/index.html"
  "topo/web/agent-chat.js:/opt/topo/web/agent-chat.js"
  "topo/web/agent-insights.js:/opt/topo/web/agent-insights.js"
  "topo/web/topo-live.js:/opt/topo/web/topo-live.js"
  "topo/web/login.html:/opt/topo/web/login.html"
  "topo/web/auth-guard.js:/opt/topo/web/auth-guard.js"
  "topo/collector/app.py:/opt/topo/collector/app.py"
  "topo/collector/Dockerfile:/opt/topo/collector/Dockerfile"
  "topo/docker-compose.yml:/opt/topo/docker-compose.yml"
  "netsec-agent/agent/server.mjs:/opt/netsec-agent/agent/server.mjs"
  "netsec-agent/agent/mcp.mjs:/opt/netsec-agent/agent/mcp.mjs"
  "netsec-agent/agent/guard.mjs:/opt/netsec-agent/agent/guard.mjs"
  "netsec-agent/agent/system-prompt.md:/opt/netsec-agent/agent/system-prompt.md"
  "netsec-agent/elk-mcp/index.mjs:/opt/netsec-agent/elk-mcp/index.mjs"
  "netsec-agent/docker-compose.yml:/opt/netsec-agent/docker-compose.yml"
  "netsec-agent/Dockerfile:/opt/netsec-agent/Dockerfile"
  "netsec-agent/package.json:/opt/netsec-agent/package.json"
)
for a in "$REPO"/topo/web/assets/*; do FILES+=("topo/web/assets/$(basename "$a"):/opt/topo/web/assets/$(basename "$a")"); done
if [[ $WITH_SECRETS == 1 ]]; then
  for f in opt/netsec-agent/secrets/agent.env opt/topo/secrets/topo.env; do
    [[ -f "$REPO/secrets-plain/server/$f" ]] || { echo "--with-secrets: secrets-plain/server/$f missing — run secrets/unseal.sh first"; exit 1; }
    FILES+=("secrets-plain/server/$f:/$f")
  done
fi

echo "== NetSec-Agentic deploy  repo=$(git -C "$REPO" describe --tags --always --dirty 2>/dev/null || echo '?')  →  $USER_@$HOST:$PORT$([[ $WITH_SECRETS == 1 ]] && echo '  (+secrets)')"

# 1) stage a tree that mirrors the remote layout (LF line endings for text) + pre-flight checks
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/root"
REMOTE_LIST=""
for pair in "${FILES[@]}"; do
  rel="${pair%%:*}"; dst="${pair#*:}"
  [[ -f "$REPO/$rel" ]] || { echo "missing $rel"; exit 1; }
  mkdir -p "$STAGE/root$(dirname "$dst")"
  case "$rel" in
    *.png|*.jpg|*.ico) cp "$REPO/$rel" "$STAGE/root$dst" ;;
    *) sed 's/\r$//' "$REPO/$rel" > "$STAGE/root$dst" ;;
  esac
  REMOTE_LIST+=" $dst"
done
for f in "$STAGE"/root/opt/topo/web/*.js "$STAGE"/root/opt/netsec-agent/agent/*.mjs "$STAGE"/root/opt/netsec-agent/elk-mcp/index.mjs; do node --check "$f"; done
python -m py_compile "$STAGE/root/opt/topo/collector/app.py" 2>/dev/null || python3 -m py_compile "$STAGE/root/opt/topo/collector/app.py"
find "$STAGE/root" -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
echo "   pre-flight syntax checks: OK (${#FILES[@]} files)"
[[ $DRY == 1 ]] && { echo "   --dry-run: stopping before any remote change"; exit 0; }

# 2) one upload
# files only (no directory entries): extracting dir entries into / could rewrite the mode of / and /opt
(cd "$STAGE/root" && find . -type f > "$STAGE/list.txt")
tar -czf "$STAGE/payload.tgz" -C "$STAGE/root" -T "$STAGE/list.txt"
retry scp "${SSH_OPTS[@]}" -P "$PORT" -q "$STAGE/payload.tgz" "$USER_@$HOST:/tmp/netsec-deploy-$TS.tgz"
echo "   uploaded payload ($(wc -c < "$STAGE/payload.tgz" | tr -d ' ') bytes)"

# 3) one session: back up → extract → fix perms → apply.
#    topo bakes app.py into its image → rebuild (pip layer cached, ~seconds);
#    netsec-agent mounts ./agent → compose up (recreates if env/compose changed) + restart to load code.
rssh "set -e
  for f in $REMOTE_LIST; do [ -f \"\$f\" ] && cp -p \"\$f\" \"\$f.bak-deploy-$TS\"; done
  echo '   server backup: *.bak-deploy-$TS'
  tar -xzf /tmp/netsec-deploy-$TS.tgz -C / --no-same-owner --no-overwrite-dir && rm -f /tmp/netsec-deploy-$TS.tgz
  for f in /opt/netsec-agent/secrets/agent.env /opt/topo/secrets/topo.env; do [ -f \"\$f\" ] && chmod 600 \"\$f\"; done
  echo '   extracted $([[ $WITH_SECRETS == 1 ]] && echo 'code + agent.env/topo.env' || echo 'code (secrets untouched)')'
  cd /opt/topo && docker compose -p topo up -d --build 2>&1 | tail -1
  cd /opt/netsec-agent && docker compose -p netsec-agent up -d 2>&1 | tail -1 && docker restart netsec-agent >/dev/null
  sleep 15
  docker ps --format '   {{.Names}}: {{.Status}}' | grep -E 'topo|netsec-agent'"

# 4) health check through the same URL the browser uses (waits one collector cycle).
#    The page sits behind the login gate: sign in first (TOPO_AUTH_USER / TOPO_AUTH_PASS, default admin/<TOPO_AUTH_PASS>).
AU="${TOPO_AUTH_USER:-admin}"; AP="${TOPO_AUTH_PASS:?set TOPO_AUTH_PASS (the platform password) for the health check}"; BIND="${NETSEC_BIND_IP:-127.0.0.1}"
rssh "B=http://$BIND:8080; J=/tmp/nsa-health-$TS.jar; sleep 20
  code=\$(curl -s -o /dev/null -w '%{http_code}' \$B/)
  echo \"   login gate: unauthenticated / -> HTTP \$code\"
  curl -s -c \$J -H 'Content-Type: application/json' -d '{\"username\":\"$AU\",\"password\":\"$AP\"}' \$B/auth/login | grep -q '\"ok\": true' && echo '   login: OK' || echo '   login: FAILED (check TOPO_AUTH_USER/PASS)'
  curl -sf -b \$J \$B/index.html >/dev/null && echo '   page: OK'
  curl -sf -b \$J \$B/api/health | python3 -c \"import json,sys; h=json.load(sys.stdin); print('   agent: mode=%s approval=%s mcp=%d missing=%s' % (h['mode'], h.get('approval'), len(h['mcp']), h['missing'])); print('   connectors: ' + ', '.join(h['mcp']))\"
  curl -sf -b \$J \$B/status.json | python3 -c \"import json,sys; d=json.load(sys.stdin); n=d['nodes']; print('   collector: ' + ', '.join('%s=%s' % (k, n[k]['status']) for k in ('gpgw','scvm','aws-sg','aivm','prisma')))\"
  curl -s -b \$J -o /dev/null \$B/auth/logout; rm -f \$J"
echo "== done. Roll back: restore the *.bak-deploy-$TS files, or git checkout <previous tag> and re-run this script."
