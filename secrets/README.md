# Secrets bundle tooling · 密钥包工具

Keep **your own** credentials (model endpoint token, MCP API keys, server env files, TLS keys, SSH key) in **one encrypted file**, so the repository can be shared while only people with the passphrase can restore. This public copy contains the tooling only; no bundle is included.

Encryption: AES-256-CBC, PBKDF2-SHA256 with 600,000 iterations, random salt, via `openssl` (Git Bash on Windows, macOS, Linux).

## Create your bundle

```bash
mkdir -p secrets-plain/server/opt/netsec-agent/secrets secrets-plain/server/opt/topo/secrets secrets-plain/ssh
cp my.env secrets-plain/server/opt/netsec-agent/secrets/agent.env      # your filled-in agent.env
cp my-topo.env secrets-plain/server/opt/topo/secrets/topo.env
cp ~/.ssh/server-ssh-key.pem secrets-plain/ssh/
# or pull the live files from your server:  NETSEC_HOST=<server> bash secrets/collect.sh --key <ssh-key>
bash secrets/seal.sh                  # asks for a passphrase → secrets/secrets.tar.gz.enc (self-checked)
rm -rf secrets-plain
```

Commit `secrets/secrets.tar.gz.enc` to a **private** repository only. `secrets-plain/`, `*.pem` and passphrase files are git-ignored.

## Restore

```bash
bash secrets/unseal.sh                                                    # → secrets-plain/ (chmod 600)
bash setup.sh --from-env-file secrets-plain/server/opt/netsec-agent/secrets/agent.env
NETSEC_HOST=<server> ./deploy/deploy-platform.sh --with-secrets ...       # also restores agent.env + topo.env
rm -rf secrets-plain
```

Rules: share the passphrase out-of-band, only with people allowed to restore. Anyone who ever had it can decrypt older bundles in git history, so when someone leaves, rotate the keys themselves, not just the passphrase.

---

用一个加密文件保存**你自己的**全部凭据（模型端点 token、MCP API Key、服务器 env 文件、TLS 私钥、SSH 私钥）：仓库可以共享，只有持口令的人能恢复。本公开版只含工具，不含任何密钥包。按上面的命令创建（`seal.sh`）与恢复（`unseal.sh`）；加密包只提交到**私有**仓库；口令走带外渠道。
