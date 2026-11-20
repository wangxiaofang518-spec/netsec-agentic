# ============================================================
# setup.ps1 — one-click restore of all 7 MCP servers on a new machine (Windows PowerShell 5.1 or PowerShell 7+)
#
# Easiest — take all 8 keys from the encrypted secrets bundle (unseal it in Git Bash first):
#   bash secrets/unseal.sh                       # asks for the bundle passphrase
#   .\setup.ps1 -FromEnvFile secrets-plain\server\opt\netsec-agent\secrets\agent.env
#
# Or pass the keys explicitly:
#   .\setup.ps1 -ScmSecret "xxx" -KoiKey "xxx" -AirsKey "xxx" `
#               -MgmtSecret "xxx" -SaseExternalGwKey "xxx" `
#               -ScvmAwsHkKey "xxx" -ScvmAwsSgKey "xxx" -AivmAlibabaKey "xxx"
#   (explicit parameters win over -FromEnvFile)
#
# All fixed settings (client IDs, TSG IDs, NGFW hosts) are built in; only the 8 keys are needed.
#
# 7 MCP servers:
#   scm                     Strata Cloud Manager
#   koi                     KOI software supply-chain security
#   prisma-airs             Prisma AIRS AI security
#   panos-sase-external-gw  PAN-OS NGFW — Azure GP gateway       203.0.113.21  (PAVM300-Branch-GPGW-SH)
#   panos-scvm-aws-hk       PAN-OS NGFW — AWS Prisma SC (HK)     203.0.113.22  (PAVM100-PrismaSC-HK)
#   panos-scvm-aws-sg       PAN-OS NGFW — AWS Prisma SC (SG)     203.0.113.23  (PAVM100-PrismaSC-SG)
#   panos-aivm-alibaba      PAN-OS NGFW — Alibaba Cloud security VM 203.0.113.24 (AI-SECVM-Branch-Alibaba-CN)
# ============================================================

param(
    [string]$FromEnvFile = "",                      # netsec-agent agent.env from the unsealed bundle
    [string]$ScmSecret = "",                        # SCM_CLIENT_SECRET
    [string]$KoiKey = "",                           # KOI_API_KEY (valid ~1 year)
    [string]$AirsKey = "",                          # PANW_AI_SEC_API_KEY
    [string]$MgmtSecret = "",                       # PANW_MGMT_CLIENT_SECRET (same value as ScmSecret)
    [Alias('GpgwAzureKey')][string]$SaseExternalGwKey = "",  # PANOS_API_KEY — Azure GP gateway (203.0.113.21); old parameter name still accepted
    [string]$ScvmAwsHkKey = "",                     # PANOS_API_KEY — AWS Prisma SC HK (203.0.113.22)
    [string]$ScvmAwsSgKey = "",                     # PANOS_API_KEY — AWS Prisma SC SG (203.0.113.23)
    [string]$AivmAlibabaKey = "",                   # PANOS_API_KEY — Alibaba Cloud AIVM (203.0.113.24)

    # optional overrides; normally auto-detected
    [string]$PythonExe = "",
    [string]$NodeExe   = "",
    [string]$ClaudeExe = ""
)

$ErrorActionPreference = "Stop"

# ── -FromEnvFile: read keys from agent.env (explicit parameters win) ──
if ($FromEnvFile -ne "") {
    if (-not (Test-Path $FromEnvFile)) { throw "Env file not found: $FromEnvFile" }
    $envMap = @{}
    foreach ($line in Get-Content $FromEnvFile) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
    function Pick($cur, [string[]]$names) { if ($cur -ne "") { return $cur }; foreach ($n in $names) { if ($envMap[$n]) { return $envMap[$n] } }; return "" }
    $ScmSecret         = Pick $ScmSecret         @('SCM_CLIENT_SECRET')
    $KoiKey            = Pick $KoiKey            @('KOI_API_KEY')
    $AirsKey           = Pick $AirsKey           @('PANW_AI_SEC_API_KEY')
    $MgmtSecret        = Pick $MgmtSecret        @('PANW_MGMT_CLIENT_SECRET')
    $SaseExternalGwKey = Pick $SaseExternalGwKey @('PANOS_API_KEY_SASE_EXTERNAL_GW', 'PANOS_API_KEY_GPGW_AZURE')
    $ScvmAwsHkKey      = Pick $ScvmAwsHkKey      @('PANOS_API_KEY_SCVM_AWS_HK')
    $ScvmAwsSgKey      = Pick $ScvmAwsSgKey      @('PANOS_API_KEY_SCVM_AWS_SG')
    $AivmAlibabaKey    = Pick $AivmAlibabaKey    @('PANOS_API_KEY_AIVM_ALIBABA')
    Write-Host "Loaded keys from $FromEnvFile"
}

