// server.mjs — NetSec-Agentic HTTP/SSE 后端
//
// 端点：
//   GET  /api/health         健康检查（返回 mode / 已接 MCP / 缺失凭据）
//   POST /api/chat           SSE 流式对话（body: {sessionId?, message}）
//   GET  /                   （可选）静态兜底
//
// 大脑：@anthropic-ai/claude-agent-sdk 的 query()，model=claude-opus-4-8。
// 工具：仅 MCP（scm + 4×panos + elk）；内置工具（Bash/Write/Edit/Read/...）全部 disallow，
//       让智能体只能通过 MCP 碰防火墙/ELK，碰不到容器文件系统与 shell。
// 安全：AGENT_MODE=readonly 时 PreToolUse 钩子拦截写操作；审计钩子记录每次调用。
// 会话：按 sessionId 用 SDK 的 resume 续多轮。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildMcpServers } from "./mcp.mjs";
import { makeAuditHook, makeReadonlyHook, makeNonMcpBlockHook, appendProposal, classify, bareToolName, writeAudit } from "./guard.mjs";

// ★最后防线：Agent SDK 在子进程 transport 已关时可能于下一个 tick「同步 throw」
//   （如 res.close 触发的 interrupt、或 query 收尾竞态），这类异常不是 promise reject、
//   无法被 try/catch 或 .catch 兜住，会变成 uncaughtException 崩掉整个 Node 进程
//   （实测栈：ProcessTransport is not ready for writing）。这里接住并只记录，绝不退出——
//   单个会话的收尾竞态不该掀翻整个常驻服务。
process.on("uncaughtException", (err) => {
  console.error("[guard] uncaughtException(已吞,进程存活):", err?.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[guard] unhandledRejection(已吞):", reason?.message || reason);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.HTTP_PORT || "8081", 10);
const HOST = process.env.HTTP_HOST || "0.0.0.0";
// ★模型分级路由。实测：深排障慢的真因是 Opus 每轮之间"思考+中间解说"太久
//   （轮间隔 55-67s，远超工具往返 30s），提示词压不住 Opus 的话痨本性。
//   → heavy 与 light 都默认用 Sonnet 4.5（生成快、更听指令、并发工具照常，
//     对"照黄金路径查已知设备"的排障质量足够）。想要 Opus 深推理时用 env 切回：
//     AGENT_MODEL_HEAVY=us.anthropic.claude-opus-4-8
//   - MODEL_HEAVY：复杂排障（默认 Sonnet 4.5；AGENT_MODEL_HEAVY 或旧 ANTHROPIC_MODEL 覆盖）
//   - MODEL_LIGHT：快速查询/巡检（默认 Sonnet 4.5；AGENT_MODEL_LIGHT 覆盖）
// 注意：agent.env 里 ANTHROPIC_MODEL=opus 是给 Bedrock CLI 的默认档，但每次查询都用
// options.model 覆盖（已验证 light 查询确走 Sonnet），故这里 heavy 只认 AGENT_MODEL_HEAVY，
// 不回落 ANTHROPIC_MODEL（否则会被 opus 顶回去）。要 Opus：设 AGENT_MODEL_HEAVY=us.anthropic.claude-opus-4-8。
const SONNET = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
// heavy(排障/取证) = Sonnet(质量);light(快查/巡检) = Haiku(生成快~一半,日常查询提速)。
// 想更强/更一致可 env 覆盖:AGENT_MODEL_HEAVY=…opus… / AGENT_MODEL_LIGHT=…sonnet…
const MODEL_HEAVY = process.env.AGENT_MODEL_HEAVY || SONNET;
const MODEL_LIGHT = process.env.AGENT_MODEL_LIGHT || HAIKU;
// ★命中这些词 → 走 MODEL_HEAVY(Sonnet)。用户的问题【基本都是配置类(策略/对象/路由)
//   + 结合 ELK 日志分析】,这类都需要 Sonnet 的严谨(Haiku 对长提示词纪律遵守差、易发散乱查,
//   2026-07-13 血泪:URL日志查 action 被判 light→Haiku→16工具乱翻220s超时)。所以把
//   "配置/日志/查找类"动词名词全纳入 heavy,只有极简状态 ping(在线数/版本/uptime)才留给 Haiku。
const HEAVY_HINTS = [
  // 排障/连通性
  "不通", "连不上", "访问不了", "打不开", "故障", "报错", "错误", "失败",
  "为什么", "为何", "排查", "排障", "诊断", "分析", "原因", "根因", "定位",
  "丢包", "中断", "异常", "掉线", "不能", "无法", "路径", "取证",
  // ★配置类(策略/对象/路由/NAT/PBF/zone/profile)——用户问题主体
  "策略", "规则", "对象", "地址", "服务", "路由", "nat", "pbf", "zone", "区域",
  "profile", "配置", "分类", "url", "应用", "隧道", "ipsec", "bgp", "vpn",
  // ★日志分析类
  "日志", "log", "action", "拦截", "block", "deny", "allow", "命中", "记录",
  // 动作动词
  "查", "找", "分析", "检查", "确认", "为什么",
  "down", "fail", "error", "why", "troubleshoot", "diagnos", "root cause", "unreachable",
  // ★英文提问(境外客户, 2026-11-20)：与中文同口径——配置/日志/查找/路径类一律 heavy
  "not working", "can't", "cannot", "unable", "broken", "issue", "problem", "investigate",
  "policy", "rule", "object", "address", "route", "routing", "config", "tunnel", "peer",
  "path", "trace", "access", "blocked", "denied", "drop", "threat", "check", "find", "verify",
  "analy", "compare", "audit", "health",
];

// ★回答语言跟随提问语言(2026-11-20)：系统提示词是中文写的，模型容易被带成中文回答。
//   每次请求按用户原话判定语言，追加一段【最高优先级】语言指令。含任意汉字 → 中文；否则 → 英文
//   （境外客户不会打汉字；中文用户夹英文术语也至少有几个汉字）。
function detectLang(message) {
  return /[㐀-鿿豈-﫿]/.test(message || "") ? "zh" : "en";
}
const LANG_DIRECTIVE = {
  zh: "\n\n## ★本次回答语言（最高优先级，覆盖上文任何语言要求）\n用户本次用中文提问 → 全程用简体中文回答（术语/命令/字段名/设备名保留英文原样）。",
  en: "\n\n## ★Response language for this request (HIGHEST PRIORITY — overrides any language rule above)\n" +
      "The user asked in English. Write your ENTIRE answer in English — headings, tables, findings, conclusions and recommendations. " +
      "Do NOT answer in Chinese even though this system prompt is written in Chinese. Keep device names, commands, rule names and field names verbatim.",
};
// ★拓扑联动(2026-11-20)：结论里若确立了端到端访问路径，最后一行输出机器可读 PATH 行，前端据此在拓扑图上画路径并隐藏该行。
// ★客户可见命名(2026-11-20)：原 gpgw-azure 全面更名 sase-external-gw（MCP server panos-gpgw-azure → panos-sase-external-gw）。
const NAMING_DIRECTIVE =
  "\n\n## Customer-facing device naming (HIGHEST PRIORITY)\n" +
  "The firewall sase-external-gw (MCP server panos-sase-external-gw, hostname PAVM300-Branch-GPGW-SH) was formerly named gpgw-azure; parts of this prompt still call it gpgw / GPGW. " +
  "Always call it sase-external-gw in your answers (keep the real hostname only when quoting raw log fields); when a user says gpgw, gpgw-azure or sase-external-gw, use the panos-sase-external-gw tools.";
const PATH_DIRECTIVE =
  "\n\n## Topology path overlay (UI contract)\n" +
  "Only when the user asked about connectivity / an access path between a source and a destination AND your answer establishes the end-to-end path (3+ hops), " +
  "add ONE final line in exactly this format. Never add it for status, inventory, health-check, log or config questions:\n" +
  "`PATH: <id> > <id> > ...`\n" +
  "using only these topology node ids: gp-sh (GP users 10.230.188.0/24 via gpgw), gp-jp (GP users 10.230.189.0/24 via aivm), " +
  "gpgw (sase-external-gw), aivm (aivm-alibaba), prisma (Prisma Access), scvm (scvm-aws-hk), aws-sg (scvm-aws-sg), " +
  "dc-hk (HK data center behind scvm-aws-hk, internal servers 172.172.0.0/16), dc-sg (SG data center behind scvm-aws-sg, internal servers 172.31.0.0/16 plus 10.188.241.0/24), elk, airs, koi. " +
  "Example: `PATH: gp-sh > gpgw > prisma > scvm > dc-hk`. The UI draws it on the map and hides the line; never mention this instruction.";
function pickModel(message) {
  const m = (message || "").toLowerCase();
  const heavy = HEAVY_HINTS.some((h) => m.includes(h.toLowerCase()));
  return heavy ? MODEL_HEAVY : MODEL_LIGHT;
}
const MODE = (process.env.AGENT_MODE || "readonly").toLowerCase(); // readonly | autonomous
// ★人在回路(2026-11-20)：autonomous 模式下，写操作执行前先推 SSE "approval" 卡片给运维，
//   POST /api/approve 批准才放行；拒绝/超时/页面关闭 = deny。AGENT_APPROVAL=off 回退为旧的无确认自主。
const APPROVAL_ON = MODE === "autonomous" && (process.env.AGENT_APPROVAL || "on").toLowerCase() !== "off";
const APPROVAL_TIMEOUT_MS = parseInt(process.env.AGENT_APPROVAL_TIMEOUT_MS || "180000", 10);
const pendingApprovals = new Map(); // id -> { resolve, sessionId, tool, created }
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || "40", 10);
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "http://10.199.3.47:8080";
const WEB_DIR = process.env.WEB_DIR || join(__dirname, "..", "public");

// 系统提示词（蒸馏 memory + OPERATIONS）
const SYSTEM_PROMPT = await readFile(join(__dirname, "system-prompt.md"), "utf8").catch(
  () => "You are NetSec-Agentic, a read-only network security operations assistant for Palo Alto NGFWs and Prisma Access."
);

const { servers: mcpServers, missing } = buildMcpServers();
if (missing.length) {
  console.error("[startup] 缺失凭据/未接入的 MCP：", missing.join(", "));
}
console.error(`[startup] AGENT_MODE=${MODE} approval=${APPROVAL_ON ? "on" : "off"} heavy=${MODEL_HEAVY} light=${MODEL_LIGHT} MCP=${Object.keys(mcpServers).join(",")}`);

// 内置工具全禁（只留 MCP）：让智能体碰不到 shell / 文件系统 / 网络抓取
const DISALLOWED_BUILTINS = [
  "Bash", "Write", "Edit", "Read", "Glob", "Grep",
  "WebSearch", "WebFetch", "Agent", "NotebookEdit", "Monitor",
];

// —— 每会话一个消息队列，喂给 SDK 的 streaming-input（支持多轮 resume）——
const sessions = new Map(); // sessionId -> { sdkSessionId }

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleChat(req, res, body) {
  const { sessionId, message } = body;
  console.error(`[chat] enter sid=${sessionId} msglen=${(message||"").length}`);
  if (!message || typeof message !== "string") {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ error: "message (string) required" }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...corsHeaders(),
  });

  const prior = sessionId && sessions.get(sessionId);
  const lang = detectLang(message);
  const T = (zh, en) => (lang === "zh" ? zh : en);
  const auditHook = makeAuditHook({ mode: MODE, sessionId: sessionId || "adhoc" });
  // 硬拦截一切非 MCP 工具（Bash/Read/Write…）——disallowedTools 在 bypassPermissions 下不生效，
  // 用钩子兜底。两模式都装，防止 agent 浪费往返去跑 Bash 探索环境。
  const hooks = { PreToolUse: [{ hooks: [auditHook, makeNonMcpBlockHook()] }] };
  if (MODE === "readonly") {
    // 包一层：被只读护栏拦下的写操作同时推 SSE "blocked"，前端显示护栏卡片（透明可见）
    const ro = makeReadonlyHook();
    hooks.PreToolUse.push({ hooks: [async (input, ...rest) => {
      const out = await ro(input, ...rest);
      if (out?.hookSpecificOutput?.permissionDecision === "deny" && !clientGone) {
        try { sseWrite(res, "blocked", { tool: input.tool_name, reason: "readonly" }); } catch {}
      }
      return out;
    }] });
  }
  // ★人在回路审批钩子：仅 autonomous + APPROVAL_ON。等待期间暂停生成看门狗（pendingCount>0）。
  let pendingCount = 0;
  let approvalWaitMs = 0; // 累计等待人工的时长，从 HARD_LIMIT 里扣除（人在看卡片不算 agent 超时）
  if (APPROVAL_ON) {
    hooks.PreToolUse.push({ timeout: Math.ceil(APPROVAL_TIMEOUT_MS / 1000) + 30, hooks: [async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const tool = input.tool_name || "";
      if (!tool.startsWith("mcp__") || classify(tool, input.tool_input) !== "write") return {};
      const id = randomUUID();
      const t0 = Date.now();
      let inputStr = "";
      try { inputStr = JSON.stringify(input.tool_input ?? {}, null, 2); } catch { inputStr = String(input.tool_input); }
      if (clientGone) return denyOut(input, T("操作员已离开页面，写操作未获批准，已拒绝。", "The operator has left the page; the change was not approved and has been rejected."));
      pendingCount++;
      const decision = await new Promise((resolve) => {
        const timer = setTimeout(() => { pendingApprovals.delete(id); resolve("timeout"); }, APPROVAL_TIMEOUT_MS);
        pendingApprovals.set(id, {
          sessionId, tool, created: t0,
          resolve: (d) => { clearTimeout(timer); pendingApprovals.delete(id); resolve(d); },
        });
        res.on("close", () => { const p = pendingApprovals.get(id); if (p) p.resolve("client_gone"); });
        sseWrite(res, "approval", {
          id, tool, op: bareToolName(tool), timeout_ms: APPROVAL_TIMEOUT_MS,
          input: inputStr.length > 4000 ? inputStr.slice(0, 4000) + "\n…(truncated)" : inputStr,
        });
      });
      pendingCount--;
      approvalWaitMs += Date.now() - t0;
      lastActivityAt = Date.now();
      writeAudit({ ts: new Date().toISOString(), session: input.session_id || sessionId, mode: MODE, tool, kind: "approval", decision,
                   waited_s: Math.round((Date.now() - t0) / 1000) }).catch(() => {});
      if (!clientGone) { try { sseWrite(res, "approval_result", { id, decision }); } catch {} }
      if (decision === "approve") {
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow",
                 permissionDecisionReason: "Approved by operator in NetSec-Agentic UI" } };
      }
      const why = decision === "timeout"
        ? T(`写操作 ${bareToolName(tool)} 审批超时（${Math.round(APPROVAL_TIMEOUT_MS / 1000)}s 无人批准），未执行。`, `Change ${bareToolName(tool)} was not executed: approval timed out after ${Math.round(APPROVAL_TIMEOUT_MS / 1000)}s.`)
        : T(`操作员拒绝了写操作 ${bareToolName(tool)}，未执行。请勿重试同一变更，向用户说明并给出人工变更建议。`, `The operator REJECTED change ${bareToolName(tool)}; it was not executed. Do not retry the same change — explain and give manual change guidance instead.`);
      return denyOut(input, why);
    }] });
  }
  function denyOut(input, reason) {
    return { hookSpecificOutput: { hookEventName: input.hook_event_name || "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  }

  let sdkSessionId = prior?.sdkSessionId;
  // 按问题分级选模型：排障词 → Opus(强)；否则 → Sonnet(快)
  const pickedModel = pickModel(message);
  const modelTier = pickedModel === MODEL_HEAVY ? "heavy" : "light";
  console.error(`[chat] head sent, model=${modelTier}(${pickedModel}) resume=${sdkSessionId||"none"}`);

  // SSE 心跳：工具执行(查防火墙)期间 SSE 可能 30-60s 无字节，浏览器/中间层会掐断长连接。
  // 每 10s 发一个 SSE 注释行(': hb <elapsed>s'\n\n)保活——注释行被 EventSource/前端忽略，只维持字节流动。
  const reqStart = Date.now();
  const heartbeat = setInterval(() => {
    try { res.write(`: hb ${Math.round((Date.now() - reqStart) / 1000)}s\n\n`); } catch {}
  }, 10000);

  // ★★生成看门狗（2026-07-12 修复"生成卡死 350s+，心跳掩盖前端看门狗"）：
  //   两道硬限——① STALL_LIMIT：距上次实质输出(text/tool/thinking token)静默过久 = 卡在
  //   Bedrock 生成里挂起，主动中止；② HARD_LIMIT：单次查询总时长上限，防发散式狂查停不下来。
  //   用 AbortController（SDK 支持的干净取消，不用 q.interrupt()——后者会同步 throw 崩进程，见下）。
  const STALL_LIMIT = parseInt(process.env.AGENT_STALL_LIMIT_MS || "120000", 10); // 120s 无输出=卡死
  // 硬上限 220→300s(2026-07-13):实测多次"方向对、就差临门生成"被 220s 掐死(chatgpt/172.172.200.197
  // 都是首轮并发查对了、卡在 Sonnet 单轮生成长尾 88-152s + 结尾生成，累计撞 220)。放宽到 300s 让它把
  // 结论说完;真死循环仍由 STALL_LIMIT(120s 完全静默)兜底，不会退化回无限等。
  const HARD_LIMIT = parseInt(process.env.AGENT_HARD_LIMIT_MS || "300000", 10);   // 300s 总上限
  const abortController = new AbortController();
  let lastActivityAt = Date.now();
  let abortedReason = null;
  const genWatchdog = setInterval(() => {
    if (queryDone) return;
    if (pendingCount > 0) { lastActivityAt = Date.now(); return; } // 等人工审批中：不算停滞
    const idle = Date.now() - lastActivityAt;
    const total = Date.now() - reqStart - approvalWaitMs;
    if (idle > STALL_LIMIT) { abortedReason = T(`生成停滞 ${Math.round(idle/1000)}s 无输出`, `no output for ${Math.round(idle/1000)}s`); }
    else if (total > HARD_LIMIT) { abortedReason = T(`总时长超 ${Math.round(total/1000)}s`, `exceeded ${Math.round(total/1000)}s total`); }
    if (abortedReason) {
      clearInterval(genWatchdog);
      console.error(`[chat] gen-watchdog abort: ${abortedReason}`);
      try { abortController.abort(); } catch {}
    }
  }, 5000);

  // 客户端断开：只置标记，让 for-await 循环在下一条消息时自然 break。
  // ★绝不在这里调 q.interrupt()——SDK 的 interrupt 在子进程 transport 已关时会在
  //   下一个 tick「同步 throw」ProcessTransport is not ready for writing，那不是 promise
  //   reject（.catch 抓不到），会变成 uncaughtException 崩掉整个 Node 进程（实测栈见日志）。
  //   客户端都走了，让 query 自己跑完即可；顶部的 process.on('uncaughtException') 是最后防线。
  let clientGone = false;
  let queryDone = false;
  res.on("close", () => { clientGone = true; });

  // 跑一次 query 并消费其消息流。返回 { sawContent, done } 供重试判断。
  // sawContent = 是否已向用户输出过实质内容（text/tool/done）——决定能否安全重试。
  const toolsUsed = []; // 本次排障用过的 MCP 工具（供候选记忆队列记录取证路径）
  // ★每工具计时（2026-07-26 定位"到处乱查撞 300s"）：dispatch 记开始、tool_result 回来算耗时，
  //   docker logs 就能看到完整工具时间线，暴露慢/挂在哪个 MCP 工具、以及是否偏离黄金路径乱查。
  const toolStart = new Map(); // tool_use_id -> {name, t0}
  let toolSeq = 0;
  async function runOnce() {
    let sawContent = false, gotDone = false;
    const q = query({
      prompt: message,
      options: {
        model: pickedModel,
        systemPrompt: SYSTEM_PROMPT + LANG_DIRECTIVE[lang] + NAMING_DIRECTIVE + PATH_DIRECTIVE,
        mcpServers,
        disallowedTools: DISALLOWED_BUILTINS,
        permissionMode: "bypassPermissions",
        settingSources: [],
        strictMcpConfig: true,
        includePartialMessages: true,
        maxTurns: MAX_TURNS,
        hooks,
        abortController, // ★生成看门狗用它中止卡死/超时的 query（干净取消，不崩进程）
        ...(sdkSessionId ? { resume: sdkSessionId } : {}),
        cwd: "/app",
        env: { ...process.env },
        stderr: (d) => { const s = String(d).trim(); if (s) console.error("[cc] " + s.slice(0, 300)); },
      },
    });
    for await (const msg of q) {
      if (clientGone) break;
      lastActivityAt = Date.now(); // 每条 SDK 消息(token/工具/思考)都算活动 → 喂生成看门狗
      switch (msg.type) {
        case "system":
          if (msg.subtype === "init" && msg.session_id) {
            sdkSessionId = msg.session_id;
            if (sessionId) sessions.set(sessionId, { sdkSessionId });
            sseWrite(res, "session", { sessionId: sessionId || sdkSessionId, sdkSessionId, mode: MODE, modelTier, model: pickedModel, lang, approval: APPROVAL_ON });
          }
          break;
        case "stream_event": {
          const ev = msg.event;
          if (ev?.type === "content_block_delta") {
            const d = ev.delta;
            if (d?.type === "text_delta") { sseWrite(res, "text", { text: d.text }); sawContent = true; }
            else if (d?.type === "thinking_delta") sseWrite(res, "thinking", { text: d.thinking });
          }
          break;
        }
        case "assistant": {
          const blocks = msg.message?.content || [];
          for (const b of blocks) {
            if (b.type === "tool_use") {
              sseWrite(res, "tool", { name: b.name, input: summarizeInput(b.input) }); sawContent = true;
              if (b.name?.startsWith("mcp__")) toolsUsed.push(b.name);
              // ★工具时间线：记 dispatch 时刻(相对本次查询)，tool_result 回来时算耗时
              const seq = ++toolSeq;
              if (b.id) toolStart.set(b.id, { name: b.name, t0: Date.now(), seq });
              console.error(`[tool] #${seq} → ${b.name} @${Math.round((Date.now()-reqStart)/1000)}s ${JSON.stringify(summarizeInput(b.input)).slice(0,160)}`);
            }
          }
          break;
        }
        case "user": {
          // tool_result 回程：SDK 把工具结果作为 user 消息回喂——据此算每个工具的真实耗时。
          const blocks = msg.message?.content || [];
          for (const b of blocks) {
            if (b.type === "tool_result" && b.tool_use_id && toolStart.has(b.tool_use_id)) {
              const { name, t0, seq } = toolStart.get(b.tool_use_id);
              toolStart.delete(b.tool_use_id);
              const dur = Math.round((Date.now() - t0) / 1000);
              const flag = dur >= 30 ? " ⚠SLOW" : "";
              console.error(`[tool] #${seq} ✓ ${name} 耗时 ${dur}s${flag}`);
            }
          }
          break;
        }
        case "result": {
          sseWrite(res, "done", {
            result: msg.result ?? "", is_error: !!msg.is_error,
            cost_usd: msg.total_cost_usd, turns: msg.num_turns,
          });
          sawContent = true; gotDone = true;
          // ★候选记忆队列（选项1）：仅"真排障"(heavy 档)且非错误的结论，自动落 proposals.jsonl
          //   供运维事后经 Claude 蒸馏进 system-prompt。agent 不写文件，是 harness 抓 result。
          if (modelTier === "heavy" && !msg.is_error && (msg.result || "").trim()) {
            appendProposal({
              ts: new Date().toISOString(),
              session: sessionId || sdkSessionId,
              status: "pending",           // pending | promoted | rejected（人工审核后手改）
              question: (message || "").slice(0, 500),
              conclusion: String(msg.result).slice(0, 4000),
              tools: [...new Set(toolsUsed)],
              turns: msg.num_turns,
              model: pickedModel,
            }).catch(() => {});
          }
          break;
        }
        default: break;
      }
    }
    return { sawContent, gotDone };
  }

  // exit code 1 多为 Bedrock 偶发抖动（子进程静默退出，无 stderr）——自动重试 1 次，对用户透明。
  const isTransientCrash = (err) => /exited with code 1|process exited|ProcessTransport/i.test(String(err?.message || err));

  try {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        await runOnce();
        break; // 正常结束
      } catch (err) {
        // ★看门狗主动中止(卡死/超时)：不是瞬时崩溃，别重试——直接给用户明确超时提示。
        if (abortedReason) throw err;
        // 只在「瞬时崩溃 + 尚未向用户输出任何内容 + 客户端还在 + 首次」时静默重试
        if (isTransientCrash(err) && attempt === 1 && !clientGone) {
          console.error(`[chat] transient crash, auto-retry once: ${err?.message}`);
          sdkSessionId = undefined; // 崩掉的会话不可 resume，重开
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw err; // 其它情况按原逻辑上报
      }
    }
  } catch (err) {
    // 看门狗中止 → 明确告知用户"超时/停滞"，建议缩小范围重试；否则按原始错误上报。
    const msg = abortedReason
      ? T(`排查超时(${abortedReason})，已自动中止以免无限等待。请重试，或把问题缩小(指明源IP/目标/现象)让我更快命中。`,
          `Investigation timed out (${abortedReason}) and was stopped automatically. Please retry, or narrow the question (source IP / destination / symptom) so I can pinpoint it faster.`)
      : String(err?.message || err);
    console.error("[chat] error:", abortedReason || err?.message);
    if (!clientGone) sseWrite(res, "error", { message: msg });
  } finally {
    queryDone = true;
    clearInterval(heartbeat);
    clearInterval(genWatchdog);
    if (!clientGone) res.end();
  }
}

// 工具入参摘要：只保留非敏感字段，避免把大 XML/密钥推给前端
function summarizeInput(input) {
  if (!input || typeof input !== "object") return input;
  const out = {};
  for (const k of ["command", "cmd", "name", "xpath", "firewall", "query", "device", "src_ip", "dst_ip"]) {
    if (input[k] != null) out[k] = String(input[k]).slice(0, 300);
  }
  return out;
}

const AUDIT_DIR_SRV = process.env.AUDIT_DIR || "/app/audit";
async function readRecentAudit(limit) {
  const out = [];
  for (let back = 0; back < 3 && out.length < limit; back++) {
    const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    let txt = "";
    try { txt = await readFile(`${AUDIT_DIR_SRV}/${day}.jsonl`, "utf8"); } catch { continue; }
    const lines = txt.trim().split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      let r; try { r = JSON.parse(lines[i]); } catch { continue; }
      if (r.blocked) continue;                                  // SDK 初始化期探测的内置工具(已被拦)，噪音
      if (!(String(r.tool || "").startsWith("mcp__"))) continue; // 只展示真正触达设备/云/日志的调用
      out.push({ ts: r.ts, tool: r.tool, kind: r.kind, decision: r.decision, op: r.op ? String(r.op).slice(0, 200) : undefined,
                 name: r.name, session: r.session ? String(r.session).slice(0, 8) : undefined });
    }
  }
  return out;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function serveStatic(req, res) {
  try {
    const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const full = normalize(join(WEB_DIR, urlPath));
    if (!full.startsWith(WEB_DIR)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(full);
    const ext = full.split(".").pop();
    const ct = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.url?.startsWith("/api/health")) {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({
      ok: true, mode: MODE, approval: APPROVAL_ON, approval_timeout_ms: APPROVAL_TIMEOUT_MS,
      pending_approvals: pendingApprovals.size,
      model: MODEL_HEAVY, model_light: MODEL_LIGHT,  // model 保留=heavy，兼容旧前端
      mcp: Object.keys(mcpServers), missing,
    }));
    return;
  }

  // ★审批决定：{id, decision: "approve"|"reject"}。id 为一次性随机 UUID，仅对仍在等待的写操作有效。
  if (req.method === "POST" && req.url?.startsWith("/api/approve")) {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(raw || "{}"); } catch {}
      const p = b.id && pendingApprovals.get(b.id);
      const decision = b.decision === "approve" ? "approve" : "reject";
      res.writeHead(p ? 200 : 404, { "Content-Type": "application/json", ...corsHeaders() });
      if (!p) { res.end(JSON.stringify({ ok: false, error: "no pending approval with this id (expired or already decided)" })); return; }
      console.error(`[approval] ${decision} ${p.tool} id=${b.id}`);
      p.resolve(decision);
      res.end(JSON.stringify({ ok: true, decision }));
    });
    return;
  }

  // ★审计流（Activity 面板）：最近 N 条 MCP 工具调用/审批记录，新→旧；过滤掉 SDK 自发探测的被拦内置工具噪音。
  if (req.method === "GET" && req.url?.startsWith("/api/audit")) {
    const u = new URL(req.url, "http://x");
    const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get("limit") || "80", 10) || 80));
    readRecentAudit(limit).then((items) => {
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders() });
      res.end(JSON.stringify({ items }));
    }).catch((e) => {
      res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders() });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw || "{}"); }
      catch { res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders() }); res.end(JSON.stringify({ error: "invalid json" })); return; }
      handleChat(req, res, body).catch((e) => {
        console.error("[chat] fatal:", e?.message);
        try { res.end(); } catch {}
      });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.error(`[startup] NetSec-Agentic listening on http://${HOST}:${PORT}  (mode=${MODE})`);
});
