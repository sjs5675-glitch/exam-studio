$ErrorActionPreference = "Stop"

# 0. git 확인 — 없으면 winget
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --source winget
    Write-Host "git 설치 후 PowerShell을 새로 열어 명령을 다시 실행하세요."; exit 1
}

# 1. clone or pull
$Dest = Join-Path $env:USERPROFILE "exam-studio"
if (Test-Path (Join-Path $Dest ".git")) {
    git -C $Dest pull --ff-only
} else {
    git clone https://github.com/PNKmath/exam-studio.git $Dest
}

# 2. installer 위임
Set-Location $Dest
powershell -ExecutionPolicy Bypass -File .\install.ps1
