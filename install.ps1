# Exam Studio - dependency installer (Windows / PowerShell)
#
#   Double-click install.bat  (or:  powershell -ExecutionPolicy Bypass -File install.ps1)
#
# Installs Node dependencies (pnpm) and Python dependencies (.venv).
# After this, double-click "Exam Studio.vbs" to launch.
$ErrorActionPreference = "Stop"

$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Studio = Join-Path $Root "studio"
$Venv   = Join-Path $Root ".venv"

function Say($m)  { Write-Host "> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "X $m" -ForegroundColor Red; exit 1 }

Write-Host "============================================"
Write-Host "  Exam Studio - installer (Windows)"
Write-Host "============================================"

# --- Node.js ---------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js를 찾을 수 없습니다. https://nodejs.org 에서 LTS(>=20)를 설치하세요."
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Warn "Node $nodeMajor 감지 - 20 이상을 권장합니다." }
Say "Node $(node -v)"

# --- pnpm ------------------------------------------------------------------
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Say "pnpm 설치 중..."
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable
    corepack prepare pnpm@latest --activate
  } else {
    npm install -g pnpm
  }
}
Say "pnpm $(pnpm -v)"

# --- Node deps -------------------------------------------------------------
Say "Node 의존성 설치 중 (studio/)..."
Push-Location $Studio
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { pnpm install }
} finally { Pop-Location }

# --- Python ----------------------------------------------------------------
$py = $null
foreach ($c in @("python", "py", "python3")) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break }
}
if (-not $py) { Die "Python 3을 찾을 수 없습니다. https://www.python.org 에서 3.10+ 를 설치하세요 (Add to PATH 체크)." }
Say "Python $(& $py --version)"

Say "가상환경 생성 (.venv)..."
& $py -m venv $Venv
$venvPy = Join-Path $Venv "Scripts\python.exe"
& $venvPy -m pip install --upgrade pip | Out-Null
Say "Python 의존성 설치 중 (requirements.txt)..."
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt")

# --- .env ------------------------------------------------------------------
$envFile = Join-Path $Studio ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Studio ".env.example") $envFile
  Say ".env 생성 (studio\.env) - API 키를 채워주세요."
}

# --- AI provider hint ------------------------------------------------------
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Warn "Claude CLI 미설치 - legacy 흐름을 쓰려면 'claude' CLI 설치 또는 studio\.env 에 API 키 설정이 필요합니다."
}

Write-Host ""
Write-Host "============================================"
Write-Host "  설치 완료 (OK)"
Write-Host "============================================"
Write-Host "  실행(백그라운드): start-background.vbs 더블클릭"; Write-Host "  실행(로그):       start-logs.bat 더블클릭"
Write-Host "  웹:     http://localhost:3020"
Write-Host ""
