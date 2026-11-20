// guard.mjs — 安全护栏 + 审计
//
// 两个 PreToolUse 钩子：
//   1) auditHook   —— 每个工具调用落审计日志（两种模式都跑）
//   2) readonlyHook —— AGENT_MODE=readonly 时拦截所有写操作
//
// AGENT_MODE:
//   readonly    (默认，推荐 v1) —— 只放行 get_*/list_*/test_* + run_op_command 的 <show>/<test>；
//                                  拦截 set_*/add_*/delete_*/move_*/commit/push_*/create_*/update_* 等。
//   autonomous  —— 放行写操作（仍走 candidate 暂存，靠 MCP 本身的 candidate 语义 + 审计强标记）。
//
// 依据 scm-mcp/delivery/01-READONLY-SECURITY-MODEL.md 的黑白名单。
// 注意：工具层拦截不是硬保证（panos 包无只读开关）；真正硬只读须在 PAN-OS/SCM 侧发只读 RBAC key。

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const AUDIT_DIR = process.env.AUDIT_DIR || "/app/audit";

// —— 写操作工具名模式（去掉 mcp__<server>__ 前缀后匹配裸工具名）——
// deny 清单来自 delivery/01-READONLY-SECURITY-MODEL.md §三
const WRITE_PATTERNS = [
  /^set_/, /^add_/, /^delete_/, /^move_/, /^create_/, /^update_/,
  /^commit$/, /^panorama_commit$/, /^panorama_push_to_devices$/,
  /^push_candidate_config$/, /^load_config_version$/, /^delete_candidate_config$/,
  /^reset_service_account$/, /^create_service_account$/,
  /_delete$/, /^airs_redteam_scan_abort$/, /^airs_topics_revert_from_profile$/,
];

// run_op_command 特判：只读 op 命令（<show>/<test>）在 readonly 下放行，其余（<commit>/<set>/<delete>/<request>…）拦截
function isReadonlyOpCommand(toolInput) {
  const cmd = (toolInput && (toolInput.command || toolInput.cmd || toolInput.xml) || "").trim();
  return /^<\s*(show|test)\b/i.test(cmd);
}

function bareToolName(fullName) {
  // mcp__panos-sase-external-gw__get_pbf_rules -> get_pbf_rules
  const m = /^mcp__[^_]+(?:[^_]|_(?!_))*__(.+)$/.exec(fullName);
  if (m) return m[1];
  const parts = fullName.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : fullName;
}

function classify(fullName, toolInput) {
  const name = bareToolName(fullName);
  if (name === "run_op_command") {
    return isReadonlyOpCommand(toolInput) ? "read" : "write";
  }
  for (const re of WRITE_PATTERNS) {
    if (re.test(name)) return "write";
  }
  return "read"; // get_*/list_*/test_*/其它默认读
}

async function writeAudit(record) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const file = `${AUDIT_DIR}/${day}.jsonl`;
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    // 审计失败不阻断 agent，仅打 stderr
    console.error("[audit] write failed:", e?.message);
  }
}

// —— 审计钩子（两模式都跑；异步不阻断）——
export function makeAuditHook({ mode, sessionId }) {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const fullName = input.tool_name;
    const kind = classify(fullName, input.tool_input);
    // ★blocked 标注：非 mcp__ 工具会被 makeNonMcpBlockHook deny（本条只是"尝试"，未执行）。
    //   否则审计里 Bash/ls 看着像真跑了（SDK init 阶段会自发探测环境），误导排障复盘。
    const blocked = !isAllowedTool(fullName);
    writeAudit({
      ts: new Date().toISOString(),
      session: input.session_id || sessionId,
      mode,
      tool: fullName,
      kind,
      ...(blocked ? { blocked: true } : {}),
      // 只记 op 命令原文 + file_path 等非敏感参数摘要；不落 API key（key 在 env，不在 tool_input）
      op: (input.tool_input && (input.tool_input.command || input.tool_input.cmd)) || undefined,
      name: (input.tool_input && input.tool_input.name) || undefined,
    }).catch(() => {});
    return { async: true, asyncTimeout: 5000 };
  };
}

// —— 只读护栏钩子（仅 readonly 模式注册）——
export function makeReadonlyHook() {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const fullName = input.tool_name;
    const kind = classify(fullName, input.tool_input);
    if (kind === "write") {
      const bare = bareToolName(fullName);
      const reason =
        bare === "run_op_command"
          ? "只读模式：run_op_command 仅允许 <show>/<test> 只读命令，检测到非只读 XML，已拦截。"
          : `只读模式：写操作 ${bare} 已被拦截（AGENT_MODE=readonly）。如需变更，请切 autonomous 模式或走人工流程。`;
      return {
        systemMessage: `🔒 已拦截写操作：${bare}`,
        hookSpecificOutput: {
          hookEventName: input.hook_event_name,
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }
    return {}; // 读操作放行（permissionMode=bypassPermissions 负责实际放行）
  };
}

// —— 非 MCP 工具硬拦截钩子（两模式都注册）——
// 背景：server.mjs 的 disallowedTools 在 permissionMode=bypassPermissions 下不生效，
//   实测 agent 仍能调用内置 Bash（跑 `ls /app`/`pwd` 探索环境）——既浪费时间又违背
//   "只经 MCP 操作"的设计。这里用 PreToolUse 钩子把一切非 mcp__ 前缀的工具直接 deny。
// ★MCPSearch 白名单（2026-11-19）：ENABLE_TOOL_SEARCH=true 后 601 个 MCP 工具改为按需加载，
//   模型须先调 CLI 内置的 MCPSearch（只读：仅在已注册 MCP 工具清单里检索/加载 schema）才能用工具。
//   拦掉它会让 agent 只能靠系统提示词里写过的工具名"盲调"。
const ALLOWED_NON_MCP = new Set(["MCPSearch"]);
export function isAllowedTool(name) {
  return (name || "").startsWith("mcp__") || ALLOWED_NON_MCP.has(name);
}
export function makeNonMcpBlockHook() {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const name = input.tool_name || "";
    if (isAllowedTool(name)) return {}; // MCP 工具 + MCPSearch 放行
    return {
      systemMessage: `⛔ 已拦截非 MCP 工具：${name}（本智能体只能经 MCP 操作防火墙/云/日志）`,
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason:
          `工具 ${name} 不是 MCP 工具，已被拦截。你只能使用 mcp__* 前缀的工具` +
          `（scm/panos-*/elk/koi/prisma-airs）。不要尝试用 Bash/Read/Write 等内置工具探索环境或读写文件。`,
      },
    };
  };
}

// —— 候选记忆队列（选项1：human-in-the-loop 训练的自动【捕获】环节）——
// 背景：agent 无持久记忆、无写文件能力，它自称"已归档到知识库"是话术幻觉。
//   真正的沉淀靠运维经 Claude 蒸馏进 system-prompt。这里由 harness（server.mjs）在每次
//   排障【结束】时，自动把 agent 的最终结论 + 本次用过的工具，append 到 proposals.jsonl。
//   agent 自己【不需要】写权限——是后端抓 result 落盘。供事后人工审核提升进 system-prompt。
// 只记"真排障"（modelTier=heavy，命中排障词）的结论，避免快查/巡检刷屏。
const PROPOSALS_FILE = process.env.PROPOSALS_FILE || `${AUDIT_DIR}/proposals.jsonl`;

export async function appendProposal(record) {
  try {
    await mkdir(dirname(PROPOSALS_FILE), { recursive: true });
    await appendFile(PROPOSALS_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    console.error("[proposal] write failed:", e?.message);
  }
}

export { classify, bareToolName, writeAudit };
