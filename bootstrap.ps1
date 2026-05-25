$ErrorActionPreference = "Stop"

# 0. git 확인 — 없으면 winget
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --source winget
    Write-Host "git 설치 후 PowerShell을 새로 열어 명령을 다시 실행하세요."; exit 1
}

# 1. clone or pull
$Dest = Join-Path $env:USERPROFILE "exam-studio"
if (Test-Path (Join-Path $Dest ".git")) {
    # 설치 중 pnpm 이 자동 수정한 추적 파일(pnpm-workspace.yaml 등)을 되돌려 ff pull 이 막히지 않게.
    # (.env 등 gitignore 파일은 영향 없음). 2>&1|Out-* 로 stderr 가 Stop 에 의해 예외화되는 것 방지.
    git -C $Dest checkout -- . 2>&1 | Out-Null
    git -C $Dest pull --ff-only 2>&1 | Out-Host
} else {
    git clone https://github.com/PNKmath/exam-studio.git $Dest 2>&1 | Out-Host
}

# 2. installer 위임
Set-Location $Dest
powershell -ExecutionPolicy Bypass -File .\install.ps1
