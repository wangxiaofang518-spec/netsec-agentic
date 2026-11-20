/* ============================================================
   topo-live.js — 动态状态层
   消费同目录 status.json（由 collector 每 POLL_INTERVAL 秒原子写入），
   渲染：节点状态灯 + 实时指标行 + 链路 up/down + 顶栏新鲜度 + 详情面板实时小节。
   纯增量：不改动 index.html 内联脚本的既有逻辑，只读取其暴露的
   全局 openNode / CURRENT_NODE，并挂 window.renderLivePanel 供详情面板调用。
   ============================================================ */
(function () {
  'use strict';

  var STATUS_URL = 'status.json';
  var FALLBACK_INTERVAL = 30;      // 秒；若 status.json 未给 poll_interval 则用它
  var timer = null;
  var LAST = null;                 // 最近一次成功解析的快照

  // 节点 id → 该节点关联的链路 id（用于把链路状态汇总进节点灯）
  var NODE_LINKS = {
    gpgw: ['rn-azure-hk', 'rn-azure-cn', 'gp-sh', 'syslog-gpgw'],
    scvm: ['sc-aws-hk', 'syslog-scvm'],
    aivm: ['rn-alibaba', 'gp-jp', 'syslog-aivm'],
    prisma: ['sc-aws-hk', 'sc-aws-sg', 'rn-azure-hk', 'rn-azure-cn', 'rn-alibaba']
  };

  // 静态节点（无实时数据源）：直接标蓝灰静态灯
  var STATIC_NODES = { 'airs': 1, 'koi': 1, 'aws-sg': 1, 'dc-hk': 1, 'dc-sg': 1, 'gp-sh': 1, 'gp-jp': 1, 'elk': 1 };

  var STATE_CLASS = {
    up: 'st-up', down: 'st-down', warn: 'st-warn',
    unknown: 'st-unknown', static: 'st-static',
    inferred: 'st-warn', receiving: 'st-up'
  };

  // ---------- helpers ----------
  function fmtbps(bps) {
    if (bps == null || isNaN(bps)) return '—';
    var u = ['bps', 'Kbps', 'Mbps', 'Gbps'], i = 0, v = bps;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
  }
  function num(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function nodeEl(id) { return document.querySelector('.node[data-id="' + CSS.escape(id) + '"]'); }

  function ensureLed(node) {
    var h3 = node.querySelector('h3');
    if (!h3) return null;
    var led = h3.querySelector('.stled');
    if (!led) { led = document.createElement('span'); led.className = 'stled'; h3.appendChild(led); }
    return led;
  }
  function ensureLiveRow(node) {
    var row = node.querySelector('.live');
    if (!row) { row = document.createElement('div'); row.className = 'live empty'; node.appendChild(row); }
    return row;
  }
  function setLed(node, state, title) {
    var led = ensureLed(node); if (!led) return;
    led.className = 'stled ' + (STATE_CLASS[state] || 'st-unknown');
    led.title = title || state || '';
  }

  // ---------- render one node's metric row ----------
  function renderNodeLive(id, nd) {
    var node = nodeEl(id); if (!node) return;
    // static node: fixed led, no metric row content
    if (STATIC_NODES[id] && (!nd || nd.status === 'static')) {
      setLed(node, 'static', 'Static / no live data source');
      var r0 = ensureLiveRow(node); r0.className = 'live empty'; r0.textContent = 'Static · no live feed';
      return;
    }
    if (!nd) { setLed(node, 'unknown', 'No data'); return; }

    setLed(node, nd.status, statusTitle(id, nd));

    var row = ensureLiveRow(node);
    var parts = [];
    if (nd.status === 'unknown' || nd.error) {
      row.className = 'live empty';
      row.innerHTML = '<span class="m">Collection failed: ' + esc(nd.error || 'unknown') + '</span>';
      return;
    }
    if (nd.cpu != null) parts.push('<span class="m">CPU <b>' + esc(nd.cpu) + '%</b></span>');
    if (nd.mem != null) parts.push('<span class="m">Mem <b>' + esc(nd.mem) + '%</b></span>');
    if (nd.sessions != null) parts.push('<span class="m">Sessions <b>' + num(nd.sessions) + '</b></span>');
    if (nd.gp_users != null) parts.push('<span class="m">GP users <b>' + num(nd.gp_users) + '</b></span>');
    if (nd.traffic_bps != null) parts.push('<span class="m">↑ <b>' + fmtbps(nd.traffic_bps) + '</b></span>');
    if (nd.threats_1h) {
      var t = nd.threats_1h, crit = (t.critical || 0) + (t.high || 0);
      parts.push('<span class="m' + (crit > 0 ? ' hi' : '') + '">Threats 1h <b>' + num((t.critical || 0) + (t.high || 0) + (t.medium || 0) + (t.low || 0)) + '</b></span>');
    }
    if (id === 'prisma' && nd.sls_logs_15m != null)
      parts.push('<span class="m">SLS logs 15m <b>' + num(nd.sls_logs_15m) + '</b></span>');

    if (parts.length) { row.className = 'live'; row.innerHTML = parts.join(''); }
    else { row.className = 'live empty'; row.textContent = (nd.note || 'Online'); }
  }

  function statusTitle(id, nd) {
    if (!nd) return '';
    var s = nd.status || '';
    if (nd.error) return s + ' · ' + nd.error;
    if (nd.stale) return s + ' · stale data';
    return s;
  }

  // ---------- render links ----------
  function renderLinks(links) {
    if (!links) return;
    document.querySelectorAll('[data-link]').forEach(function (ln) {
      var id = ln.getAttribute('data-link');
      var lk = links[id];
      ln.classList.remove('link-down', 'link-warn');
      if (!lk) return;
      // tunnel down => red; tunnel up but bgp not established => warn
      if (lk.tunnel === 'down') ln.classList.add('link-down');
      else if (lk.bgp && lk.bgp !== 'established' && lk.bgp !== 'static' && lk.bgp !== 'n/a') ln.classList.add('link-warn');
    });
  }

  // ---------- detail panel live section (called by openNode in index.html) ----------
  window.renderLivePanel = function (id) {
    if (!LAST || !LAST.nodes) return '';
    var nd = LAST.nodes[id];
    if (!nd) return '';
    if (STATIC_NODES[id] && nd.status === 'static')
      return '<div class="livebox"><span class="lg" style="background:var(--static);opacity:.5"></span>Static component · no live data source</div>';

    var color = ({ up: 'var(--up)', down: 'var(--down)', warn: 'var(--warn)', inferred: 'var(--warn)', unknown: 'var(--unknown)' })[nd.status] || 'var(--unknown)';
    var rows = [];
    rows.push('<span class="lg" style="background:' + color + '"></span><b>Status: ' + esc(nd.status || 'unknown') + '</b>' + (nd.stale ? ' <span style="color:var(--warn)">(stale)</span>' : ''));
    if (nd.error) rows.push('<div>Collection error: <code>' + esc(nd.error) + '</code></div>');
    var kv = [];
    if (nd.cpu != null) kv.push('CPU ' + nd.cpu + '%');
    if (nd.mem != null) kv.push('Mem ' + nd.mem + '%');
    if (nd.sessions != null) kv.push('Sessions ' + num(nd.sessions));
    if (nd.gp_users != null) kv.push('GP online ' + num(nd.gp_users));
    if (nd.traffic_bps != null) kv.push('Traffic ↑' + fmtbps(nd.traffic_bps));
    if (nd.uptime) kv.push('Uptime ' + esc(nd.uptime));
    if (kv.length) rows.push('<div style="margin-top:4px">' + kv.map(esc).join(' · ') + '</div>');
    if (nd.threats_1h) {
      var t = nd.threats_1h;
      rows.push('<div style="margin-top:4px">Threats (last 1h): critical ' + (t.critical || 0) + ' · high ' + (t.high || 0) + ' · medium ' + (t.medium || 0) + ' · low ' + (t.low || 0) + '</div>');
    }
    if (nd.tunnels && nd.tunnels.length) {
      rows.push('<div style="margin-top:4px">Tunnels: ' + nd.tunnels.map(function (tn) {
        var c = tn.state === 'up' ? 'var(--up)' : (tn.state === 'down' ? 'var(--down)' : 'var(--unknown)');
        return '<span style="color:' + c + '">' + esc(tn.name) + '(' + esc(tn.state) + ')</span>';
      }).join(' · ') + '</div>');
    }
    if (nd.bgp && nd.bgp.length) {
      rows.push('<div style="margin-top:4px">BGP: ' + nd.bgp.map(function (b) {
        var c = b.state === 'established' ? 'var(--up)' : 'var(--warn)';
        return '<span style="color:' + c + '">' + esc(b.peer) + '(' + esc(b.state) + ')</span>';
      }).join(' · ') + '</div>');
    }
    if (id === 'prisma' && nd.sls_logs_15m != null)
      rows.push('<div style="margin-top:4px">SLS logs (last 15m): <b>' + num(nd.sls_logs_15m) + '</b> → Prisma log forwarding ' + (nd.sls_logs_15m > 0 ? 'healthy' : '<span style="color:var(--warn)">nothing received</span>') + '</div>');
    if (nd.note) rows.push('<div style="margin-top:4px;color:var(--muted)">' + esc(nd.note) + '</div>');

    return '<h4>Live Status</h4><div class="livebox">' + rows.join('') + '</div>';
  };

  // ---------- header freshness chip / banner ----------
  function setChip(cls, txt) {
    var chip = document.getElementById('livechip');
    chip.className = cls;
    chip.querySelector('.txt').textContent = txt;
  }
  function setBanner(show, msg) {
    var b = document.getElementById('banner');
    if (show) { b.classList.add('show'); b.querySelector('.msg').textContent = msg || ''; }
    else b.classList.remove('show');
  }

  // ---------- main apply ----------
  function apply(snap) {
    LAST = snap;
    var nodes = snap.nodes || {};
    // every node in DOM
    document.querySelectorAll('.node[data-id]').forEach(function (n) {
      var id = n.getAttribute('data-id');
      renderNodeLive(id, nodes[id]);
    });
    renderLinks(snap.links);
    // broadcast to other layers (agent-insights.js evaluates rules on every snapshot)
    window.TOPO_LAST = snap;
    try { window.dispatchEvent(new CustomEvent('topo:snapshot', { detail: snap })); } catch (e) {}

    // freshness
    var interval = snap.poll_interval || FALLBACK_INTERVAL;
    var age = ageSeconds(snap.generated_at);
    if (age == null) { setChip('ok', 'Updated'); setBanner(false); }
    else if (age > interval * 3) {
      setChip('stale', 'Stale ' + Math.round(age) + 's');
      setBanner(true, 'Last updated ' + Math.round(age) + 's ago (threshold ' + (interval * 3) + 's) — the collector may have stopped.');
    } else {
      setChip('ok', 'Updated · ' + fmtClock(snap.generated_at));
      setBanner(false);
    }

    // refresh open detail panel live section in place
    if (window.CURRENT_NODE) {
      var box = document.querySelector('#panel .livebox');
      if (box) {
        var tmp = document.createElement('div');
        tmp.innerHTML = window.renderLivePanel(window.CURRENT_NODE);
        var newBox = tmp.querySelector('.livebox');
        if (newBox) box.replaceWith(newBox);
      }
    }
  }

  function ageSeconds(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return (Date.now() - t) / 1000;
  }
  function fmtClock(iso) {
    var d = iso ? new Date(iso) : new Date();
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // ---------- fetch loop ----------
  function fetchOnce() {
    fetch(STATUS_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (snap) { apply(snap); })
      .catch(function (e) {
        setChip('err', 'Status unavailable');
        try { window.dispatchEvent(new CustomEvent('topo:snapshot-error', { detail: { message: e.message } })); } catch (x) {}
        setBanner(true, 'Cannot read status.json (' + e.message + '). If the service just started, the collector may still be running its first poll.');
      });
  }
  function schedule() {
    if (timer) clearInterval(timer);
    var iv = (LAST && LAST.poll_interval) ? LAST.poll_interval : FALLBACK_INTERVAL;
    timer = setInterval(fetchOnce, iv * 1000);
  }

  // manual refresh button
  var btn = document.querySelector('[data-refresh]');
  if (btn) btn.addEventListener('click', fetchOnce);

  // kick off
  fetchOnce();
  schedule();
})();
