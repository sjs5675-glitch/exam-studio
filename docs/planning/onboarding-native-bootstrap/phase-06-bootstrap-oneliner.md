---
phase: 6
title: 부트스트랩 한 줄 (bootstrap.sh / bootstrap.ps1)
status: completed
depends_on: [5]
scope:
  - bootstrap.sh
  - bootstrap.ps1
intervention_likely: true
intervention_reason: "Windows irm|iex 경로는 Mac에서 검증 불가 — 실기 스모크 필요. raw 호스팅 경로/브랜치 확정 필요."
executor: sonnet
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 6: 부트스트랩 한 줄

> **범위**: 부트스트랩 스크립트 (Bash + PowerShell)
> **난이도**: M
> **의존성**: Phase 5 (installer가 위임 대상)
> **영향 파일**: `bootstrap.sh`, `bootstrap.ps1` (둘 다 신규)

## 배경
진입점 결정 = **A, 한 줄 부트스트랩**(설계서 D1). 비전문가가 Terminal/PowerShell에 한 줄을 붙여넣으면 git 확인 → clone → installer 위임까지 끝나야 한다. repo는 GitHub `PNKmath/exam-studio`(public, raw HTTP 200 확인).

명령:
- Mac: `curl -fsSL https://raw.githubusercontent.com/PNKmath/exam-studio/main/bootstrap.sh | bash`
- Win: `irm https://raw.githubusercontent.com/PNKmath/exam-studio/main/bootstrap.ps1 | iex`

## 설계

### bootstrap.sh (macOS)
```bash
set -euo pipefail
# 0. git 확인 — 없으면 Xcode CLT 유도
if ! command -v git >/dev/null 2>&1; then
  echo "git 설치가 필요합니다. 설치 창이 뜨면 '설치'를 누르세요."
  xcode-select --install || true
  echo "설치 완료 후 이 명령을 다시 실행하세요."; exit 1
fi
# 1. clone or pull
DEST="$HOME/exam-studio"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone https://github.com/PNKmath/exam-studio.git "$DEST"; fi
# 2. installer 위임
cd "$DEST" && bash ./install.sh
```

### bootstrap.ps1 (Windows)
```powershell
$ErrorActionPreference = "Stop"
# 0. git 확인 — 없으면 winget
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install --id Git.Git -e --source winget
  Write-Host "git 설치 후 PowerShell을 새로 열어 명령을 다시 실행하세요."; exit 1
}
# 1. clone or pull
$Dest = Join-Path $env:USERPROFILE "exam-studio"
if (Test-Path (Join-Path $Dest ".git")) { git -C $Dest pull --ff-only }
else { git clone https://github.com/PNKmath/exam-studio.git $Dest }
# 2. installer 위임
Set-Location $Dest
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

- `xcode-select --install`는 GUI 대화상자를 띄우고 즉시 반환 → 안내 후 재실행 요청(2단계 불가피, CLT는 비동기).
- clone 대상은 `$HOME/exam-studio` / `%USERPROFILE%\exam-studio` — 고정. 이미 있으면 `pull`(멱등).

## 체크리스트
- [x] `bootstrap.sh` 신규: git 확인(CLT 유도) → clone/pull → `bash ./install.sh` 위임
- [x] `bootstrap.ps1` 신규: git 확인(winget) → clone/pull → `install.ps1` 위임
- [x] clone 대상 경로 `$HOME`/`$env:USERPROFILE` 사용 (하드코딩 금지)
- [x] 이미 clone된 경우 `git pull --ff-only` (멱등)
- [x] raw URL/브랜치(`main`) 명시 + README에 한 줄 명령 추가 안내 (README는 scope 밖 — NOTES 처리)
- [ ] macOS 실기: `bash bootstrap.sh`(또는 curl 파이프) 완주 → ~/exam-studio 생성 + install 진입

## 영향 범위
- 신규 파일 2개. 기존 흐름 무영향.
- Windows `irm|iex` 경로는 **실기 스모크 필요**.
- `xcode-select --install` 미완료 시 재실행 요청으로 graceful 종료.

## 검증
```bash
# macOS (임시 디렉터리에서 안전 테스트 권장)
bash bootstrap.sh    # git/clone/install 진입 확인
```
Windows 실기: `irm <raw>/bootstrap.ps1 | iex` 완주.

## 실행 결과

### 1회차 (2026-05-25 22:57 KST) — completed
**상태**: completed
**소요 시간**: 약 5분
**진행 모델**: claude-sonnet-4-6

#### 요약
`bootstrap.sh`(macOS)와 `bootstrap.ps1`(Windows) 두 파일을 설계 스펙 그대로 신규 작성했다.
bash 구문 검사(`bash -n`) 통과, PowerShell 정적 패턴 검사(python3 regex) 8개 항목 모두 통과.
macOS 실기(pull 분기 조건)는 `$HOME/exam-studio/.git` 존재 확인으로 검증. 실제 `git pull` + `bash install.sh` 완주 실기는 phase-run guard + intervention_likely=true 게이트로 사용자 수동 확인 이월.
README 한 줄 명령 추가 항목은 scope 밖이므로 NOTES 처리.

#### 변경 파일
- `bootstrap.sh` (신규, +20줄)
- `bootstrap.ps1` (신규, +20줄)

#### 검증 결과
- [x] bootstrap.sh 구문 검사: `bash -n bootstrap.sh` → pass
- [x] bootstrap.ps1 정적 패턴 검사: python3 regex 8개 항목 → pass
- [x] bootstrap.sh 분기 조건: `$HOME/exam-studio/.git` 존재 시 pull 분기 진입 → pass
- [ ] macOS 실기 완주: `bash bootstrap.sh` → pull + install 진입 — intervention_likely=true로 수동 게이트 이월 (pwsh 미설치로 PowerShell 실기 불가)

#### 추가 발견사항
NOTES:
- cross-phase: `README.md`에 한 줄 부트스트랩 명령(`curl -fsSL .../bootstrap.sh | bash` / `irm .../bootstrap.ps1 | iex`) 추가 권장. scope 밖이므로 수동 추가 필요.

#### 질문 / 결정 사항
없음

#### Scope Audit (orchestrator)
pass — bootstrap.sh, bootstrap.ps1 (scope, 신규), unattributed 0. README는 worker가 NOTES로만 보고(scope 준수)

#### Verification Re-run (orchestrator)
bash -n bootstrap.sh exit 0. bootstrap.ps1은 pwsh 미설치로 정적검증 불가 — 수동 게이트. 첫 검증 블록(bash bootstrap.sh)은 destructive이므로 정적 등가로 대체 (partial 정합)

#### Simplify (orchestrator)
0 files — 보수적 skip (부트스트랩 스크립트, ps1 검증 불가)

#### Review (orchestrator)
VERDICT pass — F(보안: HTTPS 고정 clone URL, pull --ff-only 멱등, 홈 경로 변수) 검수 통과, ISSUES 0

#### Commit
9aa3385