# optional overrides of the "fixed settings" (tenant IDs, firewall hosts) for other environments
$FixedOverride = @{}
if ($FromEnvFile -ne "") {
    foreach ($pair in @(@('SCM_CLIENT_ID','ScmClientId'),@('SCM_TSG_ID','ScmTsgId'),@('PANW_MGMT_CLIENT_ID','MgmtClientId'),@('PANW_MGMT_TSG_ID','MgmtTsgId'),
                        @('PANOS_HOST_SASE_EXTERNAL_GW','SaseExternalGwHost'),@('PANOS_HOST_SCVM_AWS_HK','ScvmAwsHkHost'),
                        @('PANOS_HOST_SCVM_AWS_SG','ScvmAwsSgHost'),@('PANOS_HOST_AIVM_ALIBABA','AivmAlibabaHost'))) {
        if ($envMap[$pair[0]]) { $FixedOverride[$pair[1]] = $envMap[$pair[0]] }
    }
}

$required = [ordered]@{ ScmSecret = $ScmSecret; KoiKey = $KoiKey; AirsKey = $AirsKey; MgmtSecret = $MgmtSecret
    SaseExternalGwKey = $SaseExternalGwKey; ScvmAwsHkKey = $ScvmAwsHkKey; ScvmAwsSgKey = $ScvmAwsSgKey; AivmAlibabaKey = $AivmAlibabaKey }
$missing = @($required.Keys | Where-Object { $required[$_] -eq "" })
if ($missing.Count -gt 0) { throw "Missing keys: $($missing -join ', ').  Use -FromEnvFile <agent.env> or pass them as parameters." }

# ── Defaults — override each of them in your env file (-FromEnvFile) ──
$ScmClientId        = "<your-service-account>@<your-tsg-id>.iam.panserviceaccount.com"
$ScmTsgId           = "<your-tsg-id>"
$MgmtClientId       = "<your-service-account>@<your-tsg-id>.iam.panserviceaccount.com"
$MgmtTsgId          = "<your-airs-tsg-id>"
$SaseExternalGwHost = "203.0.113.21"
$ScvmAwsHkHost      = "203.0.113.22"
$ScvmAwsSgHost      = "203.0.113.23"
$AivmAlibabaHost    = "203.0.113.24"
foreach ($k in $FixedOverride.Keys) { Set-Variable -Name $k -Value $FixedOverride[$k] }
foreach ($k in @('ScmClientId','ScmTsgId','MgmtClientId','MgmtTsgId','SaseExternalGwHost','ScvmAwsHkHost','ScvmAwsSgHost','AivmAlibabaHost')) {
    $val = Get-Variable -Name $k -ValueOnly
    if ([string]::IsNullOrEmpty($val) -or $val.Contains('<')) { throw "$k is not set - put it in your env file (see netsec-agent\secretsgent.env.example)" }
}

# ── Tool path auto-detection ─────────────────────────────────
function Find-Python {
    if ($script:PythonExe -ne "") { return $script:PythonExe }
    foreach ($cmd in @("python", "python3")) {
        try {
            $v = & $cmd -c "import sys; print(sys.version_info >= (3,11))" 2>$null
            if ($v -eq "True") { return $cmd }
        } catch {}
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312-arm64\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "C:\Python312\python.exe",
        "C:\Python311\python.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            $v = & $p -c "import sys; print(sys.version_info >= (3,11))" 2>$null
            if ($v -eq "True") { return $p }
        }
    }
    throw "Python 3.11+ not found. Install it from https://python.org"
}

function Find-Node {
    if ($script:NodeExe -ne "") { return $script:NodeExe }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\Program Files (x86)\nodejs\node.exe"
    )
    foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
    throw "Node.js not found. Install it from https://nodejs.org"
}

function Find-Claude {
    if ($script:ClaudeExe -ne "") { return $script:ClaudeExe }
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $base = "$env:LOCALAPPDATA\Claude-3p\claude-code"
    if (Test-Path $base) {
        $exe = Get-ChildItem "$base\*\claude.exe" -ErrorAction SilentlyContinue | Sort-Object -Descending | Select-Object -First 1
        if ($exe) { return $exe.FullName }
    }
    throw "Claude CLI not found. Install Claude Code first."
}

