#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
topo collector — 动态网络安全拓扑监控采集器

单进程双职责：
  · 主线程：stdlib http.server 静态托管 WEB_DIR（含 index.html / topo-live.js / assets / status.json）
  · 后台线程：每 POLL_INTERVAL 秒轮询 3 台 NGFW 的 PAN-OS XML API（只读 op 命令）
             + 查本机 Elasticsearch 聚合，原子写 WEB_DIR/status.json

设计铁律：
  · 只读：仅调用 PAN-OS <show> 命令，绝不改设备配置。
  · 容错：每设备/每命令/每查询独立 try/except + 超时；单点失败标 unknown，不中断整轮。
  · 原子写：先写 .tmp 再 os.replace，前端永不读到半截文件。
  · API key 经 POST body 传递（不进 URL/代理日志），从环境变量读取，绝不硬编码/落日志。
"""
import os, sys, time, json, threading, traceback
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone, timedelta

try:
    import requests
    from requests.packages.urllib3.exceptions import InsecureRequestWarning
    requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
except ImportError:
    print("FATAL: requests not installed", file=sys.stderr); sys.exit(1)

# ---------------- config ----------------
WEB_DIR       = os.environ.get("WEB_DIR", "/app/web")
STATUS_FILE   = os.path.join(WEB_DIR, "status.json")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))
HTTP_PORT     = int(os.environ.get("HTTP_PORT", "8080"))
ES_URL        = os.environ.get("ES_URL", "http://elasticsearch:9200")
API_TIMEOUT   = float(os.environ.get("API_TIMEOUT", "8"))
TZ            = timezone(timedelta(hours=8))   # 展示用本地时区（上海）
# NetSec-Agentic 反代上游：把 /api/* 转发到同 elk_elk 网内的 agent 容器 8081。
# 这样浏览器只需访问已放行的 8080，不必再单独放行 8081（中间防火墙常只放了 8080）。
AGENT_UPSTREAM = os.environ.get("AGENT_UPSTREAM", "http://netsec-agent:8081")

# 设备表：host 为公网地址（已在恢复手册/仓库记录），key 从环境变量读取。
DEVICES = {
    "gpgw": {
        "host": os.environ.get("PANOS_HOST_SASE_EXTERNAL_GW") or os.environ.get("PANOS_HOST_GPGW_AZURE", "203.0.113.21"),
        "key_env": "PANOS_API_KEY_SASE_EXTERNAL_GW",
        "key_env_legacy": "PANOS_API_KEY_GPGW_AZURE",   # 原名 gpgw-azure(2026-11-20 重命名)，旧 env 名仍兼容
        "has_gp": True,
        # 该设备到 Prisma 的隧道对应哪些前端 link（gpgw 双 RN 共用同一条到 Prisma 的物理可达性）
        "prisma_links": ["rn-azure-hk", "rn-azure-cn"],
        "gp_link": "gp-sh",
        "syslog_link": "syslog-gpgw",
        # ES device_hostname 匹配子串（已实测生效）
        "es_host_match": ["GPGW", "PAVM300", "VM300"],
    },
    "scvm": {   # scvm-aws-hk（AWS 香港 SC，6.6.6.6）
        "host": os.environ.get("PANOS_HOST_SCVM_AWS", "203.0.113.22"),
        "key_env": "PANOS_API_KEY_SCVM_AWS",
        "has_gp": False,
        "prisma_links": ["sc-aws-hk"],
        "gp_link": None,
        "syslog_link": "syslog-scvm",
        "es_host_match": ["PrismaSC-HK", "PAVM100-PrismaSC-HK", "scvm-aws-hk"],
    },
    "aws-sg": {  # scvm-aws-sg（AWS 新加坡 SC，5.5.5.5）
        "host": os.environ.get("PANOS_HOST_SCVM_AWS_SG", "203.0.113.23"),
        "key_env": "PANOS_API_KEY_SCVM_AWS_SG",
        "has_gp": False,
        "prisma_links": ["sc-aws-sg"],
        "gp_link": None,
        "syslog_link": None,
        "es_host_match": ["PrismaSC-SG", "PAVM100-PrismaSC-SG", "scvm-aws-sg"],
    },
    "aivm": {
        "host": os.environ.get("PANOS_HOST_AIVM_ALIBABA", "203.0.113.24"),
        "key_env": "PANOS_API_KEY_AIVM_ALIBABA",
        "has_gp": True,
        "prisma_links": ["rn-alibaba"],
        "gp_link": "gp-jp",
        "syslog_link": "syslog-aivm",
        "prisma_static": True,          # aivm→Prisma 纯静态无 BGP
        "es_host_match": ["AI-SECVM", "Alibaba", "aivm"],
    },
}

# Prisma 侧 BGP 对端地址（从各设备自己的 bgp 表看到的 peer-address 即 Prisma 的地址）
PRISMA_BGP_PEERS = {"10.101.234.1", "10.101.234.11", "192.168.255.1", "192.168.66.1", "192.168.99.1"}

_LOCK = threading.Lock()

def log(*a):
    print(datetime.now(TZ).strftime("%H:%M:%S"), "[topo]", *a, flush=True)

# ---------------- PAN-OS XML API ----------------
def panos_op(host, key, cmd_xml):
    """执行一条只读 op 命令，返回 <result> Element 或抛异常。key 走 POST body。"""
    url = "https://%s/api/" % host
    r = requests.post(url, data={"type": "op", "cmd": cmd_xml, "key": key},
                      verify=False, timeout=API_TIMEOUT)
    r.raise_for_status()
    root = ET.fromstring(r.text)
    if root.get("status") != "success":
        raise RuntimeError("API status=%s" % root.get("status"))
    return root.find("result")

def parse_resources(result):
    """从 show system resources 的 top 文本抠 CPU/内存%（按实测 top 格式，排除 Swap 行）。"""
    import re
    cpu = mem = None
    txt = "".join(result.itertext()) if result is not None else ""
    for line in txt.splitlines():
        s = line.strip()
        # CPU: "%Cpu(s): 14.7 us, ... 76.5 id, ..." → 100 - idle
        if ("Cpu" in s) and ("id" in s):
            m = re.search(r'([\d.]+)\s*id', s)
            if m:
                try: cpu = round(100.0 - float(m.group(1)), 1)
                except Exception: pass
        # 内存: "MiB Mem : 14014.8 total, 516.5 free, 5048.1 used, 8450.1 buff/cache"
        # 关键：必须是内存行，排除 "MiB Swap:"（其行尾也含 "avail Mem"）
        if ("Mem" in s) and ("total" in s) and ("Swap" not in s):
            pairs = re.findall(r'([\d.]+)\s*(total|free|used|buff/cache|buff)', s)
            d = {}
            for v, k in pairs:
                try: d[k] = float(v)
                except Exception: pass
            if d.get("total"):
                used = d.get("used")
                if used is None and d.get("free") is not None:
                    used = d["total"] - d["free"] - d.get("buff/cache", 0) - d.get("buff", 0)
                if used is not None:
                    mem = round(used / d["total"] * 100.0, 1)
    return cpu, mem

def parse_sessions(result):
    if result is None: return None
    el = result.find(".//num-active")
    if el is not None and el.text and el.text.strip().isdigit():
        return int(el.text.strip())
    return None

def parse_gp_users(result):
    if result is None: return None
    n = len(result.findall(".//entry"))
    return n

def parse_ipsec(result):
    """show vpn ipsec-sa 的 entry 无 <state>：能列出 SA = 该隧道 P2 已建立=up。
    返回隧道列表 [{name,gateway,remote,state}]。"""
    tunnels = []
    if result is None:
        return tunnels
    for e in result.findall(".//entry"):
        name = (e.findtext("name") or "").strip()
        gw = (e.findtext("gateway") or "").strip()
        remote = (e.findtext("remote") or "").strip()
        if not name and not gw:
            continue
        tunnels.append({"name": name or gw, "gateway": gw, "remote": remote, "state": "up"})
    return tunnels

def parse_bgp(result):
    """返回 [{peer,addr,state}]；addr 为 peer-address 去端口，用于匹配 Prisma 对端。"""
    peers = []
    if result is None:
        return peers
    for e in result.findall(".//entry"):
        name = (e.get("peer") or "").strip()
        addr = (e.findtext("peer-address") or "").strip().split(":")[0]
        st = (e.findtext("status") or e.findtext("state") or "").strip()
        if not name and not addr:
            continue  # 跳过无地址/无名的残留条目
        label = name or addr
        peers.append({"peer": ("%s (%s)" % (name, addr)) if (name and addr) else label,
                      "addr": addr,
                      "state": "established" if st.lower().startswith("estab") else (st or "unknown")})
    return peers

def poll_device(nid, cfg):
    """轮询单台设备，返回 (node_dict, link_updates)。全程 try/except，失败标 unknown。"""
    key = (os.environ.get(cfg["key_env"]) or os.environ.get(cfg.get("key_env_legacy", ""), "")).strip()
    node = {"status": "unknown"}
    link_updates = {}
    if not key:
        node["error"] = "missing API key (%s)" % cfg["key_env"]
        return node, link_updates
    host = cfg["host"]

    def safe(cmd):
        try:
            return panos_op(host, key, cmd)
        except Exception as e:
            raise

    # 1) 探活 + 资源（任一成功即认为设备 up）
    reachable = False
    try:
        res = safe("<show><system><resources></resources></system></show>")
        node["cpu"], node["mem"] = parse_resources(res)
        reachable = True
    except Exception as e:
        node["error"] = "resources: %s" % (str(e)[:80])

    # 2) 会话
    try:
        res = safe("<show><session><info></info></session></show>")
        s = parse_sessions(res)
        if s is not None: node["sessions"] = s
        reachable = True
    except Exception:
        pass

    # 3) IPSec 隧道（entry 存在即 up）
    tunnels = []
    try:
        res = safe("<show><vpn><ipsec-sa></ipsec-sa></vpn></show>")
        tunnels = parse_ipsec(res)
        if tunnels: node["tunnels"] = tunnels
        reachable = True
    except Exception:
        pass

    # 4) BGP peer
    peers = []
    try:
        res = safe("<show><routing><protocol><bgp><peer></peer></bgp></protocol></routing></show>")
        peers = parse_bgp(res)
        if peers: node["bgp"] = peers
        reachable = True
    except Exception:
        pass

    # 5) GP 在线用户（仅网关）
    if cfg.get("has_gp"):
        try:
            res = safe("<show><global-protect-gateway><current-user></current-user></global-protect-gateway></show>")
            g = parse_gp_users(res)
            if g is not None: node["gp_users"] = g
        except Exception:
            pass

    # ---- 由隧道/BGP 推导该设备关联的前端链路状态 ----
    # 到 Prisma 的可达性：有任一 IPSec 隧道 OR 有到 Prisma peer 的 established BGP
    has_tunnel = len(tunnels) > 0
    bgp_to_prisma_up = any(p["state"] == "established" and p.get("addr") in PRISMA_BGP_PEERS for p in peers)
    prisma_up = has_tunnel or bgp_to_prisma_up
    for lid in cfg.get("prisma_links", []):
        st = {"tunnel": "up" if prisma_up else "down"}
        if cfg.get("prisma_static"):
            st["bgp"] = "static"
        elif bgp_to_prisma_up:
            st["bgp"] = "established"
        elif prisma_up:
            st["bgp"] = "unknown"
        link_updates[lid] = st
    # GP 链路：网关设备且有隧道即认为 GP 服务在线（GP 隧道也出现在 ipsec-sa 或用户在线）
    if cfg.get("gp_link"):
        gp_up = has_tunnel or (node.get("gp_users", 0) or 0) > 0
        link_updates[cfg["gp_link"]] = {"tunnel": "up" if gp_up else "down"}

    if reachable:
        node["status"] = "up"
        node.pop("error", None)
    return node, link_updates

# ---------------- Elasticsearch 聚合 ----------------
def es_search(index, body):
    r = requests.post("%s/%s/_search" % (ES_URL, index), json=body, timeout=API_TIMEOUT)
    r.raise_for_status()
    return r.json()

def es_traffic_rate_by_host(window_min=5):
    """近 window_min 分钟按 device_hostname 的 bytes 速率(bps)。返回 {hostname: bps}。"""
    body = {"size": 0,
            "query": {"range": {"@timestamp": {"gte": "now-%dm" % window_min}}},
            "aggs": {"byhost": {"terms": {"field": "device_hostname", "size": 20},
                                "aggs": {"b": {"sum": {"field": "bytes"}}}}}}
    out = {}
    try:
        j = es_search("panos-traffic-*", body)
        for b in j["aggregations"]["byhost"]["buckets"]:
            bytes_sum = b["b"]["value"] or 0
            out[b["key"]] = (bytes_sum * 8.0) / (window_min * 60.0)  # bits per second
    except Exception as e:
        log("ES traffic agg failed:", str(e)[:100])
    return out

def es_threats_by_host(window_min=60):
    body = {"size": 0,
            "query": {"range": {"@timestamp": {"gte": "now-%dm" % window_min}}},
            "aggs": {"byhost": {"terms": {"field": "device_hostname", "size": 20},
                                "aggs": {"sev": {"terms": {"field": "severity", "size": 10}}}}}}
    out = {}
    try:
        j = es_search("panos-threat-*", body)
        for b in j["aggregations"]["byhost"]["buckets"]:
            sev = {}
            for s in b["sev"]["buckets"]:
                sev[str(s["key"]).lower()] = s["doc_count"]
            out[b["key"]] = sev
    except Exception as e:
        log("ES threat agg failed:", str(e)[:100])
    return out

def es_sls_count(window_min=15):
    body = {"size": 0, "query": {"bool": {"filter": [
        {"term": {"log_origin": "sls"}},
        {"range": {"@timestamp": {"gte": "now-%dm" % window_min}}}]}}}
    try:
        j = es_search("panos-*", body)
        return j["hits"]["total"]["value"] if isinstance(j["hits"]["total"], dict) else j["hits"]["total"]
    except Exception as e:
        log("ES sls count failed:", str(e)[:100])
        return None

def match_host(es_map, matchers):
    """在 ES 聚合结果里按子串匹配设备主机名，返回命中的聚合值。"""
    for host, val in es_map.items():
        for m in matchers:
            if m.lower() in str(host).lower():
                return val
    return None

# ---------------- 组装快照 ----------------
def build_snapshot():
    nodes = {}
    links = {}

    # 设备轮询
    for nid, cfg in DEVICES.items():
        try:
            node, lu = poll_device(nid, cfg)
        except Exception as e:
            node, lu = {"status": "unknown", "error": str(e)[:80]}, {}
        nodes[nid] = node
        for lid, st in lu.items():
            # st 是 dict {tunnel,bgp?}；多设备触达同一 link 时 up 优先
            if links.get(lid, {}).get("tunnel") != "up":
                links[lid] = st

    # ES 聚合
    traffic = es_traffic_rate_by_host(5)
    threats = es_threats_by_host(60)
    for nid, cfg in DEVICES.items():
        if nodes[nid].get("status") in ("up", "warn"):
            tr = match_host(traffic, cfg["es_host_match"])
            if tr is not None:
                nodes[nid]["traffic_bps"] = int(tr)
            th = match_host(threats, cfg["es_host_match"])
            if th is not None:
                nodes[nid]["threats_1h"] = {
                    "critical": th.get("critical", 0), "high": th.get("high", 0),
                    "medium": th.get("medium", 0), "low": th.get("low", 0)}

    # 节点降级：关联的 Prisma 链路若 down，则该 NGFW 降为 warn（隧道断但设备可达）
    for nid, cfg in DEVICES.items():
        if nodes[nid].get("status") == "up":
            for lid in cfg.get("prisma_links", []):
                if links.get(lid, {}).get("tunnel") == "down":
                    nodes[nid]["status"] = "warn"
                    break

    # Prisma 节点：由 4 台 NGFW（2 SC + gpgw 双 RN + aivm RN）到它的隧道/BGP + SLS 到达综合推断
    prisma_link_ids = ("sc-aws-hk", "sc-aws-sg", "rn-azure-hk", "rn-azure-cn", "rn-alibaba")
    up_tuns = [lid for lid in prisma_link_ids if links.get(lid, {}).get("tunnel") == "up"]
    sls = es_sls_count(15)
    prisma = {"status": "inferred",
              "note": "Inferred status (no cloud-side credentials on the server): derived from the tunnels/BGP of the 4 NGFWs to Prisma (HK + SG service connections, sase-external-gw dual RN, aivm RN) plus SLS log arrival.",
              "sls_logs_15m": sls}
    total_prisma_links = len(prisma_link_ids)
    if len(up_tuns) == 0:
        prisma["status"] = "down"
    elif len(up_tuns) < total_prisma_links:
        prisma["status"] = "warn"
    else:
        prisma["status"] = "up"
    nodes["prisma"] = prisma

    # 静态节点（aws-sg 现已受管，不在此列）
    for sid in ("elk", "airs", "koi", "dc-hk", "dc-sg", "gp-sh", "gp-jp"):
        nodes.setdefault(sid, {"status": "static"})

    # 补全前端期望的 link 键（未探测到的置 unknown）
    for lid in ("sc-aws-hk", "sc-aws-sg", "rn-azure-hk", "rn-azure-cn", "rn-alibaba",
                "gp-sh", "gp-jp", "syslog-gpgw", "syslog-scvm", "syslog-aivm", "syslog-prisma"):
        links.setdefault(lid, {"tunnel": "unknown"})
    # syslog 链路：设备 up 即视为在发日志（粗略）
    if nodes["gpgw"].get("status") in ("up", "warn"): links["syslog-gpgw"] = {"tunnel": "up"}
    if nodes["scvm"].get("status") in ("up", "warn"): links["syslog-scvm"] = {"tunnel": "up"}
    if nodes["aivm"].get("status") in ("up", "warn"): links["syslog-aivm"] = {"tunnel": "up"}
    if sls: links["syslog-prisma"] = {"tunnel": "up"}

    return {"generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
            "poll_interval": POLL_INTERVAL,
            "collector": "topo-collector",
            "nodes": nodes, "links": links}

def write_atomic(snap):
    tmp = STATUS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, STATUS_FILE)

def poll_loop():
    log("poll loop started, interval=%ds, ES=%s" % (POLL_INTERVAL, ES_URL))
    while True:
        t0 = time.time()
        try:
            snap = build_snapshot()
            write_atomic(snap)
            ups = sum(1 for n in snap["nodes"].values() if n.get("status") == "up")
            log("snapshot written: %d nodes up, %.1fs" % (ups, time.time() - t0))
        except Exception:
            log("poll cycle error:\n" + traceback.format_exc())
        dt = POLL_INTERVAL - (time.time() - t0)
        if dt > 0:
            time.sleep(dt)

# ---------------- static web server + agent 反代 ----------------
# ---------------- login gate (2026-11-20) ----------------
# Server-side session login in front of everything this server serves (page, status.json, /api/* proxy).
# Public without a session: /login.html, /assets/*, /favicon.ico and the /auth/* endpoints.
#   TOPO_AUTH=off           → kill switch: gate disabled, behaves exactly like before
#   TOPO_AUTH_USER / _PASS  → credentials (default admin / <TOPO_AUTH_PASS>)
#   TOPO_SESSION_TTL        → session lifetime in seconds (default 12 h)
import secrets as _secrets, hmac as _hmac
from urllib.parse import urlparse as _urlparse, parse_qs as _parse_qs, quote as _quote

AUTH_ON     = os.environ.get("TOPO_AUTH", "on").strip().lower() != "off"
AUTH_USER   = os.environ.get("TOPO_AUTH_USER", "admin")
AUTH_PASS   = os.environ.get("TOPO_AUTH_PASS") or _secrets.token_urlsafe(12)   # unset → random one-time password (see log)
SESSION_TTL = int(os.environ.get("TOPO_SESSION_TTL", "43200"))
AUTH_COOKIE = "nsa_session"
_SESSIONS, _FAILS = {}, {}            # token -> expiry ; client ip -> [failure timestamps]
_AUTH_LOCK = threading.Lock()
_PUBLIC_PATHS = ("/login.html", "/favicon.ico")
_PUBLIC_PREFIXES = ("/assets/", "/auth/")

def _session_ok(token):
    if not token:
        return False
    now = time.time()
    with _AUTH_LOCK:
        exp = _SESSIONS.get(token)
        if exp is None or exp < now:
            _SESSIONS.pop(token, None)
            return False
        return True

def _session_new():
    tok = _secrets.token_urlsafe(32)
    now = time.time()
    with _AUTH_LOCK:
        for k in [k for k, v in _SESSIONS.items() if v < now]:
            _SESSIONS.pop(k, None)
        _SESSIONS[tok] = now + SESSION_TTL
    return tok

def _locked_out(ip):
    """Brute-force brake: 10 failed logins from one address within 5 minutes → wait."""
    now = time.time()
    with _AUTH_LOCK:
        recent = [t for t in _FAILS.get(ip, []) if now - t < 300]
        _FAILS[ip] = recent
        return len(recent) >= 10

def _record_fail(ip):
    with _AUTH_LOCK:
        _FAILS.setdefault(ip, []).append(time.time())

log("login gate: %s (user=%s, session ttl=%ds)" % ("ON" if AUTH_ON else "OFF (TOPO_AUTH=off)", AUTH_USER, SESSION_TTL))
if AUTH_ON and not os.environ.get("TOPO_AUTH_PASS"):
    log("TOPO_AUTH_PASS is not set — generated password for user %s: %s  (set TOPO_AUTH_PASS in secrets/topo.env)" % (AUTH_USER, AUTH_PASS))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    # ---- login gate ----
    def _cookie_token(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == AUTH_COOKIE:
                return v.strip()
        return ""

    def _send_json(self, code, obj, extra_headers=()):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        try: self.wfile.write(body)
        except Exception: pass

    def _gate(self):
        """True = request fully handled here (auth endpoint / redirect / 401). False = continue as before."""
        path = _urlparse(self.path).path
        if path.startswith("/auth/"):
            return self._auth_endpoint(path)
        if not AUTH_ON or path in _PUBLIC_PATHS or path.startswith(_PUBLIC_PREFIXES):
            return False
        if _session_ok(self._cookie_token()):
            return False
        if self.command == "GET" and (path == "/" or path.endswith(".html")):
            self.send_response(302)
            self.send_header("Location", "/login.html?next=" + _quote(self.path, safe=""))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        self._send_json(401, {"error": "authentication required"}, [("X-Auth-Required", "1")])
        return True

    def _auth_endpoint(self, path):
        ip = self.client_address[0] if self.client_address else "?"
        if path == "/auth/status" and self.command == "GET":
            self._send_json(200, {"auth": AUTH_ON, "authenticated": (not AUTH_ON) or _session_ok(self._cookie_token())})
            return True
        if path == "/auth/logout":
            tok = self._cookie_token()
            with _AUTH_LOCK:
                _SESSIONS.pop(tok, None)
            self.send_response(302)
            self.send_header("Set-Cookie", "%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" % AUTH_COOKIE)
            self.send_header("Location", "/login.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        if path == "/auth/login" and self.command == "POST":
            if _locked_out(ip):
                self._send_json(429, {"ok": False, "error": "Too many attempts. Try again in a few minutes."})
                return True
            try:
                n = min(int(self.headers.get("Content-Length") or 0), 4096)
                raw = self.rfile.read(n).decode("utf-8", "replace") if n else ""
            except Exception:
                raw = ""
            if "json" in (self.headers.get("Content-Type") or ""):
                try: data = json.loads(raw or "{}")
                except Exception: data = {}
            else:
                data = {k: v[0] for k, v in _parse_qs(raw).items()}
            user, pw = str(data.get("username", "")), str(data.get("password", ""))
            ok = _hmac.compare_digest(user.encode(), AUTH_USER.encode()) & _hmac.compare_digest(pw.encode(), AUTH_PASS.encode())
            if not ok:
                _record_fail(ip)
                log("login failed from %s" % ip)
                time.sleep(0.6)
                self._send_json(401, {"ok": False, "error": "Invalid username or password."})
                return True
            tok = _session_new()
            log("login ok from %s" % ip)
            self._send_json(200, {"ok": True}, [("Set-Cookie", "%s=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (AUTH_COOKIE, tok, SESSION_TTL))])
            return True
        self._send_json(404, {"error": "not found"})
        return True
    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    # /api/* → 流式反代到 NetSec-Agentic(netsec-agent:8081)。
    # 关键：SSE 必须逐块透传、每块 flush，绝不缓冲整体，否则前端收不到增量/心跳。
    def _proxy(self, method):
        path = self.path
        if not path.startswith("/api/"):
            return False
        url = AGENT_UPSTREAM + path
        # 读请求体（POST /api/chat 带 JSON）
        body = None
        clen = self.headers.get("Content-Length")
        if clen:
            try: body = self.rfile.read(int(clen))
            except Exception: body = None
        # 透传必要请求头（去掉 Host/Content-Length，让 requests 重算）
        fwd_headers = {}
        for h in ("Content-Type", "Accept"):
            v = self.headers.get(h)
            if v: fwd_headers[h] = v
        try:
            # stream=True + 长读超时(隧道级)：agent 深查可能 1-2 分钟；连接超时短、读超时长。
            up = requests.request(
                method, url, data=body, headers=fwd_headers,
                stream=True, timeout=(6, 300),
            )
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            try: self.wfile.write(('{"error":"agent upstream unreachable: %s"}' % str(e)[:120]).encode())
            except Exception: pass
            return True
        # 回写状态行 + 头（透传 Content-Type；SSE 关缓冲）
        self.send_response(up.status_code)
        ct = up.headers.get("Content-Type", "application/octet-stream")
        self.send_header("Content-Type", ct)
        is_sse = "text/event-stream" in ct
        if is_sse:
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "close")
        self.end_headers()
        try:
            # 原始字节流逐块透传；SSE 用小 chunk + flush 保证增量与心跳即时到达。
            for chunk in up.iter_content(chunk_size=1):
                if not chunk:
                    continue
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端断开，正常
        except Exception as e:
            log("proxy stream error:", str(e)[:120])
        finally:
            try: up.close()
            except Exception: pass
        return True

    def do_GET(self):
        if self._gate():            # login gate (no-op when TOPO_AUTH=off)
            return
        if self._proxy("GET"):
            return
        return super().do_GET()

    def do_HEAD(self):
        if self._gate():
            return
        return super().do_HEAD()

    def do_POST(self):
        if self._gate():            # login gate (no-op when TOPO_AUTH=off)
            return
        if self._proxy("POST"):
            return
        self.send_response(405); self.end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            # 同源(都在 8080)其实不需要 CORS，但保留 OPTIONS 兜底
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_response(405); self.end_headers()

def serve():
    httpd = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    log("http server on :%d serving %s" % (HTTP_PORT, WEB_DIR))
    httpd.serve_forever()

# ---------------- probe (P4 校准用) ----------------
def probe():
    """打印每台设备各命令的原始 XML 片段 + ES 聚合，用于校准解析器。不写 status.json。"""
    cmds = {
        "resources": "<show><system><resources></resources></system></show>",
        "session": "<show><session><info></info></session></show>",
        "ipsec": "<show><vpn><ipsec-sa></ipsec-sa></vpn></show>",
        "bgp": "<show><routing><protocol><bgp><peer></peer></bgp></protocol></routing></show>",
        "gp": "<show><global-protect-gateway><current-user></current-user></global-protect-gateway></show>",
    }
    for nid, cfg in DEVICES.items():
        key = (os.environ.get(cfg["key_env"]) or os.environ.get(cfg.get("key_env_legacy", ""), "")).strip()
        print("\n==================== %s (%s) key=%s ====================" % (nid, cfg["host"], "yes" if key else "MISSING"))
        if not key: continue
        for cname, cmd in cmds.items():
            try:
                res = panos_op(cfg["host"], key, cmd)
                raw = ET.tostring(res, encoding="unicode")
                print("\n----- %s ----- (%d chars)\n%s" % (cname, len(raw), raw[:1500]))
            except Exception as e:
                print("\n----- %s ----- ERROR: %s" % (cname, str(e)[:150]))
    print("\n==================== ES aggregations ====================")
    print("traffic 5m by host:", json.dumps(es_traffic_rate_by_host(5), ensure_ascii=False))
    print("threats 60m by host:", json.dumps(es_threats_by_host(60), ensure_ascii=False))
    print("sls 15m count:", es_sls_count(15))

# ---------------- main ----------------
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--probe":
        probe(); sys.exit(0)
    if not os.path.isdir(WEB_DIR):
        log("FATAL: WEB_DIR not found:", WEB_DIR); sys.exit(1)
    # 启动即先写一份占位（若不存在），避免前端首次 404
    if not os.path.exists(STATUS_FILE):
        try:
            write_atomic({"generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
                          "poll_interval": POLL_INTERVAL, "collector": "starting",
                          "nodes": {}, "links": {}})
        except Exception:
            pass
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    serve()
