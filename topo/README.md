> 中文版: [README.zh-CN.md](README.zh-CN.md)

# Dynamic Network Security Topology Monitor (topo)

Upgrades the static topology diagram into a **live monitoring view**: status lights for 3 NGFWs, IPSec/SC/RN tunnel up/down, BGP neighbors, CPU/memory/sessions/online GP users, traffic rates, and threat counts, auto-refreshing every 30 seconds. **Internal/local access only — not exposed to the internet, no TLS/authentication.**

## Architecture
Single container `topo` (`python:3.12-slim` + requests):
- Main thread: stdlib http serves `web/` (bound to `127.0.0.1:8080`)
- Background thread: every 30s polls the XML API of the 3 NGFWs (read-only show) + queries local ES aggregations → atomically writes `web/status.json`
- Joins the existing `elk_elk` network to reach `elasticsearch:9200`; **does not modify any file under `/opt/elk`**

The page also serves the NetSec-Agentic agent panel and reverse-proxies `/api/*` to the `netsec-agent` container.

Data tiers: NGFW (live) · Prisma (inferred from tunnels/BGP/SLS) · AIRS/KOI/aws-sg/dc-hk (static; the server has no cloud credentials).

## Deployment (server /opt/topo)
Recommended: from the repo root run `./deploy/deploy-platform.sh` — it backs up, uploads `topo/` + `netsec-agent/`, rebuilds the topo image, restarts, and runs health checks.

Manual steps:
```bash
cd /opt/topo
cp secrets/topo.env.example secrets/topo.env
# Fill in the 3 PANOS_API_KEY_* values (Base64, read-only), then save
chmod 600 secrets/topo.env
docker compose -p topo up -d --build
docker logs -f topo          # Look for "snapshot written: N nodes up"
curl -s 127.0.0.1:8080/status.json | python3 -m json.tool
```

## Access (workstation)
```bash
ssh -i <key> -p 3333 -L 8080:127.0.0.1:8080 root@203.0.113.10
# Open http://localhost:8080 in a browser
```

## Calibrating the parser (after first deployment, read-only)
The response structure of PAN-OS commands varies by version. Use probe to print the real XML, then fine-tune the parsing in app.py accordingly:
```bash
docker compose -p topo run --rm topo python -u app.py --probe
```

## Rollback / Stop
```bash
docker compose -p topo down          # Clean removal; does not affect ELK
```

## Security
- `secrets/topo.env` is gitignored, contains API keys, must be `chmod 600`, and must never be committed.
- Create a dedicated **read-only RBAC** API key for the collector (show only); do not reuse a full-privilege key.
- 8080 is bound to loopback; for internal LAN access, change it to `0.0.0.0` and allow it in the cloud security group.
- This project does not change the bare exposure of ELK's 9200/5601 (a pre-existing risk, handled separately).


## Login gate

Everything this server serves (the page, `status.json`, the `/api/*` proxy to the agent) is behind a server-side session login, implemented in `collector/app.py`. Default credentials **`admin` / *(your `TOPO_AUTH_PASS`)***.

- Public without a session: `/login.html`, `/assets/*`, `/auth/*`. Unauthenticated page requests are redirected to the login page; other requests get `401` (and `web/auth-guard.js` sends the browser to the login page).
- Session: random token in an `HttpOnly; SameSite=Lax` cookie, 12 h. Sign out: the ⎋ button in the header, or `/auth/logout`.
- Brute-force brake: 10 failed logins from one client address within 5 minutes → wait 5 minutes.
- Settings in `secrets/topo.env`: `TOPO_AUTH_USER`, `TOPO_AUTH_PASS`, `TOPO_SESSION_TTL`, and `TOPO_AUTH=off` as a kill switch (behaves exactly as before). Apply with `docker compose -p topo up -d`.
- Plain HTTP: the cookie can't carry `Secure`. Keep the source-address allow-list in front of the server, or put TLS in front for wider exposure.
