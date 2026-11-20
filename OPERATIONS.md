> **Public copy:** this document describes the reference lab. Lab-private items it mentions — the encrypted secrets bundle, `memory/`, `topology/`, SSH key files, the slide deck — are not part of this repository. To deploy your own copy, start with the [README](README.md).

> 中文版: [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md)

# Environment Operations Guide (OPERATIONS.md)

> **Purpose of this document**: at any time, on any new computer, this repository alone is enough to fully rebuild and operate the entire Palo Alto Networks security environment —
> SASE cloud management, 4 NGFWs, AI security, software supply chain security, and centralized logging (ELK).
>
> **The only thing that carries over between computers is this GitHub repository**: `https://github.com/<your-org>/netsec-agentic`
> Memory stored locally under `~/.claude/` does not follow you to a new machine, so all important information is captured here.

Last updated: 2026/07/06

---

## 0. 30-second quick start: what to do on a new computer

```bash
# 1. Install prerequisites: Git / Python3.11+ / Node18+ / Claude Code CLI
# 2. Clone the repository
git clone https://github.com/<your-org>/netsec-agentic.git scm-mcp && cd scm-mcp
# 3. Decrypt the secrets bundle (asks for the passphrase — get it from the repo owner), then restore all 7 MCP servers
bash secrets/unseal.sh
bash setup.sh --from-env-file secrets-plain/server/opt/netsec-agent/secrets/agent.env
#    Windows PowerShell: .\setup.ps1 -FromEnvFile secrets-plain\server\opt\netsec-agent\secrets\agent.env
# 4. Verify
claude mcp list      # all 7 show ✔ Connected
# 5. Restore memory (see "0.5 Memory restore" below) — lets Claude recover all context / lessons learned / incident library
```

The ELK server (the Alibaba Cloud one) does not need to be reinstalled — it runs independently; as long as you can SSH into it you can query logs. If you really need to rebuild ELK, see [elk/README.md](elk/README.md) (the certificate private keys are in the encrypted secrets bundle). To deploy/restore the NetSec-Agentic platform: `./deploy/deploy-platform.sh` (see [README.md](README.md)).

---

## 0.5 Memory restore (memory/ → Claude local memory directory)

The repo's `memory/` folder backs up **all of Claude's persistent memory** (14 entries: machine migration steps, NGFW naming, ELK, PPT, incident post-mortem library, troubleshooting methodology, inspection baselines, daily inspection mechanism, etc.). This is the core of how Claude recovers "who I am, what this environment looks like, which pitfalls we've hit, and how to review the three major incidents" — **after switching machines you must copy it back into the local memory directory manually**; `git clone` will not put it there automatically.

**Restore steps** (run once after cloning the repo):

```bash
# Local memory directory (path depends on the project working directory; below is this project's actual path on Windows)
#   Windows: C:\Users\<you>\.claude\projects\<project-slug>\memory\
#   macOS/Linux: ~/.claude/projects/<project-slug>/memory/
# <project-slug> = working directory path with / \ : all replaced by - (e.g. <project-slug>)

# Windows PowerShell example:
$dst = "$env:USERPROFILE\.claude\projects\<project-slug>\memory"
New-Item -ItemType Directory -Force -Path $dst
Copy-Item -Force scm-mcp\memory\*.md $dst\

# macOS / Linux example:
DST=~/.claude/projects/<project-slug>/memory
mkdir -p "$DST" && cp -f scm-mcp/memory/*.md "$DST"/
```

After copying, `MEMORY.md` (the index) + 13 content files are in place and are loaded automatically when a new session starts. **Note**: `<project-slug>` depends on where you put the working directory on the new machine; if the directory name changes, the slug changes too — derive it using the rule above. Whenever day-to-day memory is updated, re-run `cp memory/*.md scm-mcp/memory/` and commit to complete the re-backup (see §8 Iron rules: always update + back up after changes).

