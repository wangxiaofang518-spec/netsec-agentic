#!/usr/bin/env bash
# unseal.sh — decrypt secrets/secrets.tar.gz.enc into secrets-plain/ (git-ignored, files chmod 600)
#
# Passphrase source (first that is set):
#   --pass-file <file>   |   env NETSEC_SECRETS_PASS   |   interactive prompt
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLAIN="$REPO/secrets-plain"
IN="$REPO/secrets/secrets.tar.gz.enc"
PASSFILE=""
[[ "${1:-}" == "--pass-file" ]] && PASSFILE="$2"

[[ -f "$IN" ]] || { echo "missing $IN"; exit 1; }
if [[ -n "$PASSFILE" ]]; then PASSARG="file:$PASSFILE"
elif [[ -n "${NETSEC_SECRETS_PASS:-}" ]]; then PASSARG="env:NETSEC_SECRETS_PASS"
else read -rsp "Bundle passphrase: " P; echo; export NETSEC_SECRETS_PASS="$P"; PASSARG="env:NETSEC_SECRETS_PASS"; fi

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "$PASSARG" -in "$IN" | tar -xzf - -C "$STAGE" 2>/dev/null; then
  echo "decryption failed — wrong passphrase?"; exit 1
fi
rm -rf "$PLAIN"; mkdir -p "$PLAIN"; cp -R "$STAGE"/. "$PLAIN"/
find "$PLAIN" -type f -exec chmod 600 {} \; 2>/dev/null || true
echo "unsealed $(find "$PLAIN" -type f | wc -l | tr -d ' ') files → secrets-plain/   (see secrets-plain/MANIFEST.md)"
echo "remember: secrets-plain/ is git-ignored; delete it when you no longer need it (rm -rf secrets-plain)"
