#!/usr/bin/env bash
# seal.sh — encrypt secrets-plain/ into secrets/secrets.tar.gz.enc (AES-256-CBC, PBKDF2 600k iterations)
#
# Passphrase source (first that is set):
#   --pass-file <file>   |   env NETSEC_SECRETS_PASS   |   interactive prompt (asked twice)
# Works with Git Bash (Windows), macOS, Linux — needs OpenSSL >= 1.1.1 (macOS: brew install openssl if LibreSSL fails).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLAIN="$REPO/secrets-plain"
OUT="$REPO/secrets/secrets.tar.gz.enc"
PASSFILE=""
[[ "${1:-}" == "--pass-file" ]] && PASSFILE="$2"

[[ -d "$PLAIN" ]] || { echo "nothing to seal: $PLAIN does not exist (run secrets/unseal.sh or secrets/collect.sh first)"; exit 1; }

if [[ -n "$PASSFILE" ]]; then PASSARG="file:$PASSFILE"
elif [[ -n "${NETSEC_SECRETS_PASS:-}" ]]; then PASSARG="env:NETSEC_SECRETS_PASS"
else
  read -rsp "New bundle passphrase: " P1; echo; read -rsp "Repeat passphrase: " P2; echo
  [[ "$P1" == "$P2" && ${#P1} -ge 12 ]] || { echo "passphrases differ or shorter than 12 chars"; exit 1; }
  export NETSEC_SECRETS_PASS="$P1"; PASSARG="env:NETSEC_SECRETS_PASS"
fi

TMP="$OUT.tmp"
tar -czf - -C "$PLAIN" . | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "$PASSARG" -out "$TMP"
# self-check: the new bundle must decrypt and list with the same passphrase before replacing the old one
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "$PASSARG" -in "$TMP" | tar -tzf - >/dev/null
mv "$TMP" "$OUT"
echo "sealed $(find "$PLAIN" -type f | wc -l | tr -d ' ') files → secrets/secrets.tar.gz.enc ($(wc -c < "$OUT" | tr -d ' ') bytes)"
echo "next: git add secrets/secrets.tar.gz.enc && git commit -m 'chore(secrets): update encrypted bundle'"
