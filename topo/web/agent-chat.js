/* ============================================================
   agent-chat.js — NetSec-Agentic Copilot (docked agent panel)  v15
   - Mounts into the right-hand #dock (index.html): tabs / collapse / resize.
   - Streams /api/chat (SSE): session / text / thinking / tool / approval /
     approval_result / blocked / done / error.
   - Agentic UX: per-answer "agent trace", live device highlight on the topology
     while the agent queries it, agent-traced PATH overlay, human-in-the-loop
     approval cards for config changes, guardrail notices.
   - UI is English; the agent answers in the language of the question
     (backend detectLang → Chinese question = Chinese answer, English = English).
   ============================================================ */
(function () {
  'use strict';
  var NSA_VERSION = 'v15-2026-11-20-copilot';
  try { console.log('[NetSec-Agentic] agent-chat.js ' + NSA_VERSION + ' loaded'); } catch (e) {}

  // Same-origin by default (topo container reverse-proxies /api/* to netsec-agent:8081).
  var AGENT_URL = window.NETSEC_AGENT_URL || (location.protocol + '//' + location.host);
  var CHAT_ENDPOINT = AGENT_URL + '/api/chat';

  // MCP server → topology node id (for live highlight on the map)
  var SERVER_NODE = {
    'panos-sase-external-gw': 'gpgw', 'panos-gpgw-azure': 'gpgw' /* legacy name */, 'panos-scvm-aws-hk': 'scvm', 'panos-scvm-aws-sg': 'aws-sg',
    'panos-aivm-alibaba': 'aivm', 'scm': 'prisma', 'elk': 'elk', 'koi': 'koi', 'prisma-airs': 'airs'
  };
  var NODE_LABEL = {
    'gp-sh': 'GP users (sase-external-gw)', 'gp-jp': 'GP users (aivm)', gpgw: 'sase-external-gw', aivm: 'aivm-alibaba',
    prisma: 'Prisma Access', scvm: 'scvm-aws-hk', 'aws-sg': 'scvm-aws-sg', 'dc-hk': 'DC HK', 'dc-sg': 'DC SG',
    elk: 'ELK', airs: 'Prisma AIRS', koi: 'KOI'
  };
  var SUGGESTIONS = [
    'Run a health check across all firewalls and Prisma Access',
    'Why are some BGP peers on sase-external-gw not established?',
    'Trace the access path from GlobalProtect user alice to 172.172.200.197',
    'Summarize threat logs from the last 24 hours',
    'alice 访问 172.31.10.10 不通，帮我排查'
  ];

  var sessionId = 'ui-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- lightweight Markdown (every text segment is esc()'d first — model HTML never executes) ----------
  function mdInline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
         .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<i>$2</i>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }
  function mdCells(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split('|').map(function (c) { return c.trim(); });
  }
  function md(src) {
    var lines = String(src || '').replace(/\r/g, '').split('\n');
    var out = [], i = 0, para = [];
    function flush() { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; } }
    while (i < lines.length) {
      var L = lines[i];
      if (/^\s*```/.test(L)) {
        flush(); var buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        var head = mdCells(L), rows = []; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(mdCells(lines[i++]));
        out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('')
          + '</tr></thead><tbody>' + rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>');
        continue;
      }
      var m;
      if ((m = /^\s*(#{1,4})\s+(.*)$/.exec(L))) { flush(); out.push('<h' + (m[1].length + 2) + '>' + mdInline(m[2]) + '</h' + (m[1].length + 2) + '>'); i++; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*>\s?/.test(L)) {
        flush(); var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(mdInline(lines[i++].replace(/^\s*>\s?/, '')));
        out.push('<blockquote>' + q.join('<br>') + '</blockquote>'); continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(L)) {
        flush(); var ordered = /^\s*\d+[.)]\s+/.test(L), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          var ind = /^\s*/.exec(lines[i])[0].length;
          if (ind < 2 && items.length && /^\s*\d+[.)]\s+/.test(lines[i]) !== ordered) break;
          items.push('<li' + (ind >= 2 ? ' class="sub"' : '') + '>' + mdInline(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '')) + '</li>');
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>')); continue;
      }
      if (/^\s*$/.test(L)) { flush(); i++; continue; }
      para.push(L); i++;
    }
    flush();
    return out.join('');
  }

  // ---------- PATH contract (backend asks the model for a final "PATH: a > b > c" line) ----------
  var PATH_RE = /^[ \t]*`?PATH:\s*([^`\n]+?)`?[ \t]*$/m;
  function extractPath(text) {
    var m = PATH_RE.exec(text || '');
    if (!m) return null;
    var ids = m[1].split(/\s*(?:>|→|->)\s*/).map(function (x) { return x.trim().toLowerCase(); })
      .filter(function (x) { return !!document.querySelector('.node[data-id="' + x + '"]'); });
    return ids.length >= 3 ? ids : null;   // a real end-to-end path has 3+ hops (src → transit → dst)
  }
  function stripPath(text) {
    // drop complete PATH lines (also a partial one still streaming: $ matches end of text)
    var t = String(text || '').replace(/^[ \t]*`?PATH:[^\n]*$/gm, '');
    // while streaming, hide a last line that is only the beginning of "PATH:"
    var i = t.lastIndexOf('\n'), last = t.slice(i + 1).trim().replace(/^`/, '');
    if (last && last.length <= 5 && 'PATH:'.indexOf(last) === 0) t = t.slice(0, i + 1);
    return t.replace(/\s+$/, '');
  }
  function renderMd(el, text) { el.classList.add('nsa-md'); el.innerHTML = md(stripPath(text)); }

  // ---------- map integration ----------
  var MAP = {
    active: {},
    activate: function (id, label) {
      var n = document.querySelector('.node[data-id="' + id + '"]'); if (!n) return;
      var b = n.querySelector('.agentbadge');
      if (!b) { b = document.createElement('span'); b.className = 'agentbadge'; n.appendChild(b); }
      b.textContent = '✦ Agent: ' + (label || 'querying…');
      n.classList.add('agent-active', 'agent-touched');
      this.active[id] = 1;
    },
    settle: function () {
      for (var id in this.active) {
        var n = document.querySelector('.node[data-id="' + id + '"]');
        if (n) n.classList.remove('agent-active');
      }
      this.active = {};
    },
    clearTouched: function () {
      this.settle();
      document.querySelectorAll('.node.agent-touched').forEach(function (n) { n.classList.remove('agent-touched'); });
    },
    drawPath: function (ids) {
      this.clearPath();
      var svg = document.getElementById('pathsvg'); if (!svg) return;
      var pts = [];
      ids.forEach(function (id, i) {
        var n = document.querySelector('.node[data-id="' + id + '"]'); if (!n) return;
        pts.push([n.offsetLeft + n.offsetWidth / 2, n.offsetTop + n.offsetHeight / 2]);
        n.classList.add('on-path');
        var s = document.createElement('span'); s.className = 'pathstep'; s.textContent = String(i + 1); n.appendChild(s);
      });
      if (pts.length < 2) return;
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M' + pts.map(function (q) { return q[0] + ',' + q[1]; }).join(' L'));
      svg.appendChild(p);
      var bar = document.getElementById('pathbar');
      if (bar) {
        bar.querySelector('.p').textContent = ids.map(function (x) { return NODE_LABEL[x] || x; }).join('  →  ');
        bar.classList.add('show');
      }
      if (window.fitTopo) window.fitTopo();
    },
    clearPath: function () {
      var svg = document.getElementById('pathsvg'); if (svg) svg.innerHTML = '';
      document.querySelectorAll('.node.on-path').forEach(function (n) { n.classList.remove('on-path'); });
      document.querySelectorAll('.node .pathstep').forEach(function (s) { s.remove(); });
      var bar = document.getElementById('pathbar'); if (bar) bar.classList.remove('show');
    }
  };
  window.NSA_MAP = MAP;

  // ---------- styles (chat area; dock chrome lives in index.html) ----------
  var css = ''
    + '#nsa-log{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;}'
    + '#nsa-log>*{flex-shrink:0;}'
    + '.nsa-msg{max-width:94%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;}'
    + '.nsa-user{align-self:flex-end;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;border-bottom-right-radius:4px;}'
    + '.nsa-bot{align-self:flex-start;background:#111a2b;border:1px solid #22304a;color:#e6ebf5;border-bottom-left-radius:4px;}'
    + '.nsa-md{white-space:normal;}'
    + '.nsa-md>:first-child{margin-top:0;}.nsa-md>:last-child{margin-bottom:0;}'
    + '.nsa-md p{margin:0 0 8px;}'
    + '.nsa-md h3,.nsa-md h4,.nsa-md h5,.nsa-md h6{margin:10px 0 6px;color:#a5f3fc;font-size:14px;}'
    + '.nsa-md h5,.nsa-md h6{font-size:13px;}'
    + '.nsa-md b{color:#fff;}'
    + '.nsa-md ul,.nsa-md ol{margin:4px 0 8px;padding-left:20px;}.nsa-md li{margin:2px 0;}.nsa-md li.sub{margin-left:16px;}'
    + '.nsa-md code{background:#0a101c;border:1px solid #22304a;border-radius:4px;padding:0 4px;font:12px Consolas,monospace;color:#9fe0c0;}'
    + '.nsa-md pre{background:#0a101c;border:1px solid #22304a;border-radius:7px;padding:8px 10px;overflow-x:auto;margin:6px 0 8px;}'
    + '.nsa-md pre code{background:none;border:none;padding:0;white-space:pre;color:#cfd8e3;}'
    + '.nsa-md table{border-collapse:collapse;margin:6px 0 10px;font-size:12px;display:block;overflow-x:auto;max-width:100%;}'
    + '.nsa-md th,.nsa-md td{border:1px solid #26344f;padding:4px 8px;text-align:left;vertical-align:top;}'
    + '.nsa-md th{background:#16223a;color:#a5f3fc;white-space:nowrap;}'
    + '.nsa-md tr:nth-child(even) td{background:#0e1626;}'
    + '.nsa-md blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid #8b5cf6;color:#b8c2d2;}'
    + '.nsa-md hr{border:none;border-top:1px solid #26344f;margin:10px 0;}'
    + '.nsa-err{align-self:flex-start;background:rgba(127,29,29,.35);border:1px solid #7f1d1d;color:#fecaca;}'
    // welcome + suggestions
    + '.nsa-welcome{padding:6px 2px 2px;}'
    + '.nsa-welcome h3{margin:4px 0 6px;font-size:16px;background:linear-gradient(135deg,#c4b5fd,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent;}'
    + '.nsa-welcome p{margin:0 0 10px;color:#aab4c6;font-size:12.5px;line-height:1.55;}'
    + '.nsa-caps{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 12px;}'
    + '.nsa-caps div{font-size:11.5px;color:#c9d2e3;background:#0f1729;border:1px solid #22304a;border-radius:8px;padding:6px 8px;}'
    + '.nsa-caps div b{display:block;color:#fff;font-size:12px;margin-bottom:1px;}'
    + '.nsa-sugg{display:flex;flex-direction:column;gap:6px;}'
    + '.nsa-sugg button{text-align:left;background:#0f1729;border:1px solid #2c3a58;color:#dbe3f0;border-radius:9px;padding:7px 10px;cursor:pointer;font:inherit;font-size:12.5px;}'
    + '.nsa-sugg button:hover{border-color:#22d3ee;color:#fff;}'
    + '.nsa-sugg button::before{content:"✦ ";color:#22d3ee;}'
    // agent trace
    + '.nsa-trace{align-self:stretch;border:1px solid #1f2d47;background:#0a111e;border-radius:10px;font-size:11.5px;}'
    + '.nsa-trace summary{cursor:pointer;list-style:none;padding:6px 10px;color:#9fb0c8;display:flex;align-items:center;gap:7px;user-select:none;}'
    + '.nsa-trace summary::-webkit-details-marker{display:none;}'
    + '.nsa-trace summary::before{content:"▸";color:#22d3ee;transition:transform .15s;}'
    + '.nsa-trace[open] summary::before{transform:rotate(90deg);}'
    + '.nsa-trace .steps{padding:0 10px 8px 10px;display:flex;flex-direction:column;gap:3px;}'
    + '.nsa-step{display:flex;gap:7px;align-items:baseline;font-family:Consolas,monospace;color:#8fb6c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.nsa-step .n{color:#5b6b85;min-width:16px;text-align:right;}'
    + '.nsa-step .dev{color:#c4b5fd;}.nsa-step .tn{color:#67e8f9;font-weight:bold;}.nsa-step .ar{color:#6b7a8d;overflow:hidden;text-overflow:ellipsis;}'
    + '.nsa-step.w .tn{color:#fbbf24;}'
    // status line
    + '.nsa-status{align-self:stretch;display:flex;align-items:center;gap:8px;font-size:12px;color:#c4b5fd;'
    + 'background:linear-gradient(90deg,rgba(139,92,246,.14),rgba(34,211,238,.06));border:1px solid rgba(139,92,246,.35);border-radius:9px;padding:7px 10px;}'
    + '.nsa-status .dot{width:8px;height:8px;border-radius:50%;background:#22d3ee;animation:nsapulse 1s infinite;}'
    + '@keyframes nsapulse{0%,100%{opacity:1;}50%{opacity:.25;}}'
    + '.nsa-status .el{margin-left:auto;font-variant-numeric:tabular-nums;color:#dbe3f0;font-family:Consolas,monospace;}'
    + '.nsa-summary{align-self:stretch;font-size:11px;padding:4px 10px;border-radius:8px;display:flex;align-items:center;gap:8px;font-family:Consolas,monospace;}'
    + '.nsa-summary.ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);color:#86efac;}'
    + '.nsa-summary.bad{background:rgba(127,29,29,.3);border:1px solid #7f1d1d;color:#fda4af;}'
    + '.nsa-pathbtn{align-self:flex-start;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.45);color:#a5f3fc;border-radius:16px;padding:4px 11px;cursor:pointer;font:inherit;font-size:12px;}'
    // approval / guardrail cards
    + '.nsa-card{align-self:stretch;border-radius:11px;padding:10px 12px;font-size:12.5px;}'
    + '.nsa-card .h{display:flex;align-items:center;gap:7px;font-weight:700;margin-bottom:5px;}'
    + '.nsa-card pre{margin:6px 0;max-height:180px;overflow:auto;background:#0a101c;border:1px solid #22304a;border-radius:7px;padding:7px 9px;font:11.5px Consolas,monospace;color:#cfd8e3;white-space:pre-wrap;word-break:break-all;}'
    + '.nsa-card .btns{display:flex;gap:8px;margin-top:8px;align-items:center;}'
    + '.nsa-card .btns button{border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit;font-weight:700;font-size:12.5px;}'
    + '.nsa-card .ap{background:#16a34a;color:#fff;}.nsa-card .rj{background:#334155;color:#fff;}'
    + '.nsa-card .btns button:disabled{opacity:.45;cursor:not-allowed;}'
    + '.nsa-card .cd{margin-left:auto;color:#fbbf24;font-family:Consolas,monospace;font-size:11.5px;}'
    + '.nsa-card.approval{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.55);box-shadow:0 0 20px rgba(245,158,11,.12);}'
    + '.nsa-card.approval .h{color:#fbbf24;}'
    + '.nsa-card.approval.done-approve{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.07);}'
    + '.nsa-card.approval.done-reject{border-color:#475569;background:rgba(71,85,105,.12);}'
    + '.nsa-card .res{font-weight:700;}'
    + '.nsa-card.blocked{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.45);color:#bfdbfe;}'
    // footer
    + '#nsa-foot{border-top:1px solid #22304a;padding:10px 12px 12px;}'
    + '#nsa-foot .row{display:flex;gap:8px;align-items:flex-end;background:#0a101c;border:1px solid #2c3a58;border-radius:12px;padding:6px 6px 6px 10px;}'
    + '#nsa-foot .row:focus-within{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.18);}'
    + '#nsa-in{flex:1;resize:none;height:40px;max-height:140px;background:transparent;color:#e6ebf5;border:none;outline:none;padding:4px 0;font:13px/1.45 inherit;font-family:inherit;}'
    + '#nsa-send{background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;border:none;border-radius:9px;padding:8px 14px;cursor:pointer;font-weight:700;font-family:inherit;}'
    + '#nsa-send:disabled{opacity:.45;cursor:not-allowed;}'
    + '.nsa-hint{color:#5b6b85;font-size:11px;padding:6px 2px 0;}';

  function injectCss() { var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  // ---------- DOM ----------
  var logEl, inEl, sendEl, modeEl, dockEl;

  function build() {
    dockEl = document.getElementById('dock');
    var tab = document.getElementById('tab-chat');
    if (!dockEl || !tab) { console.error('[NetSec-Agentic] #dock missing'); return; }
    tab.innerHTML = '<div id="nsa-log"></div>'
      + '<div id="nsa-foot"><div class="row"><textarea id="nsa-in" placeholder="Ask NetSec-Agentic…  (Enter to send · Shift+Enter for a new line)"></textarea>'
      + '<button id="nsa-send">Send</button></div>'
      + '<div class="nsa-hint">Ask in English or Chinese — the agent answers in the language you use.</div></div>';
    logEl = tab.querySelector('#nsa-log');
    inEl = tab.querySelector('#nsa-in');
    sendEl = tab.querySelector('#nsa-send');
    modeEl = document.getElementById('nsa-mode');
    sendEl.onclick = function () { send(); };
    inEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    inEl.addEventListener('input', function () { inEl.style.height = 'auto'; inEl.style.height = Math.min(140, Math.max(40, inEl.scrollHeight)) + 'px'; });

    setupDock();
    welcome();
    refreshHealth();
    setInterval(refreshHealth, 60000);
  }

  function welcome() {
    logEl.innerHTML = '';
    var w = document.createElement('div');
    w.className = 'nsa-welcome';
    w.innerHTML = '<h3>Hi, I\'m NetSec-Agentic.</h3>'
      + '<p>Your autonomous security operations agent for this NGFW × Prisma Access SASE × ELK estate. '
      + 'I investigate with live tools across every device on the map — watch the nodes light up as I work.</p>'
      + '<div class="nsa-caps">'
      + '<div><b>Troubleshoot</b>Connectivity &amp; root cause</div>'
      + '<div><b>Trace paths</b>User → app, drawn on the map</div>'
      + '<div><b>Review config</b>Policy, NAT, PBF, objects</div>'
      + '<div><b>Health checks</b>Tunnels, BGP, threats, logs</div>'
      + '</div><div class="nsa-sugg"></div>';
    var box = w.querySelector('.nsa-sugg');
    SUGGESTIONS.forEach(function (s) {
      var b = document.createElement('button'); b.textContent = s;
      b.onclick = function () { ask(s, { send: true }); };
      box.appendChild(b);
    });
    logEl.appendChild(w);
  }

  // ---------- dock: tabs / collapse / resize ----------
  function setDockWidth(w) { document.documentElement.style.setProperty('--dock-w', w + 'px'); }
  function refit() { setTimeout(function () { if (window.fitTopo) window.fitTopo(); }, 230); }
  function showTab(name) {
    document.querySelectorAll('#dock-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    document.querySelectorAll('#dock .tab').forEach(function (t) { t.classList.toggle('on', t.id === 'tab-' + name); });
    try { window.dispatchEvent(new CustomEvent('nsa:tab', { detail: name })); } catch (e) {}
  }
  function openDock() {
    if (document.body.classList.contains('dock-collapsed')) {
      document.body.classList.remove('dock-collapsed');
      try { localStorage.setItem('nsaDockCollapsed', '0'); } catch (e) {}
      refit();
    }
  }
  function setupDock() {
    try {
      var w = parseInt(localStorage.getItem('nsaDockW'), 10);
      if (w >= 340 && w <= window.innerWidth - 360) setDockWidth(w);
      if (localStorage.getItem('nsaDockCollapsed') === '1') document.body.classList.add('dock-collapsed');
    } catch (e) {}
    if (window.fitTopo) window.fitTopo();
    document.querySelectorAll('#dock-tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
    document.getElementById('dock-collapse').onclick = function () {
      document.body.classList.add('dock-collapsed');
      try { localStorage.setItem('nsaDockCollapsed', '1'); } catch (e) {}
      refit();
    };
    document.getElementById('dock-reopen').onclick = openDock;
    document.getElementById('nsa-new').onclick = function () {
      if (busy) return;
      MAP.clearTouched(); MAP.clearPath(); welcome(); showTab('chat'); inEl.focus();
    };
    var pc = document.querySelector('[data-path-clear]');
    if (pc) pc.onclick = function (e) { e.stopPropagation(); MAP.clearPath(); };
    // drag the left edge to resize
    var rz = document.getElementById('dock-resizer'), startX = 0, startW = 0;
    function mv(e) {
      var w = Math.max(340, Math.min(window.innerWidth - 360, startW + (startX - e.clientX)));
      setDockWidth(w); e.preventDefault();
    }
    function up() {
      dockEl.classList.remove('resizing');
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      try { localStorage.setItem('nsaDockW', String(Math.round(dockEl.getBoundingClientRect().width))); } catch (e) {}
      if (window.fitTopo) window.fitTopo();
    }
    rz.addEventListener('mousedown', function (e) {
      startX = e.clientX; startW = dockEl.getBoundingClientRect().width;
      dockEl.classList.add('resizing');
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  function refreshHealth() {
    fetch(AGENT_URL + '/api/health').then(function (r) { return r.json(); }).then(function (h) {
      window.NSA_HEALTH = h;
      if (h && h.mode) {
        if (h.mode === 'readonly') { modeEl.textContent = 'READ-ONLY'; modeEl.className = ''; }
        else { modeEl.textContent = h.approval ? 'AUTONOMOUS · APPROVAL' : 'AUTONOMOUS'; modeEl.className = 'rw'; }
        modeEl.title = (h.mode === 'readonly'
          ? 'Read-only: the agent can investigate but every config change is blocked.'
          : (h.approval ? 'Autonomous with human approval: config changes wait for your Approve / Reject.' : 'Autonomous: config changes run without confirmation.'))
          + '\nModels: ' + (h.model || '?') + (h.model_light ? ' / ' + h.model_light : '')
          + '\nConnectors: ' + (h.mcp || []).join(', ')
          + (h.missing && h.missing.length ? '\nMissing: ' + h.missing.join(', ') : '');
      }
      try { window.dispatchEvent(new CustomEvent('nsa:health', { detail: h })); } catch (e) {}
    }).catch(function () {
      window.NSA_HEALTH = null;
      modeEl.textContent = 'OFFLINE'; modeEl.className = 'off'; modeEl.title = 'Backend ' + AGENT_URL + ' unreachable';
      try { window.dispatchEvent(new CustomEvent('nsa:health', { detail: null })); } catch (e) {}
    });
  }

  // ---------- message helpers ----------
  function scroll() { logEl.scrollTop = logEl.scrollHeight; }
  function addMsg(kind, text) {
    var d = document.createElement('div');
    d.className = 'nsa-msg nsa-' + kind;
    d.textContent = text;
    logEl.appendChild(d); scroll();
    return d;
  }
  function shortTool(n) {
    var m = /^mcp__(.+?)__(.+)$/.exec(n || '');
    // label: legacy MCP id panos-gpgw-azure (renamed 2026-11-20) is shown under its new name
    return m ? { server: m[1], label: m[1].replace('gpgw-azure', 'sase-external-gw'), op: m[2] } : { server: '', label: '', op: n || '' };
  }
  function toolHint(input) {
    var hint = '', full = '';
    if (input) {
      var brief = [];
      for (var k in input) {
        if (input[k] == null) continue;
        var v = String(input[k]);
        full += (full ? '  ' : '') + k + '=' + v;
        if (v.length <= 28 && !/^</.test(v) && brief.length < 2) brief.push(v);
      }
      hint = brief.join(' ');
    }
    return { hint: hint, full: full };
  }

  // ---------- public API ----------
  function ask(text, opts) {
    opts = opts || {};
    openDock(); showTab('chat');
    if (busy || !opts.send) {
      inEl.value = text; inEl.focus();
      try { inEl.setSelectionRange(text.length, text.length); } catch (e) {}
      return;
    }
    inEl.value = text; send();
  }
  window.NSA = { ask: ask, showTab: showTab, open: openDock, refreshHealth: refreshHealth };

  // ---------- send + SSE ----------
  function send() {
    if (busy) return;
    var text = (inEl.value || '').trim();
    if (!text) return;
    inEl.value = ''; inEl.style.height = '40px';
    var wel = logEl.querySelector('.nsa-welcome'); if (wel) wel.remove();
    addMsg('user', text);
    busy = true; sendEl.disabled = true; dockEl.classList.add('busy');
    MAP.clearTouched();

    var botEl = null, acc = '', mdPending = false, gotDone = false;
    var lastByteAt = Date.now(), watchdog = null;
    var t0 = Date.now(), toolCount = 0, tierLabel = '';
    var approvals = {};

    var statusEl = document.createElement('div');
    statusEl.className = 'nsa-status';
    statusEl.innerHTML = '<span class="dot"></span><span class="ph">Connecting…</span><span class="el">0s</span>';
    logEl.appendChild(statusEl); scroll();
    var phaseEl = statusEl.querySelector('.ph'), elEl = statusEl.querySelector('.el');
    function setPhase(txt) { if (phaseEl) phaseEl.textContent = txt; }
    var ticker = setInterval(function () { if (elEl) elEl.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000);
    function stopStatus() {
      if (ticker) { clearInterval(ticker); ticker = null; }
      if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
    }
    // insert before the live status line while running, append once it's gone
    function place(el) { if (statusEl.parentNode) logEl.insertBefore(el, statusEl); else logEl.appendChild(el); scroll(); }
    function addSummary(ok, txt) {
      var d = document.createElement('div');
      d.className = 'nsa-summary ' + (ok ? 'ok' : 'bad');
      d.textContent = (ok ? '✓ ' : '✗ ') + txt;
      logEl.appendChild(d); scroll();
    }

    // agent trace (collapsible) — created lazily on first tool call
    var traceEl = null, stepsEl = null, sumEl = null;
    function ensureTrace() {
      if (traceEl) return;
      traceEl = document.createElement('details'); traceEl.className = 'nsa-trace'; traceEl.open = true;
      traceEl.innerHTML = '<summary><span class="s">Agent trace</span></summary><div class="steps"></div>';
      sumEl = traceEl.querySelector('.s'); stepsEl = traceEl.querySelector('.steps');
      place(traceEl);
    }
    function addStep(name, input, isWrite) {
      ensureTrace();
      var st = shortTool(name), h = toolHint(input);
      var d = document.createElement('div');
      d.className = 'nsa-step' + (isWrite ? ' w' : '');
      d.title = st.label + ' · ' + st.op + (h.full ? '  [' + h.full + ']' : '');
      d.innerHTML = '<span class="n">' + toolCount + '</span><span class="dev">' + esc(st.label || 'agent') + '</span>'
        + '<span class="tn">' + esc(st.op) + '</span><span class="ar">' + esc(h.hint) + '</span>';
      stepsEl.appendChild(d);
      sumEl.textContent = 'Agent trace · ' + toolCount + (toolCount === 1 ? ' step' : ' steps');
      scroll();
    }

    // ---- human-in-the-loop approval card ----
    function approvalCard(a) {
      var st = shortTool(a.tool);
      var node = SERVER_NODE[st.server];
      if (node) MAP.activate(node, 'awaiting approval');
      var c = document.createElement('div');
      c.className = 'nsa-card approval';
      c.innerHTML = '<div class="h">⚠ Approval required — configuration change</div>'
        + '<div>The agent wants to run <b>' + esc(st.op) + '</b> on <b>' + esc(st.label) + '</b>.</div>'
        + '<pre>' + esc(a.input || '') + '</pre>'
        + '<div class="btns"><button class="ap">Approve</button><button class="rj">Reject</button><span class="cd"></span></div>';
      place(c);
      openDock(); showTab('chat');
      var deadline = Date.now() + (a.timeout_ms || 180000);
      var cd = c.querySelector('.cd');
      var iv = setInterval(function () {
        var s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        cd.textContent = 'auto-reject in ' + s + 's';
        if (s <= 0) clearInterval(iv);
      }, 500);
      function decide(d) {
        c.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        fetch(AGENT_URL + '/api/approve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: a.id, decision: d })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) finalize(c, 'expired', iv);
        }).catch(function () { c.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); });
      }
      c.querySelector('.ap').onclick = function () { decide('approve'); };
      c.querySelector('.rj').onclick = function () { decide('reject'); };
      approvals[a.id] = { el: c, iv: iv };
      setPhase('Waiting for your approval…');
    }
    function finalize(c, decision, iv) {
      if (iv) clearInterval(iv);
      c.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      var txt = { approve: '✓ Approved — change is being applied', reject: '✗ Rejected — change not applied',
                  timeout: '⏱ Timed out — change not applied', client_gone: '✗ Not applied', expired: 'Approval expired' }[decision] || decision;
      c.classList.add(decision === 'approve' ? 'done-approve' : 'done-reject');
      c.querySelector('.cd').innerHTML = '<span class="res">' + esc(txt) + '</span>';
    }

    var IDLE_LIMIT = 240000;
    function armWatchdog(reader) {
      watchdog = setInterval(function () {
        if (gotDone) return;
        if (Date.now() - lastByteAt > IDLE_LIMIT) {
          clearInterval(watchdog); watchdog = null;
          try { reader.cancel(); } catch (e) {}
          stopStatus();
          addMsg('err', '⚠ No response for over ' + (IDLE_LIMIT / 1000) + 's (heartbeats lost too); the network path or the backend may be down. '
            + 'Please retry. If it keeps happening, check connectivity to ' + AGENT_URL + '.');
          finish();
        }
      }, 5000);
    }

    // Each question runs in a fresh, clean context (deterministic, fast, no drift).
    sessionId = 'ui-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, message: text })
    }).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
      var reader = resp.body.getReader(), dec = new TextDecoder(), buf = '';
      armWatchdog(reader);

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          lastByteAt = Date.now();
          buf += dec.decode(r.value, { stream: true });
          var chunks = buf.split('\n\n');
          buf = chunks.pop();
          chunks.forEach(handleSse);
          return pump();
        });
      }

      function handleSse(block) {
        var ev = 'message', data = '';
        block.split('\n').forEach(function (line) {
          if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
        });
        if (!data) return;
        var obj; try { obj = JSON.parse(data); } catch (e) { return; }

        if (ev === 'session') {
          if (obj.modelTier) {
            var mid = (obj.model || '').toLowerCase();
            var fam = mid.indexOf('opus') >= 0 ? 'Opus' : mid.indexOf('sonnet') >= 0 ? 'Sonnet' : mid.indexOf('haiku') >= 0 ? 'Haiku' : '';
            var role = obj.modelTier === 'heavy' ? 'deep investigation' : 'quick lookup';
            tierLabel = fam ? (fam + ' · ' + role) : role;
          }
          setPhase('Planning the investigation…');
        } else if (ev === 'text') {
          MAP.settle();
          if (!botEl) { botEl = addMsg('bot', ''); place(botEl); if (traceEl) traceEl.open = false; }
          acc += obj.text || '';
          if (!mdPending) {
            mdPending = true;
            requestAnimationFrame(function () { mdPending = false; renderMd(botEl, acc); scroll(); });
          }
          setPhase('Writing the answer…');
        } else if (ev === 'tool') {
          toolCount += 1;
          var st = shortTool(obj.name);
          var isWrite = /^(set_|add_|delete_|move_|create_|update_|commit|push_|panorama_commit|panorama_push)/.test(st.op);
          addStep(obj.name, obj.input, isWrite);
          var node = SERVER_NODE[st.server];
          if (node) MAP.activate(node, st.op);
          setPhase('Querying ' + (st.label || 'agent') + ' · ' + st.op + ' …');
        } else if (ev === 'thinking') {
          setPhase('Reasoning…');
        } else if (ev === 'approval') {
          approvalCard(obj);
        } else if (ev === 'approval_result') {
          var a = approvals[obj.id];
          if (a) finalize(a.el, obj.decision, a.iv);
          setPhase(obj.decision === 'approve' ? 'Applying the approved change…' : 'Continuing without the change…');
        } else if (ev === 'blocked') {
          var bs = shortTool(obj.tool);
          var c = document.createElement('div');
          c.className = 'nsa-card blocked';
          c.innerHTML = '<div class="h">🔒 Blocked by read-only guardrail</div><div>The agent attempted <b>' + esc(bs.op)
            + '</b> on <b>' + esc(bs.label) + '</b>. Config changes are disabled in read-only mode; no change was made.</div>';
          place(c);
        } else if (ev === 'error') {
          stopStatus();
          addMsg('err', '⚠ ' + (obj.message || 'Error'));
          addSummary(false, 'Error · ' + Math.round((Date.now() - t0) / 1000) + 's');
        } else if (ev === 'done') {
          gotDone = true;
          stopStatus();
          MAP.settle();
          var finalText = acc || obj.result || '';
          if (obj.result && (!botEl || !acc)) { botEl = addMsg('bot', ''); renderMd(botEl, obj.result); }
          else if (botEl && acc) renderMd(botEl, acc);
          if (traceEl) traceEl.open = false;
          var secs = Math.round((Date.now() - t0) / 1000);
          if (obj.is_error) addSummary(false, 'Not completed · ' + secs + 's');
          else {
            var parts = ['Done', secs + 's'];
            if (toolCount) parts.push(toolCount + (toolCount === 1 ? ' tool call' : ' tool calls'));
            if (tierLabel) parts.push(tierLabel);
            addSummary(true, parts.join(' · '));
          }
          var path = extractPath(finalText);
          if (path) {
            MAP.drawPath(path);
            var pb = document.createElement('button');
            pb.className = 'nsa-pathbtn';
            pb.textContent = '◎ Show traced path on map (' + path.length + ' hops)';
            pb.onclick = function () { MAP.drawPath(path); };
            logEl.appendChild(pb); scroll();
          }
          try { window.dispatchEvent(new CustomEvent('nsa:done', { detail: { tools: toolCount } })); } catch (e) {}
        }
      }

      function finish() {
        if (watchdog) { clearInterval(watchdog); watchdog = null; }
        stopStatus(); MAP.settle();
        for (var k in approvals) { if (approvals[k].iv) clearInterval(approvals[k].iv); }
        busy = false; sendEl.disabled = false; dockEl.classList.remove('busy'); inEl.focus();
      }
      return pump().catch(function (e) {
        if (gotDone) { finish(); return; }
        if (watchdog === null) { finish(); return; }
        var idle = Math.round((Date.now() - lastByteAt) / 1000);
        stopStatus();
        addMsg('err', '⚠ Connection interrupted: ' + (e && e.message || e)
          + ' (' + idle + 's since last data). The backend may still be working; try asking again shortly.');
        addSummary(false, 'Connection interrupted · ' + Math.round((Date.now() - t0) / 1000) + 's');
        finish();
      });
    }).catch(function (e) {
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
      stopStatus(); MAP.settle();
      addMsg('err', '⚠ Cannot reach backend ' + AGENT_URL + ': ' + (e && e.message || e));
      busy = false; sendEl.disabled = false; dockEl.classList.remove('busy');
    });
  }

  function init() { injectCss(); build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
