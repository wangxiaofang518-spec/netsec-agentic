# 健康基线采集模板

> 部署完成后,让 Agent 采集一次**健康态基线**并存档。排障时用"当前 vs 基线"找偏差 —— 这是快速定位的关键。
> 全部只读采集。建议每次重大变更后重新采集,并记录日期。

## 采集方式(对 Agent 说)
> "帮我采集所有 NGFW 和 SCM 的健康基线快照,存成文档:每台设备的安全规则、NAT、PBF、路由(注意多虚拟路由器)、地址对象、zone、IPSec 隧道状态;SCM 的 remote network / service connection / 安全策略 folder;并标注采集日期。"

## 基线应包含(每台 NGFW)
- [ ] 安全规则:名称、from/to zone、source/dest、application/service、**action**、顺序、是否 disabled
- [ ] NAT 规则:源/目标 NAT、端口映射
- [ ] PBF 规则:匹配条件、egress 接口、是否带 monitor(**排障必查,优先于路由**)
- [ ] 路由表:各虚拟路由器的目标网段→下一跳/接口(注意多 VR)
- [ ] 地址对象:name → value 映射(应对"对象写错")
- [ ] Zone → 接口映射
- [ ] IPSec 隧道:对端 IP、SA 是否建立、加密参数

## 基线应包含(Prisma Access / SCM)
- [ ] Remote Network / Service Connection:名称、service IP、BGP peer/AS、子网
- [ ] 各 folder(Remote Networks / Mobile Users)的安全策略:规则、action、顺序
- [ ] 自定义 URL 分类:名称 + **成员列表**
- [ ] URL 过滤 profile:block/alert 的类别

## 黄金路径(客户环境请替换为实际)
记录关键业务流的正常路径,例:
```
GP用户 → [入口NGFW: 入接口→规则→出接口] → IPSec → Prisma Access(RN/SC) → [数据中心NGFW] → 目标
```
排障时对照此路径,偏差处即故障点。

## 存档
- 基线文档命名带日期:`baseline-YYYYMMDD.md`
- 建议纳入客户自己的 Git / 文档库,版本化管理
