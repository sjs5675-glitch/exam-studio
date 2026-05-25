$ErrorActionPreference = "Stop"

# 0. git 확인 — 없으면 winget
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --source winget
    Write-Host "git 설치 후 PowerShell을 새로 열어 명령을 다시 실행하세요."; exit 1
}

# 1. clone or pull
#
# git 은 "From https://...", "HEAD is now at..." 같은 정상 진행 메시지도 stderr 로 쓴다.
# Windows PowerShell 5.1 에서 $ErrorActionPreference=Stop 이면 native 명령의 stderr 가
# 치명 오류(NativeCommandError)로 둔갑해 부트스트랩이 그 줄에서 중단된다(빨간 "From https://..." 메시지).
# 2>&1|Out-Host 로도 막히지 않으므로, git 구간만 Continue 로 낮추고 --quiet 로 진행 메시지를 끈 뒤
# $LASTEXITCODE 로 실제 실패만 판정한다. (clone 후 작업이 install.ps1 까지 반드시 이어지도록.)
$Dest = Join-Path $env:USERPROFILE "exam-studio"
$ErrorActionPreference = "Continue"
if (Test-Path (Join-Path $Dest ".git")) {
    # 항상 GitHub 최신 main 으로 강제 동기화한다.
    # pull --ff-only 는 로컬 커밋/분기·force-push 시 막혀 stale 코드로 설치가 진행될 수 있어,
    # fetch + reset --hard 로 추적 파일·로컬 커밋을 모두 origin/main 에 맞춘다.
    # (.env/.venv/node_modules 등 gitignore untracked 파일은 reset --hard 가 건드리지 않음 → 보존)
    git -C $Dest fetch origin --quiet
    if ($LASTEXITCODE -ne 0) { Write-Host "X git fetch 실패 — 네트워크/원격 상태 확인 후 다시 실행하세요." -ForegroundColor Red; exit 1 }
    git -C $Dest reset --hard origin/main --quiet
    if ($LASTEXITCODE -ne 0) { Write-Host "X git reset 실패." -ForegroundColor Red; exit 1 }
} else {
    git clone --quiet https://github.com/PNKmath/exam-studio.git $Dest
    if ($LASTEXITCODE -ne 0) { Write-Host "X git clone 실패 — 네트워크 상태 확인 후 다시 실행하세요." -ForegroundColor Red; exit 1 }
}
$ErrorActionPreference = "Stop"

# 2. installer 위임
Set-Location $Dest
powershell -ExecutionPolicy Bypass -File .\install.ps1