> `inspection/` (daily inspection baseline snapshots) and `scheduled-tasks/` (daily inspection scheduled task definitions) are likewise backed up in the repo; the inspection mechanism is described in `memory/project_daily_inspection.md`, and the scheduled tasks must be recreated on the new machine according to that file.

---

## 1. Overall architecture

```
                        ┌─────────────────────────────────────┐
                        │  Claude Code (local, any machine)   │
                        │  7 MCP servers bridging REST APIs   │
                        └───────────────┬─────────────────────┘
                                        │
        ┌───────────────┬───────────────┼────────────────┬────────────────┐
        │               │               │                │                │
   ┌────▼────┐    ┌─────▼────┐   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼───────┐
   │  scm    │    │  koi     │   │ prisma-airs │  │ 4× panos-*  │  │  (SSH)       │
   │SASE mgmt│    │ SW supply│   │ AI security │  │ NGFW mgmt   │  │ Ubuntu ELK   │
   └─────────┘    └──────────┘   └─────────────┘  └──────┬──────┘  └──────▲───────┘
                                                         │                │ syslog
                                                         ├────────────────┘
                                                         │
          ┌─────────────────────┬─────────────────────┬──┴──────────────────┐
          ▼                     ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ sase-external-gw │  │ scvm-aws-hk      │  │ scvm-aws-sg      │  │ aivm-alibaba     │
│ Azure GP gateway │  │ AWS-HK Prisma SC │  │ AWS-SG Prisma SC │  │ Alibaba Cloud    │
│ 203.0.113.21   │  │ 203.0.113.22   │  │ 203.0.113.23   │  │ 203.0.113.24   │
│                  │  │ SC 6.6.6.6       │  │ SC 5.5.5.5       │  │ (protects ELK)   │
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
          ↓ all syslog converges →  Ubuntu ELK (203.0.113.10)
```

---

## 2. The seven MCP servers in detail

