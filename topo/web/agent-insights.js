/* ============================================================
   agent-insights.js — Insights + Activity tabs of the agent dock  v15
   Insights : continuous detection rules evaluated on every live telemetry
              snapshot (status.json, ~30s). Each finding can be handed to the
              agent for a root-cause investigation with one click.
   Activity : connector (MCP) status, guardrail mode, and the audit trail of
              every tool call / approval the agent made (GET /api/audit).
   ============================================================ */
(function () {
  'use strict';
  var AGENT_URL = window.NETSEC_AGENT_URL || (location.protocol + '//' + location.host);

  var NAME = {
    gpgw: 'sase-external-gw', scvm: 'scvm-aws-hk', 'aws-sg': 'scvm-aws-sg', aivm: 'aivm-alibaba', prisma: 'Prisma Access',
    elk: 'ELK', airs: 'Prisma AIRS', koi: 'KOI', 'dc-hk': 'Data Center (HK)', 'dc-sg': 'Data Center (SG)',
    'gp-sh': 'GP users (sase-external-gw)', 'gp-jp': 'GP users (aivm)'
  };
  var LINK = {
    'rn-azure-hk': { label: 'Remote Network Azure-HK (sase-external-gw ⇄ Prisma)', node: 'gpgw' },
    'rn-azure-cn': { label: 'Remote Network Azure-CN (sase-external-gw ⇄ Prisma)', node: 'gpgw' },
    'rn-alibaba': { label: 'Remote Network Alibaba (aivm-alibaba ⇄ Prisma)', node: 'aivm' },
    'sc-aws-hk': { label: 'Service Connection HK (scvm-aws-hk ⇄ Prisma)', node: 'scvm' },
    'sc-aws-sg': { label: 'Service Connection SG (scvm-aws-sg ⇄ Prisma)', node: 'aws-sg' },
    'gp-sh': { label: 'GlobalProtect gateway on sase-external-gw', node: 'gpgw' },
    'gp-jp': { label: 'GlobalProtect gateway on aivm-alibaba', node: 'aivm' },
    'syslog-gpgw': { label: 'Syslog sase-external-gw → ELK', node: 'elk' },
    'syslog-scvm': { label: 'Syslog scvm-aws-hk → ELK', node: 'elk' },
    'syslog-aivm': { label: 'Syslog aivm-alibaba → ELK', node: 'elk' },
    'syslog-prisma': { label: 'Prisma SLS logs → ELK', node: 'elk' }
  };
  var CONNECTORS = [
    { id: 'scm', label: 'Strata Cloud Manager', sub: 'Prisma Access config & SASE' },
    { id: 'panos-sase-external-gw', label: 'sase-external-gw', sub: 'PAN-OS NGFW · Azure' },
    { id: 'panos-scvm-aws-hk', label: 'scvm-aws-hk', sub: 'PAN-OS NGFW · AWS HK' },
    { id: 'panos-scvm-aws-sg', label: 'scvm-aws-sg', sub: 'PAN-OS NGFW · AWS SG' },
    { id: 'panos-aivm-alibaba', label: 'aivm-alibaba', sub: 'PAN-OS AI Runtime · Alibaba' },
    { id: 'elk', label: 'ELK', sub: 'Log search & analytics' },
    { id: 'prisma-airs', label: 'Prisma AIRS', sub: 'AI Runtime Security' },
    { id: 'koi', label: 'KOI', sub: 'Software supply chain' }
  ];
  var SEV_ORDER = { critical: 0, warning: 1, info: 2 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clock(d) { function p(x) { return (x < 10 ? '0' : '') + x; } return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

  // ---------- styles ----------
  var css = ''
    + '.ins-wrap,.act-wrap{flex:1;overflow-y:auto;padding:12px 14px;}'
    + '.ins-head{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12px;color:#8b97ad;}'
    + '.ins-head b{color:#e6ebf5;font-size:13px;}'
    + '.ins-head .sp{flex:1;}'
    + '.ins-head button,.act-wrap .rf{background:#101a2c;border:1px solid #22304a;color:#c9d2e3;border-radius:7px;padding:4px 9px;cursor:pointer;font:inherit;font-size:11.5px;}'
    + '.ins{position:relative;border:1px solid #22304a;background:#0f1729;border-radius:11px;padding:10px 12px 10px 15px;margin:0 0 9px;overflow:hidden;}'
    + '.ins::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#64748b;}'
    + '.ins.critical::before{background:#f43f5e;}.ins.warning::before{background:#f59e0b;}.ins.info::before{background:#3b9cff;}.ins.ok::before{background:#22c55e;}'
    + '.ins .t{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;color:#f3f6fb;}'
    + '.ins .sev{font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:1px 6px;border-radius:5px;background:#334155;color:#fff;}'
    + '.ins.critical .sev{background:#be123c;}.ins.warning .sev{background:#b45309;}.ins.info .sev{background:#1d4ed8;}.ins.ok .sev{background:#15803d;}'
    + '.ins .d{font-size:12px;color:#aab4c6;margin:5px 0 8px;line-height:1.5;}'
    + '.ins .d code{background:#0a101c;border:1px solid #22304a;border-radius:4px;padding:0 4px;font-size:11.5px;color:#9fe0c0;}'
    + '.ins .a{display:flex;gap:7px;flex-wrap:wrap;}'
    + '.ins .a button{border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit;font-size:12px;border:1px solid #2c3a58;background:#0b1220;color:#c9d2e3;}'
    + '.ins .a button.go{border:none;background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;font-weight:700;}'
    + '.ins-foot{font-size:11px;color:#5b6b85;margin-top:12px;line-height:1.5;}'
    + '.act-sec{margin:0 0 16px;}'
    + '.act-sec h5{margin:0 0 8px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8b97ad;display:flex;align-items:center;gap:8px;}'
    + '.act-sec h5 .sp{flex:1;}'
    + '.conn{display:grid;grid-template-columns:1fr 1fr;gap:6px;}'
    + '.conn div{display:flex;gap:8px;align-items:center;background:#0f1729;border:1px solid #22304a;border-radius:9px;padding:6px 8px;min-width:0;}'
    + '.conn i{width:8px;height:8px;border-radius:50%;flex:none;background:#64748b;}'
    + '.conn .on i{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.8);}.conn .miss i{background:#f43f5e;}'
    + '.conn span{min-width:0;}.conn b{display:block;font-size:12px;color:#e6ebf5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.conn small{display:block;font-size:10.5px;color:#8b97ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.guard{font-size:12px;color:#c9d2e3;background:#0f1729;border:1px solid #22304a;border-radius:9px;padding:8px 10px;line-height:1.6;}'
    + '.guard b{color:#fff;}'
    + '.aud{display:flex;flex-direction:column;gap:3px;}'
    + '.aud .r{display:flex;gap:8px;align-items:baseline;font-size:11.5px;font-family:Consolas,monospace;padding:4px 6px;border-radius:6px;background:#0c1422;white-space:nowrap;overflow:hidden;}'
    + '.aud .ts{color:#5b6b85;}.aud .k{font-size:9.5px;font-weight:800;padding:0 5px;border-radius:4px;background:#1e3a5f;color:#93c5fd;}'
    + '.aud .k.write{background:#78350f;color:#fde68a;}.aud .k.approve{background:#14532d;color:#86efac;}.aud .k.reject,.aud .k.timeout,.aud .k.client_gone{background:#4c0519;color:#fda4af;}'
    + '.aud .dv{color:#c4b5fd;}.aud .op{color:#67e8f9;overflow:hidden;text-overflow:ellipsis;}'
    + '.aud .empty{font-size:12px;color:#8b97ad;font-family:inherit;}';

  // ======================= INSIGHTS =======================
  var insWrap, insList, insMeta, lastFindings = [], lastEval = null;

  function evaluate(snap) {
    var f = [];
    var nodes = (snap && snap.nodes) || {}, links = (snap && snap.links) || {};
    var iv = (snap && snap.poll_interval) || 30;
    if (snap && snap.generated_at) {
      var age = (Date.now() - Date.parse(snap.generated_at)) / 1000;
      if (age > iv * 3) f.push({ sev: 'warning', node: null, title: 'Live telemetry is stale',
        detail: 'The last snapshot is ' + Math.round(age) + 's old (threshold ' + iv * 3 + 's). Map status may not reflect reality.',
        ask: 'The topology collector has not refreshed status for ' + Math.round(age) + ' seconds. Check whether the NGFW XML API and ELK are reachable and report what is failing.' });
    }
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id], nm = NAME[id] || id;
      if (n.status === 'down') f.push({ sev: 'critical', node: id, title: nm + ' is down',
        detail: 'The collector reports the device as down' + (n.error ? ': <code>' + esc(n.error) + '</code>' : '.'),
        ask: nm + ' is reported down by the monitoring collector. Investigate reachability, management access and recent system logs, and give the root cause.' });
      else if (n.status === 'unknown' || n.error) f.push({ sev: 'warning', node: id, title: 'Telemetry collection failed for ' + nm,
        detail: n.error ? '<code>' + esc(n.error) + '</code>' : 'No data returned in the last poll.',
        ask: 'Live telemetry collection from ' + nm + ' is failing' + (n.error ? ' (' + n.error + ')' : '') + '. Check whether the device and its API are reachable and healthy.' });
      if (n.cpu != null && n.cpu >= 80) f.push({ sev: n.cpu >= 90 ? 'critical' : 'warning', node: id, title: 'High CPU on ' + nm + ' (' + n.cpu + '%)',
        detail: 'Data-plane / management CPU above ' + (n.cpu >= 90 ? 90 : 80) + '%.',
        ask: 'CPU on ' + nm + ' is at ' + n.cpu + '%. Find what is driving the load (sessions, traffic, threats, processes) and recommend actions.' });
      if (n.mem != null && n.mem >= 85) f.push({ sev: n.mem >= 95 ? 'critical' : 'warning', node: id, title: 'High memory on ' + nm + ' (' + n.mem + '%)',
        detail: 'Memory utilization above ' + (n.mem >= 95 ? 95 : 85) + '%.',
        ask: 'Memory on ' + nm + ' is at ' + n.mem + '%. Investigate the cause and whether action is needed.' });
      if (n.bgp && n.bgp.length) {
        var bad = n.bgp.filter(function (b) { return String(b.state || '').toLowerCase() !== 'established'; });
        if (bad.length) f.push({ sev: 'warning', node: id,
          title: bad.length + ' BGP peer' + (bad.length > 1 ? 's' : '') + ' not established on ' + nm,
          detail: bad.map(function (b) { return '<code>' + esc(b.peer) + '</code> → ' + esc(b.state); }).join('<br>'),
          ask: 'On ' + nm + ', these BGP peers are not established: ' + bad.map(function (b) { return b.peer + ' (state ' + b.state + ')'; }).join(', ')
            + '. For each one, determine whether it is expected (unused / decommissioned) or a real fault, check the tunnel and peer config, and give the root cause and fix.' });
      }
      if (n.threats_1h) {
        var t = n.threats_1h, c = t.critical || 0, h = t.high || 0;
        if (c + h > 0) f.push({ sev: c > 0 ? 'critical' : 'warning', node: id, title: (c + h) + ' critical/high threats on ' + nm + ' (last 1h)',
          detail: 'Critical ' + c + ' · High ' + h + ' · Medium ' + (t.medium || 0) + ' · Low ' + (t.low || 0),
          ask: 'There were ' + c + ' critical and ' + h + ' high severity threats on ' + nm + ' in the last hour. Summarize them from the threat logs (signatures, sources, destinations, actions) and tell me if anything was allowed that should be blocked.' });
      }
    });
    Object.keys(links).forEach(function (lid) {
      var l = links[lid], meta = LINK[lid] || { label: lid, node: null };
      if (l.tunnel === 'down') f.push({ sev: 'critical', node: meta.node, title: 'Link down: ' + meta.label,
        detail: 'Tunnel / feed state is <code>down</code>.',
        ask: meta.label + ' is down. Investigate the IPsec tunnel (IKE / IPsec SA), routing and recent system logs on both ends and give the root cause.' });
      else if (l.bgp && ['established', 'static', 'n/a'].indexOf(String(l.bgp).toLowerCase()) < 0) f.push({ sev: 'warning', node: meta.node,
        title: 'BGP not established on ' + meta.label, detail: 'Tunnel is up but BGP is <code>' + esc(l.bgp) + '</code>.',
        ask: 'On ' + meta.label + ' the tunnel is up but BGP is ' + l.bgp + '. Find out why the session is not established.' });
    });
    var pr = nodes.prisma;
    if (pr && pr.sls_logs_15m === 0) f.push({ sev: 'warning', node: 'elk', title: 'No Prisma Access logs reaching ELK',
      detail: '0 SLS log records in the last 15 minutes.',
      ask: 'ELK received no Prisma Access (SLS) logs in the last 15 minutes. Check the log forwarding path and tell me where it breaks.' });
    f.sort(function (a, b) { return SEV_ORDER[a.sev] - SEV_ORDER[b.sev]; });
    return f;
  }

  function renderInsights() {
    if (!insList) return;
    var f = lastFindings;
    var crit = f.filter(function (x) { return x.sev === 'critical'; }).length;
    insMeta.innerHTML = '<b>' + (f.length ? f.length + ' active insight' + (f.length > 1 ? 's' : '') : 'All clear') + '</b>'
      + (crit ? ' · <span style="color:#fb7185">' + crit + ' critical</span>' : '');
    insList.innerHTML = '';
    if (!lastEval) {
      insList.innerHTML = '<div class="ins info"><div class="t"><span class="sev">WAITING</span>Waiting for live telemetry…</div></div>';
    } else if (!f.length) {
      var ok = document.createElement('div');
      ok.className = 'ins ok';
      ok.innerHTML = '<div class="t"><span class="sev">OK</span>No issues detected in live telemetry</div>'
        + '<div class="d">All monitored tunnels, BGP sessions and device resources are within thresholds.</div>'
        + '<div class="a"><button class="go">✦ Ask the agent for a full health check</button></div>';
      ok.querySelector('.go').onclick = function () {
        window.NSA && window.NSA.ask('Run a full health check across all firewalls, Prisma Access, and log pipelines, and highlight anything that deviates from baseline.', { send: true });
      };
      insList.appendChild(ok);
    }
    f.forEach(function (x) {
      var d = document.createElement('div');
      d.className = 'ins ' + x.sev;
      d.innerHTML = '<div class="t"><span class="sev">' + x.sev.toUpperCase() + '</span>' + esc(x.title) + '</div>'
        + '<div class="d">' + x.detail + '</div>'
        + '<div class="a"><button class="go">✦ Investigate with agent</button>' + (x.node ? '<button class="mp">Show on map</button>' : '') + '</div>';
      d.querySelector('.go').onclick = function () { window.NSA && window.NSA.ask(x.ask, { send: true }); };
      var mp = d.querySelector('.mp');
      if (mp) mp.onclick = function () { if (window.focusNode) window.focusNode(x.node); if (window.openNode) window.openNode(x.node); };
      insList.appendChild(d);
    });
    var foot = document.createElement('div');
    foot.className = 'ins-foot';
    foot.textContent = 'Detection rules run on every live telemetry snapshot (~30s): device state, tunnels, BGP, CPU / memory, threats and log pipelines.'
      + (lastEval ? ' Last evaluated ' + clock(lastEval) + '.' : '');
    insList.appendChild(foot);

    // badges: dock tab + header chip
    var badge = document.getElementById('ins-badge'), chip = document.getElementById('inschip');
    if (badge) { badge.textContent = f.length || ''; badge.className = 'badge' + (f.length ? ' show' : '') + (crit ? ' crit' : ''); }
    if (chip) {
      chip.className = f.length ? ('show' + (crit ? ' crit' : '')) : '';
      chip.querySelector('.txt').textContent = f.length + ' insight' + (f.length > 1 ? 's' : '') + (crit ? ' · ' + crit + ' critical' : '');
    }
  }

  function buildInsights() {
    var tab = document.getElementById('tab-insights'); if (!tab) return;
    tab.innerHTML = '<div class="ins-wrap"><div class="ins-head"><span class="m"></span><span class="sp"></span>'
      + '<button class="re">↻ Re-evaluate</button></div><div class="list"></div></div>';
    insMeta = tab.querySelector('.m'); insList = tab.querySelector('.list');
    tab.querySelector('.re').onclick = function () { if (window.TOPO_LAST) onSnapshot(window.TOPO_LAST); };
    var chip = document.getElementById('inschip');
    if (chip) chip.onclick = function () { if (window.NSA) { window.NSA.open(); window.NSA.showTab('insights'); } };
    renderInsights();
  }
  function onSnapshot(snap) { lastFindings = evaluate(snap); lastEval = new Date(); renderInsights(); }

  // ======================= ACTIVITY =======================
  var actConn, actGuard, actAud, actTimer = null, actVisible = false;

  function renderHealth(h) {
    if (!actConn) return;
    actConn.innerHTML = CONNECTORS.map(function (c) {
      var st = !h ? 'off' : (h.mcp || []).indexOf(c.id) >= 0 ? 'on'
        : (h.missing || []).some(function (m) { return String(m).indexOf(c.id) === 0; }) ? 'miss' : 'off';
      var tip = st === 'on' ? 'connected' : st === 'miss' ? 'not configured (missing credentials)' : 'unknown';
      return '<div class="' + st + '" title="' + esc(c.id + ' · ' + tip) + '"><i></i><span><b>' + esc(c.label) + '</b><small>' + esc(c.sub) + '</small></span></div>';
    }).join('');
    if (!h) { actGuard.innerHTML = 'Agent backend is <b>offline</b>.'; return; }
    var mode = h.mode === 'readonly'
      ? '<b>Read-only</b> — the agent can investigate, but every configuration change is blocked by a guardrail.'
      : (h.approval
        ? '<b>Autonomous with human approval</b> — the agent can propose configuration changes; each one waits for your Approve / Reject (auto-reject after ' + Math.round((h.approval_timeout_ms || 180000) / 1000) + 's).'
        : '<b>Fully autonomous</b> — configuration changes run without confirmation.');
    actGuard.innerHTML = mode + '<br>Built-in shell / file tools are disabled; the agent acts only through the connectors above. Every tool call is written to the audit log.'
      + '<br><span style="color:#8b97ad">Models: ' + esc(String(h.model || '').replace(/^us\.anthropic\./, '')) + (h.model_light ? ' / ' + esc(String(h.model_light).replace(/^us\.anthropic\./, '')) : '') + '</span>';
  }

  function loadAudit() {
    if (!actAud) return;
    fetch(AGENT_URL + '/api/audit?limit=80', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).then(function (j) {
      var items = j.items || [];
      if (!items.length) { actAud.innerHTML = '<div class="r empty">No agent actions recorded yet.</div>'; return; }
      var today = new Date().toDateString();
      actAud.innerHTML = items.map(function (it) {
        var d = new Date(it.ts), m = /^mcp__(.+?)__(.+)$/.exec(it.tool || '') || [null, '', it.tool];
        var kind = it.kind === 'approval' ? (it.decision || 'approval') : (it.kind || 'read');
        var label = { read: 'READ', write: 'WRITE', approve: 'APPROVED', reject: 'REJECTED', timeout: 'TIMEOUT', client_gone: 'NOT APPLIED' }[kind] || kind.toUpperCase();
        var ts = (d.toDateString() === today ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + clock(d);
        var extra = it.op ? ' ' + it.op : (it.name ? ' ' + it.name : '');
        return '<div class="r" title="' + esc((it.tool || '') + extra + (it.session ? '  · session ' + it.session : '')) + '"><span class="ts">' + esc(ts)
          + '</span><span class="k ' + esc(kind) + '">' + esc(label) + '</span><span class="dv">' + esc(String(m[1]).replace('gpgw-azure', 'sase-external-gw')) /* legacy audit records */ + '</span><span class="op">' + esc(m[2] + extra) + '</span></div>';
      }).join('');
    }).catch(function (e) {
      actAud.innerHTML = '<div class="r empty">Audit trail unavailable (' + esc(e.message) + ').</div>';
    });
  }

  function buildActivity() {
    var tab = document.getElementById('tab-activity'); if (!tab) return;
    tab.innerHTML = '<div class="act-wrap">'
      + '<div class="act-sec"><h5>Connectors (MCP)</h5><div class="conn"></div></div>'
      + '<div class="act-sec"><h5>Guardrails</h5><div class="guard">Loading…</div></div>'
      + '<div class="act-sec"><h5>Agent actions · audit trail<span class="sp"></span><button class="rf">↻</button></h5><div class="aud"><div class="r empty">Loading…</div></div></div>'
      + '</div>';
    actConn = tab.querySelector('.conn'); actGuard = tab.querySelector('.guard'); actAud = tab.querySelector('.aud');
    tab.querySelector('.rf').onclick = loadAudit;
    if (window.NSA_HEALTH !== undefined) renderHealth(window.NSA_HEALTH);
  }

  // ---------- wiring ----------
  function init() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    buildInsights(); buildActivity();
    if (window.TOPO_LAST) onSnapshot(window.TOPO_LAST);
    window.addEventListener('topo:snapshot', function (e) { onSnapshot(e.detail); });
    window.addEventListener('nsa:health', function (e) { renderHealth(e.detail); });
    window.addEventListener('nsa:done', function () { if (actVisible) loadAudit(); });
    window.addEventListener('nsa:tab', function (e) {
      actVisible = e.detail === 'activity';
      if (actTimer) { clearInterval(actTimer); actTimer = null; }
      if (actVisible) { loadAudit(); actTimer = setInterval(loadAudit, 20000); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
