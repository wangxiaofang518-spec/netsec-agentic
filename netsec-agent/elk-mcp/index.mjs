#!/usr/bin/env node
// elk-mcp/index.mjs — 极简只读 ELK MCP Server（stdio）
//
// 给 NetSec-Agentic 第四维取证能力：查 panos-* 索引里的流量/威胁/系统/GP 日志。
// 直连 elasticsearch:9200（走 elk_elk 网络），无需把 SSH key 放进容器。
// 只暴露只读查询工具；用固定查询模板，不允许任意 DSL 写操作（ES 只有 _search，天然只读）。
//
// 依赖 @modelcontextprotocol/sdk（panos 包已带同款依赖，容器里 npm i 一次即可）。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ES_URL = (process.env.ES_URL || "http://elasticsearch:9200").replace(/\/$/, "");

async function esSearch(index, bodyObj) {
  const r = await fetch(`${ES_URL}/${index}/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { error: `ES ${r.status}`, detail: t.slice(0, 500) };
  }
  return r.json();
}

const TOOLS = [
  {
    name: "elk_search_traffic",
    description:
      "查 ELK 中的 PAN-OS 流量日志（panos-traffic-*）。可按源/目的 IP、设备主机名、规则名、时间窗过滤。返回命中数 + 按 action/rule/device 分桶。用于四维取证的『日志』维度，验证两端配对、action 分布。",
    inputSchema: {
      type: "object",
      properties: {
        src_ip: { type: "string", description: "源 IP，如 10.230.188.151" },
        dst_ip: { type: "string", description: "目的 IP，如 172.172.200.197" },
        device_hostname: { type: "string", description: "设备主机名子串，如 PrismaSC-HK / GPGW / Alibaba" },
        rule: { type: "string", description: "安全规则名，如 lab-gp-to-ipsec" },
        minutes: { type: "integer", description: "回看分钟数，默认 60", default: 60 },
        size: { type: "integer", description: "返回样本条数，默认 10，最大 50", default: 10 },
      },
    },
  },
  {
    name: "elk_search_threat",
    description: "查 ELK 中的 PAN-OS 威胁日志（panos-threat-*）。可按源/目的 IP、设备、严重级过滤。返回样本 + 按 severity/threat 分桶。",
    inputSchema: {
      type: "object",
      properties: {
        src_ip: { type: "string" },
        dst_ip: { type: "string" },
        device_hostname: { type: "string" },
        severity: { type: "string", description: "critical/high/medium/low" },
        minutes: { type: "integer", default: 60 },
        size: { type: "integer", default: 10 },
      },
    },
  },
  {
    name: "elk_count_by_action",
    description: "对给定源目地址在指定时间窗内的流量日志，按 action 字段分桶计数（allow/deny/drop/reset-*）。用于快速判断『通/不通』与拦截分布，呼应案例1(HTTP reset-both vs ping allow)。",
    inputSchema: {
      type: "object",
      properties: {
        src_ip: { type: "string" },
        dst_ip: { type: "string" },
        minutes: { type: "integer", default: 60 },
      },
    },
  },
  {
    name: "elk_indices",
    description: "列出 panos-* 索引及文档数、体积（_cat/indices）。用于确认日志在流入、定位索引。",
    inputSchema: { type: "object", properties: {} },
  },
];

function timeFilter(minutes) {
  return { range: { "@timestamp": { gte: `now-${minutes || 60}m` } } };
}
function termIf(field, val, filters) {
  if (val) filters.push({ term: { [field]: val } });
}
function matchIf(field, val, filters) {
  if (val) filters.push({ match: { [field]: val } });
}

async function callTool(name, args) {
  args = args || {};
  if (name === "elk_indices") {
    const r = await fetch(`${ES_URL}/_cat/indices/panos-*?format=json&h=index,docs.count,store.size&s=index`);
    if (!r.ok) return { error: `ES ${r.status}` };
    return r.json();
  }

  if (name === "elk_search_traffic" || name === "elk_search_threat") {
    const index = name === "elk_search_traffic" ? "panos-traffic-*" : "panos-threat-*";
    const filters = [timeFilter(args.minutes)];
    termIf("src_ip", args.src_ip, filters);
    termIf("dst_ip", args.dst_ip, filters);
    matchIf("device_hostname", args.device_hostname, filters);
    termIf("rule", args.rule, filters);
    termIf("severity", args.severity, filters);
    const size = Math.min(args.size || 10, 50);
    const bucketField = name === "elk_search_traffic" ? "action" : "severity";
    return esSearch(index, {
      size,
      query: { bool: { filter: filters } },
      sort: [{ "@timestamp": "desc" }],
      _source: ["@timestamp", "src_ip", "dst_ip", "rule", "action", "app", "src_zone", "dst_zone", "device_hostname", "in_iface", "out_iface", "severity", "threat_id", "bytes"],
      aggs: {
        by_bucket: { terms: { field: bucketField, size: 10 } },
        by_device: { terms: { field: "device_hostname", size: 10 } },
      },
    });
  }

  if (name === "elk_count_by_action") {
    const filters = [timeFilter(args.minutes)];
    termIf("src_ip", args.src_ip, filters);
    termIf("dst_ip", args.dst_ip, filters);
    return esSearch("panos-traffic-*", {
      size: 0,
      query: { bool: { filter: filters } },
      aggs: { by_action: { terms: { field: "action", size: 10 } } },
    });
  }

  return { error: `unknown tool ${name}` };
}

const server = new Server(
  { name: "elk-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const result = await callTool(name, args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[elk-mcp] connected (ES_URL=" + ES_URL + ")");
