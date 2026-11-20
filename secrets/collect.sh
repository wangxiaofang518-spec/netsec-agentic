#!/usr/bin/env bash
# collect.sh — refresh secrets-plain/ from the live environment (run after rotating any key), then run seal.sh.
#
# Pulls from the server: /opt/netsec-agent/secrets/agent.env, /opt/topo/secrets/topo.env, /opt/elk/certs/*
# Keeps whatever is already in secrets-plain/mcp-configs/ and secrets-plain/ssh/ (unseal first to start from the bundle).
#
# Usage: secrets/collect.sh [--host 203.0.113.10] [--port 3333] [--key <ssh-private-key>]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLAIN="$REPO/secrets-plain"
HOST="${NETSEC_HOST:-}"; PORT="${NETSEC_SSH_PORT:-22}"
KEY="$PLAIN/ssh/server-ssh-key.pem"
[[ -f "$KEY" ]] || KEY="$REPO/../server-ssh-key.pem"
while [[ $# -gt 0 ]]; do case "$1" in --host) HOST="$2"; shift 2;; --port) PORT="$2"; shift 2;; --key) KEY="$2"; shift 2;; *) echo "unknown arg $1"; exit 2;; esac; done
[[ -n "$HOST" ]] || { echo "set the server with --host <addr> or NETSEC_HOST"; exit 1; }
SCP=(scp -q -i "$KEY" -P "$PORT" -o BatchMode=yes)

mkdir -p "$PLAIN/server/opt/netsec-agent/secrets" "$PLAIN/server/opt/topo/secrets" "$PLAIN/server/opt/elk/certs" "$PLAIN/ssh" "$PLAIN/mcp-configs"
"${SCP[@]}" "root@$HOST:/opt/netsec-agent/secrets/agent.env" "$PLAIN/server/opt/netsec-agent/secrets/agent.env"
"${SCP[@]}" "root@$HOST:/opt/topo/secrets/topo.env"         "$PLAIN/server/opt/topo/secrets/topo.env"
"${SCP[@]}" "root@$HOST:/opt/elk/certs/*"                  "$PLAIN/server/opt/elk/certs/"
[[ -f "$PLAIN/ssh/$(basename "$KEY")" ]] || cp "$KEY" "$PLAIN/ssh/"
find "$PLAIN" -type f -exec chmod 600 {} \; 2>/dev/null || true
echo "collected → secrets-plain/ ($(find "$PLAIN" -type f | wc -l | tr -d ' ') files). Next: secrets/seal.sh"