| MCP | Product | Tools | Transport/runtime | What it does |
|---|---|---|---|---|
| `scm` | Strata Cloud Manager | 73 | Python stdio (this repo's `src/scm_mcp`) | SASE cloud policy, address/service objects, security rules, NAT, remote networks, service connections, IAM, config push |
| `koi` | KOI software supply chain security | 12 | Node (npm `koi-mcp-server`) | Endpoint extension/package inventory, risk findings, alerts, audit logs, remediation suggestions, policies |
| `prisma-airs` | Prisma AIRS AI security | 44 | Node (npm `prisma-airs-ops-mcp-server`) | AI runtime prompt scanning, red teaming, model security scanning, DLP, custom topics |
| `panos-sase-external-gw` | PAN-OS NGFW | 116 | Node (npm `@iflow-mcp/apius-tech-panos-mcp`) | Azure GP gateway: policy/objects/NAT/routing/BGP/logs/GP users |
| `panos-scvm-aws-hk` | PAN-OS NGFW | 116 | Same as above (same package, distinguished by `PANOS_HOST`) | AWS Hong Kong Prisma SC (6.6.6.6): HK data center access point |
| `panos-scvm-aws-sg` | PAN-OS NGFW | 116 | Same as above (same package, distinguished by `PANOS_HOST`) | AWS Singapore Prisma SC (5.5.5.5): SG data center access point |
| `panos-aivm-alibaba` | PAN-OS NGFW | 116 | Same as above | Alibaba Cloud security VM: protects the ELK server |

> **The 4 panos instances all use the same npm package**, with the target device selected by the env vars `PANOS_HOST` + `PANOS_API_KEY`. Tool name prefixes differ (`mcp__panos-sase-external-gw__*`, etc.).

### scm tool capabilities at a glance (73)
- **Objects**: address / address-group / service / service-group / application / application-group / tag / EDL
- **Security**: security rule (CRUD + reorder), profile (anti-spyware / vulnerability / URL / DoS)
- **Deployment**: remote-network / service-connection / bandwidth / site / BGP routing
- **Operations**: candidate config push (`push_candidate_config` ⚠️ changes production), config version, job
- **IAM**: service-account (response contains the secret in plaintext — be careful), access-policy, custom-role

### 4 panos instances: tool capabilities at a glance (116 each)
- **Read** (`get_*`): system info / interfaces / zones / routing / security & NAT rules / address & service objects / sessions / HA / IPSec / GlobalProtect users / traffic & threat & system logs …
- **Write** (`add_* / delete_* / set_* / move_*`): security/NAT/PBF/QoS/decryption rule, address/service objects, static route, tag
- **Changes production**: `commit` (⚠️ changes running config), Panorama `panorama_commit` + `panorama_push_to_devices`
- **Model**: all write operations go into the candidate config first and only take effect on `commit` — **always confirm with the user before committing**

---

## 3. Network topology and roles

| Device hostname (ELK `device_hostname`) | MCP instance | Management IP | Cloud | Role |
|---|---|---|---|---|
| `PAVM300-Branch-GPGW-SH` | `panos-sase-external-gw` | 203.0.113.21 | Azure | GP VPN gateway for mainland China users, IPSec → Prisma Access Remote Network |
| `PAVM100-PrismaSC-HK` | `panos-scvm-aws-hk` | 203.0.113.22 | AWS Hong Kong | Prisma Access SC (6.6.6.6), access point for HK data center `172.172.0.0/16` |
| `PAVM100-PrismaSC-SG` | `panos-scvm-aws-sg` | 203.0.113.23 | AWS Singapore | Prisma Access SC (5.5.5.5), access point for SG data center `10.188.241.0/24` |
| `AI-SECVM-Branch-Alibaba-CN` | `panos-aivm-alibaba` | 203.0.113.24 | Alibaba Cloud KVM | Protects the Alibaba Cloud Ubuntu ELK, IPSec → Prisma Access Remote Network |

- **Data center subnets**: HK `172.172.0.0/16` (via panos-scvm-aws-hk), SG `10.188.241.0/24` (via panos-scvm-aws-sg); both SCs attach to the same Prisma Access
- **`device_hostname` in ELK and the MCP names are two separate naming schemes**; the table above is the mapping between them

### Conversation conventions (say these words → which device is operated on)
- "GPGW / GP 网关 / Azure 分支" (GP gateway / Azure branch) → `panos-sase-external-gw`
- "SC / HK / 香港数据中心" (Hong Kong data center) → `panos-scvm-aws-hk`
- "SG / 新加坡 / 新加坡数据中心" (Singapore / Singapore data center) → `panos-scvm-aws-sg`
- "阿里云 / Alibaba / AIVM / ELK 那台" (Alibaba Cloud / the ELK one) → `panos-aivm-alibaba`
- ⚠️ The old names `panos-gpgw` / `panos-dcfw` / `panos-border` are deprecated

---

## 4. ELK log server

Centrally collects syslog from the 4 NGFWs + Prisma Access for security analysis and network/performance/access-path analysis.

| Item | Value |
|---|---|
| Public IP / SSH | `203.0.113.10` : `3333` (root) |
| SSH key | `<local machine>/keys/ubuntu_login_fixed.key` (**the private key is not in the repo**; keep it yourself) |
| Deployment | `/opt/elk/` — Docker Compose: ES + Logstash + Kibana 8.14.3 |
| Kibana | `http://203.0.113.10:5601` |
| Listening ports | 514/udp (plaintext), 6514/tcp (TLS, self-signed CA) |

### How logs flow
```
NGFW/Prisma syslog → Logstash(514/6514) → panos.conf parsing (grok+csv+routing by log_type)
                                          → ES daily index panos-{type}-YYYY.MM.dd → Kibana
```

### Index types and retention (ILM delete-only, zero loss of new logs)
| Index | Retention | Index | Retention |
|---|---|---|---|
| panos-traffic | 30 days | panos-globalprotect | 30 days |
| panos-threat | 90 days | panos-config | 180 days |
| panos-system | 14 days | panos-hipmatch / other | 14 days |

### Two pipeline optimizations already in place (2026/07/06)
1. SYSTEM logs: drop `event_id=general` (94% of the noise) → system volume down ~88%
2. HIPMATCH output block fixed (previously landed in panos-other by mistake)

### Kibana Dashboards
| Dashboard | ID |
|---|---|
| PAN-OS Traffic Analysis | `0f1dd460-d816-4e2b-8e65-80dce721577f` |
| PAN-OS Threat Analysis | `996b0f0a-403b-45e7-8dfe-234ab7c6bec9` |
| PAN-OS System & GP Users | `9de4c0c9-696b-4b9d-b858-5c6bacd0d8d7` |

> Full ELK rebuild steps, certificate generation, template/ILM restore → [elk/README.md](elk/README.md). Config files are backed up in `elk/`.

### Common ELK queries (after SSHing into the server)
```bash
# Document count and size per index
curl -s "http://localhost:9200/_cat/indices/panos-*?v&s=store.size:desc"
# Today's traffic by hour
curl -s "http://localhost:9200/panos-traffic-$(date +%Y.%m.%d)/_search" -H 'Content-Type: application/json' \
  -d '{"size":0,"aggs":{"h":{"date_histogram":{"field":"@timestamp","calendar_interval":"hour","time_zone":"Asia/Shanghai"}}}}'
# ILM status (confirm every index is managed + expected deletion time)
curl -s "http://localhost:9200/panos-*/_ilm/explain"
# Logstash health
docker logs logstash --since 5m | grep -iE "Pipeline started|error" | grep -vi ssl
```

### Known open ELK issues
- **SLS → ELK TLS forwarding not working**: SLS Test Connection reports a TCP timeout. Confirmed that the SYN reaches Ubuntu and a SYN-ACK is sent back; suspected cause is the perimeter firewall not correctly un-NATing the return traffic. To troubleshoot: while running the SLS test, run `tcpdump -i eth0 tcp port 6514 -nn` on Ubuntu, and at the same time check the firewall session table + the Ubuntu→SLS return-path allow rule.
- **Memory is tight**: on the 7.1G machine ELK uses ~4.7G (ES heap 2g); assess before adding data sources.

---

## 4.5 Dynamic topology monitoring (topo · 2026-07-08)

Turns the architecture topology into a **live monitoring map**: status lights for the 4 NGFWs (including the HK/SG SCs), IPSec tunnel up/down, BGP neighbors, CPU/memory/sessions/online GP users/traffic rate/threat count, auto-refreshing every 30 seconds. **Internal network access only**.

- **Source code**: repo `topo/` (the static original diagram is at `topology/network-security-topology.html`, using official PANW product icons).
- **Deployment**: Ubuntu `/opt/topo`, a single Docker container `topo` (python:3.12-slim, compose project name `topo`).
- **Access**: from a browser on the same internal subnet open `http://10.199.3.47:8080` (bound to the VPC private IP, the public security group is untouched).
  - SSH tunnel only: change the compose port to `127.0.0.1:8080:8080`, then `ssh -L 8080:127.0.0.1:8080`.
- **Data sources**: a background thread polls the **4 NGFWs** (gpgw / scvm-aws-hk / scvm-aws-sg / aivm) every 30s via the XML API (read-only show) + runs aggregations against `elasticsearch:9200` → atomically writes `web/status.json`; the frontend fetches and renders it. Joins the existing `elk_elk` network and **does not modify /opt/elk**. Since the Singapore SC was onboarded, the frontend's `aws-sg` has been upgraded from a ghost node to a managed live node.
- **Secrets**: `/opt/topo/secrets/topo.env` (600, gitignored; the repo only keeps the `.example`). Switching to a read-only RBAC key is recommended.
- **Start/stop**: `cd /opt/topo && docker compose -p topo up -d --build` / `down` (clean rollback, does not affect ELK).
- **Debug**: `docker compose -p topo run --rm topo python -u app.py --probe` (prints the raw XML of each PAN-OS command).
- **Live vs. static**: NGFWs are truly live; Prisma is inferred from tunnels + BGP + SLS; AIRS/KOI/aws-sg/dc-hk are static (the server has no cloud credentials).
- See `topo/README.md` for details.

---

## 5. Project implementation phases (what was done and how)

| Phase | Content | Key artifacts |
|---|---|---|
| 1. scm-mcp development | Bridged REST to 73 MCP tools following the SCM OpenAPI spec | `src/scm_mcp/`, see CLAUDE.md/DESIGN.md/WORKFLOW.md |
| 2. Onboard koi + prisma-airs | npm install + claude mcp add | setup script Step 2/3 |
| 3. Onboard 3 PAN-OS NGFWs | Same npm package registered as 3 instances by host | setup script Step 4/5 |
| 4. Cross-platform restore scripts | One-click restore for Windows/macOS/Linux + GitHub backup | setup.ps1 / setup.sh |
| 5. Ubuntu ELK deployment | ES+Logstash+Kibana via Docker Compose, PAN-OS syslog parsing pipeline | `elk/` |
| 6. TLS hardening | Self-signed CA + server certificate, Logstash 6514 TCP TLS | `elk/certs-config/` |
| 7. Dashboards | 3 Kibana visualization dashboards | `elk/scripts/create_dashboards.sh` |
| 8. Log governance | SYSTEM noise filtering + HIPMATCH routing fix + tiered ILM retention | `elk/logstash/pipeline/panos.conf`, `elk/es-templates/` |
| 9. Dynamic topology monitoring | Live monitoring map polling 4 NGFWs + querying ELK, published on the internal network (10.199.3.47:8080) | `topo/`, `topology/` (see §4.5) |

---

## 6. Common operations scenarios cheat sheet

> Below is "what you say → which MCP Claude uses and what it does". All **configuration-changing operations go into the candidate config first, and you will be asked to confirm before commit/push**.

### Queries (read-only, use any time)
| What you want to do | How |
|---|---|
| View an NGFW's security policy | `get_security_rules` on `panos-*` |
| View interface/routing/session status | `get_interfaces` / `get_routing_table` / `get_active_sessions` |
| See who is connected to GP VPN | `get_globalprotect_users` on `panos-sase-external-gw` |
| View threat/traffic logs | NGFW `get_threat_logs` / `get_traffic_logs`, or query ELK directly (more complete data, cross-device) |
| What policies/objects exist in the SASE cloud | `list_security_rules` / `list_addresses` / `list_services` on `scm` |
| Endpoint software supply chain risk | `koi_list_findings` / `koi_list_inventory` / `koi_list_alerts` on `koi` |
| Scan an AI prompt for risk | `airs_runtime_scan` on `prisma-airs` |

### Configuration (changes production, requires confirmation)
| What you want to do | How |
|---|---|
| Add a firewall allow/block rule | `panos-*` `add_security_rule` → confirm → `commit` |
| Add address/service objects | `add_address_object` / `add_service_object` → `commit` |
| Deploy policy from the SASE cloud | `scm` `create_security_rule` → `push_candidate_config` (⚠️ affects production) |
| Add a static route/NAT | `add_static_route` / `add_nat_rule` → `commit` |

### Troubleshooting
| Symptom | Where to start |
|---|---|
| Is a given IP reachable | NGFW `get_traffic_logs` filtered on that IP + `get_security_rules` to see the matching rule; query `panos-traffic-*` in ELK |
| VPN won't connect | `get_globalprotect_users` + ELK `panos-globalprotect-*` + ike-* events in `panos-system-*` |
| Logs not arriving in ELK | SSH in and check `docker logs logstash`, `_cat/indices`; confirm the NGFW syslog profile points to 203.0.113.10 |

---

## 7. Secrets and credentials inventory (values are stored only encrypted in `secrets/secrets.tar.gz.enc`; see [secrets/README.md](secrets/README.md))

| Credential | Does it change | How to obtain / notes |
|---|---|---|
| `SCM_CLIENT_SECRET` | Fixed | SASE service account secret (= PANW_MGMT_CLIENT_SECRET) |
| `KOI_API_KEY` | ~1 year | Regenerate in the KOI console under Settings → API Access |
| `PANW_AI_SEC_API_KEY` | Fixed | Prisma AIRS scanning key |
| `PANW_MGMT_CLIENT_SECRET` | Fixed | Same as SCM_CLIENT_SECRET |
| `PANOS_API_KEY_SASE_EXTERNAL_GW` | Fixed | API key for 203.0.113.21 |
| `PANOS_API_KEY_SCVM_AWS_HK` | Fixed | API key for 203.0.113.22 (AWS Hong Kong SC) |
| `PANOS_API_KEY_SCVM_AWS_SG` | Fixed | API key for 203.0.113.23 (AWS Singapore SC) |
| `PANOS_API_KEY_AIVM_ALIBABA` | Fixed | API key for 203.0.113.24 |
| Ubuntu SSH private key | Fixed | `server-ssh-key.pem` (root@203.0.113.10:3333), in the bundle under `ssh/` |
| AWS Bedrock credentials | Depends on token | `AWS_BEARER_TOKEN_BEDROCK` etc., in the bundle's `agent.env` |
| ELK TLS certificates / keys | Fixed | CA / server / OCSP, in the bundle under `server/opt/elk/certs/` |

> **Fixed non-secret configuration** (Client ID / TSG ID / Host) is built into the setup scripts; see README "Fixed configuration values".
> **If a PAN-OS API key is lost**: log in to the device via SSH/Web and regenerate it with `https://<IP>/api/?type=keygen&user=...&password=...`.

---

## 8. Iron rules (operational red lines)

1. **Always confirm before changing production**: before any `commit` / `push_candidate_config` / `panorama_push_to_devices`, explain the scope of impact to the user and wait for confirmation.
2. **Candidate first**: NGFW write operations go into the candidate config first; never modify the running config directly.
3. **No plaintext secrets in Git**: `*.key` / `*.pem` / SSH private keys / env files are never committed in plaintext — only inside the encrypted bundle `secrets/secrets.tar.gz.enc`; the passphrase is shared out-of-band.
4. **Secrets never go into logs**: `create_service_account` / `reset_service_account` responses contain the plaintext secret; do not write it to any log file.
5. **Don't put ELK backups in the pipeline directory**: Logstash loads the entire pipeline directory, so a backup file placed there causes a port conflict and a crash (see elk/README.md for details).
6. **Single source of truth for the SCM schema**: `C:\pan.dev\openapi-specs\scm\` — never copy by hand, never make things up.

---

## 9. Documentation map

| File | Read this when you want to… |
|---|---|
| **OPERATIONS.md** (this document) · [中文](OPERATIONS.zh-CN.md) | Understand the big picture / restore on a new machine / run daily operations |
| [README.md](README.md) | One-click restore commands, secrets inventory, platform deploy |
| [secrets/README.md](secrets/README.md) | Encrypted secrets bundle: unseal / rotate / change passphrase |
| [deploy/deploy-platform.sh](deploy/deploy-platform.sh) | One-click deploy / version restore of the NetSec-Agentic platform |
| **memory/** (14 .md files) | Restore Claude's memory after switching machines (see §0.5); includes the incident post-mortem library, naming, baselines, daily inspection mechanism |
| **inspection/** | Daily inspection baseline snapshots + logs (the reference for drift comparison) |
| **scheduled-tasks/** | Daily inspection scheduled task definitions (recreate on a new machine following memory/project_daily_inspection.md) |
| [elk/README.md](elk/README.md) | Rebuild or troubleshoot the ELK log server |
| [CLAUDE.md](CLAUDE.md) | Modify the scm-mcp code (engineering contract) |
| [DESIGN.md](DESIGN.md) | Look up the scm tool ↔ REST endpoint mapping |
| [WORKFLOW.md](WORKFLOW.md) | The phased development protocol for scm-mcp |
