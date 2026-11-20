# ELK 日志服务器 — 配置备份与重建手册

> English: [README.md](README.md)

集中收集 3 台 PAN-OS NGFW + Prisma Access 的 syslog（TRAFFIC / THREAT / SYSTEM / GLOBALPROTECT / CONFIG / HIPMATCH），
基于 Docker Compose 的 Elasticsearch + Logstash + Kibana 8.14.3。

> **本目录只备份配置，不备份日志数据和私钥。** 线上服务器的证书**及私钥**保存在加密密钥包中（`bash secrets/unseal.sh` 后位于 `secrets-plain/server/opt/elk/certs/`，见 [../secrets/README.md](../secrets/README.md)），绝不以明文进 Git。

---

## 服务器信息

| 项 | 值 |
|---|---|
| 公网 IP | `203.0.113.10` |
| SSH 端口 | `3333`（root） |
| 内网 IP | `10.199.3.47`（经边界防火墙 NAT） |
| OS | Ubuntu, Linux 6.8.0, x86_64 |
| 部署路径 | `/opt/elk/` |
| ELK 版本 | 8.14.3 |
| 云平台 | 阿里云 KVM，由 `panos-aivm-alibaba`（AI-SECVM-Branch-Alibaba-CN, 203.0.113.24）保护 |

### 端口

| 端口 | 用途 |
|---|---|
| 9200 | Elasticsearch HTTP（内网，无认证 `xpack.security.enabled=false`） |
| 5601 | Kibana Web UI |
| 514/udp | syslog 明文接收 |
| 6514/tcp | syslog TLS 接收（自签 CA） |
| 5044 | Beats 预留（当前未用） |

---

## 目录内容

```
elk/
├── docker-compose.yml              # ES + Logstash + Kibana 编排
├── logstash/
│   ├── config/logstash.yml         # Logstash 主配置
│   └── pipeline/panos.conf         # ★ PAN-OS syslog 解析管道（核心）
├── certs-config/                   # 证书【生成配置】（非密钥）
│   ├── ca.crt                      # CA 公钥证书（可公开，客户端信任用）
│   ├── ext.cnf / server.ext        # 服务器证书 SAN 扩展配置
│   └── ocsp_ca.cnf
├── es-templates/                   # 从运行中 ES 导出，可直接 PUT 回
│   ├── template_panos-*.json       # 7 个 index template（字段映射）
│   └── ilm_panos-ilm-*.json        # 4 个 ILM 生命周期策略
└── scripts/
    └── create_dashboards.sh        # Kibana 3 个 Dashboard 重建脚本
```

---

## Pipeline 关键设计（panos.conf）

- **input**：UDP 514（明文）+ TCP 6514（TLS，`ssl_cert`/`ssl_key` 指向 `/etc/logstash/certs/`）
- **filter**：grok 剥离 syslog 头 → csv 按 68 列切分 → 按 `log_type` 分流重命名字段 → 打 tag
- **output**：按 tag 路由到 `panos-{type}-YYYY.MM.dd` 每日索引
- **两处已落地的优化**（2026/07/06）：
  1. **SYSTEM 噪音过滤**：`if [event_id] == "general" { drop { } }` —— general 占 SYSTEM 94%，为周期性状态输出无价值，过滤后 system 日志量降 ~88%
  2. **HIPMATCH 路由修复**：output 补 `else if "panos-hipmatch" in [tags]` 块，此前因缺该块错落到 `panos-other`

> ⚠️ **改 pipeline 的铁律**：Logstash `path.config` 指向整个 `pipeline/` 目录，会把目录下所有文件当成同一条 pipeline 拼接。
> **备份文件绝不能放在 `pipeline/` 目录内**（否则 input 块被加载两份 → 514/6514 端口 `EADDRINUSE` → pipeline 崩溃循环）。备份一律放 `/opt/elk/backups/`。

---

## 索引与保留策略（ILM）

按天分索引 + delete-only ILM（只删超龄索引，不改写数据，新日志零丢失）：

