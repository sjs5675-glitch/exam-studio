# Exam Studio - dependency installer (Windows / PowerShell)
#
#   Double-click install.bat  (or:  powershell -ExecutionPolicy Bypass -File install.ps1)
#
# Installs Node dependencies (pnpm) and Python dependencies (.venv).
# After this, double-click start-background.vbs (or start-logs.bat) to launch.
$ErrorActionPreference = "Stop"

# 콘솔/자식 프로세스 출력 UTF-8 (Windows CP949 한글 깨짐 방지)
try { chcp 65001 > $null } catch {}
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Studio = Join-Path $Root "studio"
$Venv   = Join-Path $Root ".venv"

function Say($m)  { Write-Host "> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "X $m" -ForegroundColor Red; exit 1 }

Write-Host "============================================"
Write-Host "  Exam Studio - installer (Windows)"
Write-Host "============================================"

# --- Node.js (>=22 보장) ---------------------------------------------------
# Codex CLI 가 Node 22+ 를 요구. 부재하거나 구버전이면 winget 으로 LTS 무인 설치.
function Get-NodeMajor {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  try { return [int](node -p "process.versions.node.split('.')[0]") } catch { return 0 }
}
$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 22) {
  if ($nodeMajor -eq 0) {
    Say "Node.js 미설치 - winget 으로 LTS 자동설치를 진행합니다."
  } else {
    Say "Node $nodeMajor 감지 - 22 미만이라 winget 으로 LTS 업그레이드합니다."
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die "winget 을 찾을 수 없습니다. https://nodejs.org 에서 LTS(>=22) 를 수동 설치한 뒤 다시 실행하세요."
  }
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Warn "Node 설치 완료. PATH 갱신을 위해 이 창을 닫고 PowerShell 을 새로 열어 install.ps1 을 다시 실행하세요."
  # 현재 세션 PATH 에 갱신을 반영 시도 (machine + user)
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt 22) {
    Die "현재 세션에서 Node 22+ 를 인식하지 못했습니다. PowerShell 을 새로 열고 install.ps1 을 다시 실행하세요."
  }
}
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

# --- AI CLI 선택 설치 + 로그인 ----------------------------------------------
# 로그인은 설치와 분리: 실패해도 설치 자체는 완료로 본다(앱 게이팅/배너가 후속 안내).

function Install-Codex {
  if (Get-Command codex -ErrorAction SilentlyContinue) {
    Say "Codex CLI 이미 설치됨 - 건너뜀."
  } else {
    Say "Codex CLI 설치 중 (npm i -g @openai/codex)..."
    npm i -g @openai/codex
    if ($LASTEXITCODE -ne 0) { Warn "Codex CLI 설치 실패 - 나중에 'npm i -g @openai/codex' 로 재시도하세요."; return }
  }
  # 이미 로그인돼 있으면 스킵
  & codex login status > $null 2>&1
  if ($LASTEXITCODE -eq 0) {
    Say "Codex 로그인 상태 확인됨 - 로그인 단계 건너뜀."
  } else {
    Warn "Codex 로그인 창을 새로 엽니다 (브라우저 OAuth). 실패해도 설치는 완료."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k","codex login"
  }
}

function Install-Claude {
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Say "Claude Code CLI 이미 설치됨 - 건너뜀."
  } else {
    Say "Claude Code CLI 설치 중 (npm i -g @anthropic-ai/claude-code)..."
    npm i -g @anthropic-ai/claude-code
    if ($LASTEXITCODE -ne 0) { Warn "Claude Code CLI 설치 실패 - 나중에 'npm i -g @anthropic-ai/claude-code' 로 재시도하세요."; return }
  }
  Warn "Claude Code 로그인 창을 새로 엽니다. 안내에 따라 1회 로그인하세요 (실패해도 설치는 완료)."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k","claude"
}

Say "AI 도구를 선택해 설치합니다 (앱은 Codex 권장)."
Write-Host "설치할 AI 도구를 고르세요:"
Write-Host "  1) Codex (권장)"
Write-Host "  2) Claude Code"
Write-Host "  3) 둘 다"
$choice = Read-Host "번호 입력 (기본 1)"
switch ($choice) {
  "2"     { Install-Claude }
  "3"     { Install-Codex; Install-Claude }
  default { Install-Codex }   # 빈 입력/그 외 -> 기본 Codex
}

Write-Host ""
Write-Host "============================================"
Write-Host "  설치 완료 (OK)"
Write-Host "============================================"
Write-Host "  실행(백그라운드): start-background.vbs 더블클릭"; Write-Host "  실행(로그):       start-logs.bat 더블클릭"
Write-Host "  웹:     http://localhost:3020"
Write-Host ""
