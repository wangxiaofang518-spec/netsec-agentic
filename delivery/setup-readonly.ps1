# ============================================================
# setup-readonly.ps1 — NetSec Agentic 只读版部署 (Windows)
#
# 用客户自己的【只读 RBAC 凭据】注册 MCP。只读强制来自 RBAC 权限,不是本脚本。
# 见 01-READONLY-SECURITY-MODEL.md
#
# 用法(NGFW 用哈希表数组,支持 1~N 台):
#   .\setup-readonly.ps1 -ScmClientId "..." -ScmSecret "..." -ScmTsgId "..." `
#     -Ngfw @( @{name="fw-hq"; host="10.0.0.1"; key="KEY1"}, @{name="fw-dc"; host="10.0.0.2"; key="KEY2"} ) `
#     [-AirsKey "..." -AirsClientId "..." -AirsTsgId "..."]
# ============================================================
param(
  [Parameter(Mandatory)][string]$ScmClientId,
  [Parameter(Mandatory)][string]$ScmSecret,
  [Parameter(Mandatory)][string]$ScmTsgId,
  [array]$Ngfw = @(),
  [string]$AirsKey = "",
  [string]$AirsClientId = "",
  [string]$AirsTsgId = ""
)
$ErrorActionPreference = "Stop"

function Find-Cmd($names){ foreach($n in $names){ $c=(Get-Command $n -ErrorAction SilentlyContinue); if($c){return $c.Source} }; throw "缺少 $names" }
$Python = Find-Cmd @("python","python3")
$Node   = Find-Cmd @("node")
$Claude = Find-Cmd @("claude")
$NpmModules = (npm root -g).Trim()
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "=== 环境: Python=$Python Node=$Node Claude=$Claude ===" -ForegroundColor Cyan

# 装依赖
Set-Location $RepoRoot
& $Python -m pip install -e . -q
npm install -g prisma-airs-ops-mcp-server "@iflow-mcp/apius-tech-panos-mcp" 2>$null

$AirsIndex  = Join-Path $NpmModules "prisma-airs-ops-mcp-server\dist\index.js"
$PanosIndex = Join-Path $NpmModules "@iflow-mcp\apius-tech-panos-mcp\dist\index.js"

# scm(只读)
Write-Host "=== 注册 scm (只读) ===" -ForegroundColor Cyan
& $Claude mcp add scm `
  -e SCM_CLIENT_ID=$ScmClientId -e SCM_CLIENT_SECRET=$ScmSecret -e SCM_TSG_ID=$ScmTsgId `
  -- $Python -m scm_mcp

# prisma-airs(可选)
if ($AirsKey -ne "") {
  Write-Host "=== 注册 prisma-airs ===" -ForegroundColor Cyan
  $aid = if($AirsClientId){$AirsClientId}else{$ScmClientId}
  $atsg = if($AirsTsgId){$AirsTsgId}else{$ScmTsgId}
  & $Claude mcp add prisma-airs `
    -e PANW_AI_SEC_API_KEY=$AirsKey -e PANW_MGMT_CLIENT_ID=$aid `
    -e PANW_MGMT_CLIENT_SECRET=$ScmSecret -e PANW_MGMT_TSG_ID=$atsg `
    -- $Node $AirsIndex
}

# 每台 NGFW(只读 API Key)
foreach ($fw in $Ngfw) {
  if (-not $fw.host -or -not $fw.key) { continue }
  $name = if($fw.name){$fw.name}else{"panos-$($fw.host)"}
  Write-Host "=== 注册 NGFW: $name ($($fw.host)) [只读] ===" -ForegroundColor Cyan
  & $Claude mcp add $name -e PANOS_HOST=$($fw.host) -e PANOS_API_KEY=$($fw.key) -- $Node $PanosIndex
}

Write-Host ""
Write-Host "=== 验证 ===" -ForegroundColor Cyan
& $Claude mcp list
Write-Host ""
Write-Host "✅ 只读版部署完成。" -ForegroundColor Green
Write-Host "⚠️  下一步必做:在 Claude 里让 Agent 试一次变更,确认被设备以'只读/权限不足'拒绝(唯一可信的只读证明)。" -ForegroundColor Yellow