| 索引类型 | ILM 策略 | 保留 | 日均量（优化后） |
|---|---|---|---|
| panos-traffic | panos-ilm-30d | 30 天 | ~229 MB（最大头） |
| panos-threat | panos-ilm-90d | 90 天 | ~50 MB |
| panos-system | panos-ilm-14d | 14 天 | 过滤后大幅下降 |
| panos-globalprotect | panos-ilm-30d | 30 天 | ~11 MB |
| panos-config | panos-ilm-180d | 180 天 | 极小 |
| panos-hipmatch | panos-ilm-14d | 14 天 | 小 |
| panos-other | panos-ilm-14d | 14 天 | 极小 |

长期稳态磁盘占用约 12–15 G / 40 G。

---

## 全新机器重建步骤

### 1. 安装 Docker + Compose，创建目录

```bash
mkdir -p /opt/elk/{elasticsearch/data,logstash/config,logstash/pipeline,certs,backups}
# ES data 目录需可写
chmod -R 777 /opt/elk/elasticsearch/data
# 内核参数（ES 要求）
sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' >> /etc/sysctl.conf
```

### 2. 拷贝配置文件（从本仓库）

```bash
cp elk/docker-compose.yml            /opt/elk/
cp elk/logstash/config/logstash.yml  /opt/elk/logstash/config/
cp elk/logstash/pipeline/panos.conf  /opt/elk/logstash/pipeline/
```

### 3. 生成 TLS 证书（私钥现场生成，SAN=服务器 IP）

> **优先从密钥包恢复原证书**：`cp secrets-plain/server/opt/elk/certs/* /opt/elk/certs/`。各防火墙已信任该 CA，syslog TLS（6514）无需改任何 NGFW 即可继续工作。只有服务器 IP 变化或必须更换 CA 时才按下方重新生成——届时需在每台防火墙重新导入新的 `ca.crt`。

```bash
cd /opt/elk/certs
# CA（10 年）
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt -subj "/CN=SyslogCA"
# 服务器证书（5 年，SAN=IP），server.ext 见 certs-config/
cp <本仓库>/elk/certs-config/server.ext .
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=<服务器IP>"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 1825 -sha256 -extfile server.ext
chmod 644 server.key    # Logstash 容器需可读
```
> 客户端（如 SLS、NGFW syslog profile）需信任 `ca.crt`。

### 4. 启动 ELK

```bash
cd /opt/elk && docker compose up -d
# 等 ES 就绪
until curl -s http://localhost:9200/_cluster/health >/dev/null; do sleep 3; done
```

### 5. 恢复 index templates + ILM 策略

```bash
cd elk/es-templates
# ILM 策略
for f in ilm_*.json; do
  name=$(echo $f | sed 's/^ilm_//;s/.json$//')
  curl -s -X PUT "http://localhost:9200/_ilm/policy/$name" \
    -H 'Content-Type: application/json' -d @"$f"
done
# index templates
for f in template_*.json; do
  name=$(echo $f | sed 's/^template_//;s/.json$//')
  curl -s -X PUT "http://localhost:9200/_index_template/$name" \
    -H 'Content-Type: application/json' -d "{\"index_template\": $(cat $f)}"
done
```
> 注：导出的 template JSON 是 `index_template` 的内层 body，PUT 时若报错需按上面包一层 `{"index_template": ...}`，或直接用内层（视导出格式，两种都试）。

### 6. 重建 Kibana Dashboards

```bash
bash elk/scripts/create_dashboards.sh   # 脚本内 ES/Kibana 地址按需改
```

### 7. 配置 NGFW / Prisma Access 转发 syslog

各 NGFW 的 syslog server profile 指向 `<服务器IP>:6514`（TLS）或 `:514`（UDP），
证书信任链导入 `ca.crt`。

---

## 验证

```bash
docker ps                                                   # 4 容器 Up（含 portkey-gateway 无关）
curl -s http://localhost:9200/_cat/indices/panos-*?v        # 索引在增长
curl -s http://localhost:9200/panos-*/_ilm/explain | grep managed   # ILM 接管
docker logs logstash --since 2m | grep -i "Pipeline started"        # 管道启动
```

---

## 已知遗留问题

- **SLS → ELK TLS 转发未通**：SLS Test Connection 报 TCP timeout。已确认 SYN 到达 Ubuntu 且回了 SYN-ACK，疑似边界防火墙回程未正确 un-NAT。排查方向见运营手册。
- **内存偏紧**：7.1G 机器，ELK 占 ~4.7G（ES heap 2g）。加数据源前先评估。
