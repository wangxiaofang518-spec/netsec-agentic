> 中文版: [README.zh-CN.md](README.zh-CN.md)

# ELK Log Server — Configuration Backup and Rebuild Guide

Centrally collects syslog (TRAFFIC / THREAT / SYSTEM / GLOBALPROTECT / CONFIG / HIPMATCH) from 3 PAN-OS NGFWs + Prisma Access,
using Elasticsearch + Logstash + Kibana 8.14.3 on Docker Compose.

> **This directory backs up configuration only, not log data or private keys.** The live server's certificates **and private keys** are kept in the encrypted secrets bundle (`secrets-plain/server/opt/elk/certs/` after `bash secrets/unseal.sh`, see [../secrets/README.md](../secrets/README.md)) — never in plaintext in Git.

---

## Server Information

| Item | Value |
|---|---|
| Public IP | `203.0.113.10` |
| SSH port | `3333` (root) |
| Private IP | `10.199.3.47` (NATed via the perimeter firewall) |
| OS | Ubuntu, Linux 6.8.0, x86_64 |
| Deployment path | `/opt/elk/` |
| ELK version | 8.14.3 |
| Cloud platform | Alibaba Cloud KVM, protected by `panos-aivm-alibaba` (AI-SECVM-Branch-Alibaba-CN, 203.0.113.24) |

### Ports

| Port | Purpose |
|---|---|
| 9200 | Elasticsearch HTTP (internal, no authentication, `xpack.security.enabled=false`) |
| 5601 | Kibana Web UI |
| 514/udp | Plaintext syslog ingest |
| 6514/tcp | TLS syslog ingest (self-signed CA) |
| 5044 | Reserved for Beats (currently unused) |

---

## Directory Contents

```
elk/
├── docker-compose.yml              # ES + Logstash + Kibana orchestration
├── logstash/
│   ├── config/logstash.yml         # Logstash main config
│   └── pipeline/panos.conf         # ★ PAN-OS syslog parsing pipeline (core)
├── certs-config/                   # Certificate [generation config] (not keys)
│   ├── ca.crt                      # CA public certificate (safe to share; for client trust)
│   ├── ext.cnf / server.ext        # Server certificate SAN extension config
│   └── ocsp_ca.cnf
├── es-templates/                   # Exported from the running ES; can be PUT back directly
│   ├── template_panos-*.json       # 7 index templates (field mappings)
│   └── ilm_panos-ilm-*.json        # 4 ILM lifecycle policies
└── scripts/
    └── create_dashboards.sh        # Rebuild script for the 3 Kibana dashboards
```

---

## Pipeline Key Design (panos.conf)

- **input**: UDP 514 (plaintext) + TCP 6514 (TLS, `ssl_cert`/`ssl_key` point to `/etc/logstash/certs/`)
- **filter**: grok strips the syslog header → csv splits into 68 columns → fields renamed per `log_type` → tags applied
- **output**: routed by tag to daily indices `panos-{type}-YYYY.MM.dd`
- **Two optimizations already in place** (2026/07/06):
  1. **SYSTEM noise filter**: `if [event_id] == "general" { drop { } }` — "general" accounts for 94% of SYSTEM logs and is periodic status output with no value; filtering it cuts system log volume by ~88%
  2. **HIPMATCH routing fix**: added an `else if "panos-hipmatch" in [tags]` block to output; previously, without this block, these logs were misrouted to `panos-other`

> ⚠️ **Golden rule for editing the pipeline**: Logstash `path.config` points to the entire `pipeline/` directory, and every file in that directory is concatenated into a single pipeline.
> **Never put backup files inside `pipeline/`** (otherwise the input block is loaded twice → ports 514/6514 hit `EADDRINUSE` → the pipeline crash-loops). Always put backups in `/opt/elk/backups/`.

---

## Indices and Retention Policy (ILM)

Daily indices + delete-only ILM (only deletes indices past their age limit, never rewrites data, zero loss of new logs):

