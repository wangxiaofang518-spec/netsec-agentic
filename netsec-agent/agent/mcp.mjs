// mcp.mjs — 从环境变量组装 mcpServers 配置（全 stdio，复用现有 MCP Server）
//
// 复用 scm-mcp/setup.sh 的既有约定：
//   scm            = python -m scm_mcp（本仓库自写，pip 装入容器）
//   panos-*        = @iflow-mcp/apius-tech-panos-mcp（npm -g，4 台各一实例，靠 PANOS_HOST/KEY 区分）
//   elk            = 本项目自带 elk-mcp（stdio，只读查 elasticsearch:9200）
//
// 固定的非密配置（Client ID / TSG ID / NGFW 公网管理 IP）内置为默认值，可被 env 覆盖。
// 所有密钥只从 env 读取，绝不硬编码。

const env = process.env;

// —— 固定配置（与 scm-mcp/setup.sh 一致；可被 env 覆盖）——
const SCM_CLIENT_ID = env.SCM_CLIENT_ID || "<your-service-account>@<your-tsg-id>.iam.panserviceaccount.com";
const SCM_TSG_ID = env.SCM_TSG_ID || "<your-tsg-id>";

const PANOS_HOSTS = {
  "panos-sase-external-gw": env.PANOS_HOST_SASE_EXTERNAL_GW || env.PANOS_HOST_GPGW_AZURE || "203.0.113.21", // 原名 panos-gpgw-azure(2026-11-20 重命名)，旧 env 名仍兼容
  "panos-scvm-aws-hk": env.PANOS_HOST_SCVM_AWS_HK || "203.0.113.22",
  "panos-scvm-aws-sg": env.PANOS_HOST_SCVM_AWS_SG || "203.0.113.23",
  "panos-aivm-alibaba": env.PANOS_HOST_AIVM_ALIBABA || "203.0.113.24",
};
const PANOS_KEYS = {
  "panos-sase-external-gw": env.PANOS_API_KEY_SASE_EXTERNAL_GW || env.PANOS_API_KEY_GPGW_AZURE,
  "panos-scvm-aws-hk": env.PANOS_API_KEY_SCVM_AWS_HK,
  "panos-scvm-aws-sg": env.PANOS_API_KEY_SCVM_AWS_SG,
  "panos-aivm-alibaba": env.PANOS_API_KEY_AIVM_ALIBABA,
};

// panos npm 包入口（node:22-bookworm 全局模块默认路径；可用 PANOS_MCP_INDEX 覆盖）
const PANOS_MCP_INDEX =
  env.PANOS_MCP_INDEX ||
  "/usr/local/lib/node_modules/@iflow-mcp/apius-tech-panos-mcp/dist/index.js";

// koi / prisma-airs npm 全局包入口（容器内 npm -g 装；可用 env 覆盖）
const KOI_MCP_INDEX =
  env.KOI_MCP_INDEX ||
  "/usr/local/lib/node_modules/koi-mcp-server/dist/index.js";
const AIRS_MCP_INDEX =
  env.AIRS_MCP_INDEX ||
  "/usr/local/lib/node_modules/prisma-airs-ops-mcp-server/dist/index.js";

const NODE_TLS_ENV = { NODE_TLS_REJECT_UNAUTHORIZED: "0" }; // NGFW 自签名证书

export function buildMcpServers() {
  const servers = {};
  const missing = [];

  // scm（云侧姿态：security rules / RN / SC / BGP）
  if (env.SCM_CLIENT_SECRET) {
    servers.scm = {
      type: "stdio",
      command: env.PYTHON_BIN || "python3",
      args: ["-m", "scm_mcp"],
      env: {
        ...process.env,
        SCM_CLIENT_ID,
        SCM_CLIENT_SECRET: env.SCM_CLIENT_SECRET,
        SCM_TSG_ID,
      },
    };
  } else {
    missing.push("scm (SCM_CLIENT_SECRET)");
  }

  // 4×panos（设备侧排障：会话/路由/隧道/BGP/GP/策略/路径取证）
  for (const name of Object.keys(PANOS_HOSTS)) {
    const key = PANOS_KEYS[name];
    if (!key) {
      missing.push(`${name} (API key)`);
      continue;
    }
    servers[name] = {
      type: "stdio",
      command: env.NODE_BIN || "node",
      args: [PANOS_MCP_INDEX],
      env: {
        ...process.env,
        ...NODE_TLS_ENV,
        PANOS_HOST: PANOS_HOSTS[name],
        PANOS_API_KEY: key,
      },
    };
  }

  // elk（只读查 ELK 日志——第四维取证）
  servers.elk = {
    type: "stdio",
    command: env.NODE_BIN || "node",
    args: [env.ELK_MCP_INDEX || "/app/elk-mcp/index.mjs"],
    env: {
      ...process.env,
      ES_URL: env.ES_URL || "http://elasticsearch:9200",
    },
  };

  // koi（SaaS/软件资产清单、影子IT——KOI_API_KEY）
  if (env.KOI_API_KEY) {
    servers.koi = {
      type: "stdio",
      command: env.NODE_BIN || "node",
      args: [KOI_MCP_INDEX],
      env: { ...process.env, KOI_API_KEY: env.KOI_API_KEY },
    };
  } else {
    missing.push("koi (KOI_API_KEY)");
  }

  // prisma-airs（AI Runtime Security：扫描/红队/策略——需 4 个 PANW 凭据）
  if (env.PANW_AI_SEC_API_KEY && env.PANW_MGMT_CLIENT_SECRET) {
    servers["prisma-airs"] = {
      type: "stdio",
      command: env.NODE_BIN || "node",
      args: [AIRS_MCP_INDEX],
      env: {
        ...process.env,
        PANW_AI_SEC_API_KEY: env.PANW_AI_SEC_API_KEY,
        PANW_MGMT_CLIENT_ID: env.PANW_MGMT_CLIENT_ID || "",
        PANW_MGMT_CLIENT_SECRET: env.PANW_MGMT_CLIENT_SECRET,
        PANW_MGMT_TSG_ID: env.PANW_MGMT_TSG_ID || "",
      },
    };
  } else {
    missing.push("prisma-airs (PANW_AI_SEC_API_KEY/PANW_MGMT_CLIENT_SECRET)");
  }

  return { servers, missing };
}
