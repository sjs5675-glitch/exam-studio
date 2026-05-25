$ErrorActionPreference = "Stop"

# 0. git 확인 — 없으면 winget
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --source winget
    Write-Host "git 설치 후 PowerShell을 새로 열어 명령을 다시 실행하세요."; exit 1
}

# 1. clone or pull
$Dest = Join-Path $env:USERPROFILE "exam-studio"
if (Test-Path (Join-Path $Dest ".git")) {
    # 항상 GitHub 최신 main 으로 강제 동기화한다.
    # pull --ff-only 는 로컬 커밋/분기·force-push 시 막혀 stale 코드로 설치가 진행될 수 있어,
    # fetch + reset --hard 로 추적 파일·로컬 커밋을 모두 origin/main 에 맞춘다.
    # (.env/.venv/node_modules 등 gitignore untracked 파일은 reset --hard 가 건드리지 않음 → 보존)
    # 2>&1|Out-Host 로 native stderr 가 Stop 에 의해 예외화되는 것 방지.
    git -C $Dest fetch origin 2>&1 | Out-Host
    git -C $Dest reset --hard origin/main 2>&1 | Out-Host
} else {
    git clone https://github.com/PNKmath/exam-studio.git $Dest 2>&1 | Out-Host
}

# 2. installer 위임
Set-Location $Dest
powershell -ExecutionPolicy Bypass -File .\install.ps1