| Index type | ILM policy | Retention | Avg. daily volume (after optimization) |
|---|---|---|---|
| panos-traffic | panos-ilm-30d | 30 days | ~229 MB (largest) |
| panos-threat | panos-ilm-90d | 90 days | ~50 MB |
| panos-system | panos-ilm-14d | 14 days | Sharply reduced after filtering |
| panos-globalprotect | panos-ilm-30d | 30 days | ~11 MB |
| panos-config | panos-ilm-180d | 180 days | Very small |
| panos-hipmatch | panos-ilm-14d | 14 days | Small |
| panos-other | panos-ilm-14d | 14 days | Very small |

Long-term steady-state disk usage is about 12–15 G / 40 G.

---

## Rebuild Steps on a Fresh Machine

### 1. Install Docker + Compose and create directories

```bash
mkdir -p /opt/elk/{elasticsearch/data,logstash/config,logstash/pipeline,certs,backups}
# ES data directory must be writable
chmod -R 777 /opt/elk/elasticsearch/data
# Kernel parameter (required by ES)
sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' >> /etc/sysctl.conf
```

### 2. Copy config files (from this repo)

```bash
cp elk/docker-compose.yml            /opt/elk/
cp elk/logstash/config/logstash.yml  /opt/elk/logstash/config/
cp elk/logstash/pipeline/panos.conf  /opt/elk/logstash/pipeline/
```

### 3. Generate TLS certificates (private keys generated on-site, SAN = server IP)

> **Prefer restoring the original certificates** from the secrets bundle: `cp secrets-plain/server/opt/elk/certs/* /opt/elk/certs/`. The firewalls already trust that CA, so syslog TLS (6514) keeps working without touching any NGFW. Only generate new ones (below) if the server IP changes or the CA must be replaced — then re-import the new `ca.crt` on every firewall.

```bash
cd /opt/elk/certs
# CA (10 years)
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt -subj "/CN=SyslogCA"
# Server certificate (5 years, SAN = IP); server.ext is in certs-config/
cp <this-repo>/elk/certs-config/server.ext .
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=<server-IP>"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 1825 -sha256 -extfile server.ext
chmod 644 server.key    # Must be readable by the Logstash container
```
> Clients (e.g. SLS, NGFW syslog profiles) must trust `ca.crt`.

### 4. Start ELK

```bash
cd /opt/elk && docker compose up -d
# Wait for ES to be ready
until curl -s http://localhost:9200/_cluster/health >/dev/null; do sleep 3; done
```

### 5. Restore index templates + ILM policies

```bash
cd elk/es-templates
# ILM policies
for f in ilm_*.json; do
  name=$(echo $f | sed 's/^ilm_//;s/.json$//')
  curl -s -X PUT "http://localhost:9200/_ilm/policy/$name" \
    -H 'Content-Type: application/json' -d @"$f"
done
# index templates
for f in template_*.json; do
  name=$(echo $f | sed 's/^template_//;s/.json$//')
  curl -s -X PUT "http://localhost:9200/_index_template/$name" \
    -H 'Content-Type: application/json' -d "{\"index_template\": $(cat $f)}"
done
```
> Note: the exported template JSON is the inner body of `index_template`. If the PUT fails, wrap it in `{"index_template": ...}` as above, or send the inner body directly (depends on the export format; try both).

### 6. Rebuild Kibana dashboards

```bash
bash elk/scripts/create_dashboards.sh   # Adjust the ES/Kibana addresses inside the script as needed
```

### 7. Configure NGFW / Prisma Access syslog forwarding

Point each NGFW's syslog server profile to `<server-IP>:6514` (TLS) or `:514` (UDP),
and import `ca.crt` into the certificate trust chain.

---

## Verification

```bash
docker ps                                                   # 4 containers Up (includes the unrelated portkey-gateway)
curl -s http://localhost:9200/_cat/indices/panos-*?v        # Indices are growing
curl -s http://localhost:9200/panos-*/_ilm/explain | grep managed   # Managed by ILM
docker logs logstash --since 2m | grep -i "Pipeline started"        # Pipeline started
```

---

## Known Outstanding Issues

- **SLS → ELK TLS forwarding not working**: SLS Test Connection reports a TCP timeout. Confirmed that the SYN reaches the Ubuntu host and a SYN-ACK is sent back; suspected cause is the perimeter firewall not correctly un-NATing the return traffic. See the operations runbook for troubleshooting directions.
- **Tight on memory**: 7.1G machine, ELK uses ~4.7G (ES heap 2g). Assess capacity before adding data sources.