$Python = Find-Python
$Node   = Find-Node
$Claude = Find-Claude
$NpmModules = (npm root -g).Trim()

Write-Host ""
Write-Host "=== Detected environment ===" -ForegroundColor Cyan
Write-Host "  Python  : $Python"
Write-Host "  Node    : $Node"
Write-Host "  Claude  : $Claude"
Write-Host "  npm modules: $NpmModules"
Write-Host ""

# ── Step 1: install scm-mcp Python package ───────────────────
Write-Host "=== Step 1: install scm-mcp Python package ===" -ForegroundColor Cyan
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
try { & $Python -m pip install --only-binary :all: cryptography -q 2>$null } catch {}
& $Python -m pip install -e . -q
& $Python -c "from scm_mcp import server; print('scm-mcp tools:', len(server.mcp._tool_manager._tools))"

# ── Step 2: install KOI MCP server ───────────────────────────
Write-Host ""
Write-Host "=== Step 2: install KOI MCP server ===" -ForegroundColor Cyan
npm install -g koi-mcp-server

# ── Step 3: install Prisma AIRS MCP server ───────────────────
Write-Host ""
Write-Host "=== Step 3: install Prisma AIRS MCP server ===" -ForegroundColor Cyan
npm install -g prisma-airs-ops-mcp-server

# ── Step 4: install PAN-OS NGFW MCP server (one package shared by all 4 firewalls) ──
Write-Host ""
Write-Host "=== Step 4: install PAN-OS NGFW MCP server ===" -ForegroundColor Cyan
npm install -g "@iflow-mcp/apius-tech-panos-mcp"

# ── Step 5: register all MCP servers with Claude Code ────────
Write-Host ""
Write-Host "=== Step 5: register MCP servers ===" -ForegroundColor Cyan

$KoiIndex   = Join-Path $NpmModules "koi-mcp-server\dist\index.js"
$AirsIndex  = Join-Path $NpmModules "prisma-airs-ops-mcp-server\dist\index.js"
$PanosIndex = Join-Path $NpmModules "@iflow-mcp\apius-tech-panos-mcp\dist\index.js"

& $Claude mcp add scm `
    -e SCM_CLIENT_ID=$ScmClientId `
    -e SCM_CLIENT_SECRET=$ScmSecret `
    -e SCM_TSG_ID=$ScmTsgId `
    -- $Python -m scm_mcp

& $Claude mcp add koi `
    -e KOI_API_KEY=$KoiKey `
    -- $Node $KoiIndex

& $Claude mcp add prisma-airs `
    -e PANW_AI_SEC_API_KEY=$AirsKey `
    -e PANW_MGMT_CLIENT_ID=$MgmtClientId `
    -e PANW_MGMT_CLIENT_SECRET=$MgmtSecret `
    -e PANW_MGMT_TSG_ID=$MgmtTsgId `
    -- $Node $AirsIndex

& $Claude mcp add panos-sase-external-gw `
    -e PANOS_HOST=$SaseExternalGwHost `
    -e PANOS_API_KEY=$SaseExternalGwKey `
    -- $Node $PanosIndex

& $Claude mcp add panos-scvm-aws-hk `
    -e PANOS_HOST=$ScvmAwsHkHost `
    -e PANOS_API_KEY=$ScvmAwsHkKey `
    -- $Node $PanosIndex

& $Claude mcp add panos-scvm-aws-sg `
    -e PANOS_HOST=$ScvmAwsSgHost `
    -e PANOS_API_KEY=$ScvmAwsSgKey `
    -- $Node $PanosIndex

& $Claude mcp add panos-aivm-alibaba `
    -e PANOS_HOST=$AivmAlibabaHost `
    -e PANOS_API_KEY=$AivmAlibabaKey `
    -- $Node $PanosIndex

# ── Step 6: verify ───────────────────────────────────────────
Write-Host ""
Write-Host "=== Step 6: verify connections ===" -ForegroundColor Cyan
& $Claude mcp list

Write-Host ""
Write-Host "✅ Done! All 7 MCP servers should show Connected:" -ForegroundColor Green
Write-Host "   scm / koi / prisma-airs / panos-sase-external-gw / panos-scvm-aws-hk / panos-scvm-aws-sg / panos-aivm-alibaba" -ForegroundColor Green
Write-Host "   (restart Claude Code to load them)" -ForegroundColor Green
