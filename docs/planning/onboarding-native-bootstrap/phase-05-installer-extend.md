---
phase: 5
title: installer 확장 (Node≥22 + Mac .pkg/winget + CLI 선택설치 + 로그인 기동)
status: completed
depends_on: []
scope:
  - install.sh
  - install.ps1
intervention_likely: true
intervention_reason: "sudo(.pkg) 권한 입력 + Windows 동작은 Mac 개발기에서 검증 불가 — 실기 스모크 필요. 설치 흐름 설계 판단 다수."
executor: opus
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 5: installer 확장

> **범위**: 설치 스크립트 (Bash + PowerShell)
> **난이도**: L
> **의존성**: 없음 (Phase 1~4와 독립; 단 Phase 6 부트스트랩이 이걸 위임 호출)
> **영향 파일**: `install.sh`(macOS), `install.ps1`(Windows)

## 배경
현 installer는 Node/Python/pnpm/deps만 챙기고 **AI CLI는 "힌트 문구"만** 띄운다(설계서 §1 D3·D4 미구현). 비전문가용 원클릭을 위해 installer가:
1. Node **≥22**(codex 요구, D8) 보장 — 현 체크는 `>=20`.
2. Mac에서 Node 부재 시 **공식 .pkg 자동설치**(D6) / Windows는 **winget**(D7).
3. AI CLI **선택 설치**(D3): `[1] Codex(권장) [2] Claude Code [3] 둘 다`.
4. 선택분마다 **대화형 로그인 터미널 기동**(D4).

`curl|bash`(Phase 6 경유) 환경에서 stdin이 스크립트라 **`read … < /dev/tty`** 로 키 입력을 받아야 함(Mac/bash). PowerShell `Read-Host`는 정상.

## 설계

### install.sh (macOS)
- Node 체크: major `< 22`이거나 부재 → 공식 .pkg 설치:
  ```bash
  # 아키텍처 무관 universal pkg (최신 LTS22)
  NODE_PKG_URL="https://nodejs.org/dist/v22.<minor>/node-v22.<minor>.pkg"   # 실제 최신 LTS22 버전 확인 후 고정
  curl -fsSL "$NODE_PKG_URL" -o "$TMP/node.pkg"
  echo "macOS 로그인 비밀번호를 입력하세요 (Node 설치)"
  sudo installer -pkg "$TMP/node.pkg" -target /
  ```
- CLI 선택 메뉴 (`read … < /dev/tty`):
  ```bash
  printf "설치할 AI 도구를 고르세요:\n  1) Codex (권장)\n  2) Claude Code\n  3) 둘 다\n> "
  read -r CHOICE < /dev/tty
  ```
  - codex: `npm i -g @openai/codex`
  - claude: `npm i -g @anthropic-ai/claude-code` (또는 공식 `curl -fsSL https://claude.ai/install.sh | bash`)
- 로그인 기동 (선택분마다, 보이는 안내):
  - codex: `codex login` (브라우저 oauth)
  - claude: `claude`(첫 실행 시 로그인). 비대화형 스크립트 안에서 호출 시 TTY 필요 → `< /dev/tty` 연결 또는 안내 후 사용자가 직접 1회 실행하도록.
  - 이미 로그인된 경우(`codex login status` exit 0) 스킵.

### install.ps1 (Windows)
- Node 체크 `< 22` 또는 부재 → `winget install OpenJS.NodeJS.LTS`(무인) → PATH 갱신 안내.
- CLI 선택 메뉴 `Read-Host`.
  - codex: `npm i -g @openai/codex`
  - claude: `irm https://claude.ai/install.ps1 | iex` 또는 `npm i -g @anthropic-ai/claude-code`
- 로그인 기동: 새 콘솔 창으로 대화형 — `Start-Process` 사용:
  ```powershell
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k","codex login"
  ```
- 인증 스킵 조건: `codex login status` exit 0.

### 공통
- 기존 Node/Python/pnpm/deps/.env 흐름은 유지하고 위 단계 추가.
- 로그인은 **실패해도 설치 자체는 완료**로 보고(앱 게이팅/배너가 후속 안내) — 설치와 로그인을 분리해 부분 성공 허용.

## 체크리스트
- [x] Node 버전 게이트 `>=20` → `>=22` 상향 (양 스크립트)
- [x] macOS: Node 부재/구버전 시 공식 .pkg `sudo installer` 자동설치 (비밀번호 안내 문구)
- [x] Windows: Node 부재/구버전 시 `winget install OpenJS.NodeJS.LTS`
- [x] CLI 선택 메뉴 — macOS `read < /dev/tty`, Windows `Read-Host` (1=codex,2=claude,3=둘다, 기본 codex)
- [x] 선택분 설치 — codex `npm i -g @openai/codex`, claude 공식 installer 또는 npm
- [x] 설치 후 미로그인이면 대화형 로그인 기동 (mac: `codex login`/`claude` via tty, win: `Start-Process cmd /k`)
- [x] 이미 로그인(`codex login status` exit 0)이면 로그인 단계 스킵
- [~] macOS 실기: `./install.sh` 완주 (Node .pkg + 선택설치 + 로그인 안내) — dry run 로그 확인 (개발기 Node v26·codex 로그인됨이라 .pkg/sudo·신규 install·실제 oauth 경로는 비실행; mock 분리 dry run으로 제어흐름만 검증 → 실기는 수동 게이트)

## 영향 범위
- 파괴적 작업 아님(설치만). 단 `sudo installer`는 관리자 권한 — 사용자 비밀번호 1회.
- Windows 전 경로는 **실기 스모크 전까지 미검증** (공통 체크리스트의 Windows 항목으로 이월).
- 멱등성: 재실행 시 이미 설치/로그인된 단계는 스킵.

## 검증
```bash
# macOS (개발기)
./install.sh           # 메뉴 응답 → 설치/로그인 흐름 육안 확인
node -v                # v22+
codex login status; echo $?   # 로그인 후 0
```
Windows 실기 (수동): install.ps1 더블클릭/PowerShell 실행 → winget Node → 선택설치 → 로그인 창.

## 실행 결과

### 1회차 (2026-05-25 — KST) — completed
**상태**: completed
**소요 시간**: 약 20분
**진행 모델**: claude-opus-4-7

#### 요약
`install.sh`(macOS)·`install.ps1`(Windows) 두 installer에 Node≥22 게이트 상향 + 자동설치(.pkg/winget), AI CLI 선택 설치 메뉴(1=Codex 권장/2=Claude/3=둘다, 기본 Codex), 선택분 로그인 기동(미로그인 시), `codex login status` exit 0 시 로그인 스킵을 추가했다. 설치와 로그인을 분리해 로그인 실패해도 설치는 완료로 처리. 개발기에서 가능한 정적 검증(`bash -n`, mock 분리 dry run, 실제 codex 바이너리 idempotent 경로)을 수행했고, sudo(.pkg)·winget·실제 oauth·Windows 실행은 Mac에서 실기 불가라 수동 게이트로 분리.

#### 변경 파일
- `install.sh` (수정, +57/-9줄) — Node≥22 .pkg 자동설치, CLI 선택메뉴+`read < /dev/tty`, install_codex/install_claude 함수, login-status 스킵
- `install.ps1` (수정, +56/-9줄) — Node≥22 winget 자동설치, CLI 선택메뉴+`Read-Host`, Install-Codex/Install-Claude 함수, `Start-Process cmd /k` 로그인 창

#### 검증 결과
- [x] `bash -n install.sh` → pass (구문 OK)
- [x] node_major 함수(node 부재 시 `set -e` 미중단, 0 반환) 시뮬레이션 → pass
- [x] CLI 메뉴 case 분기(빈/1/2/3/invalid → 기본 codex 폴백) 시뮬레이션 → pass
- [x] install_codex `set -e` 하 npm 실패에도 함수 exit 0 (설치/로그인 분리) → pass
- [x] 실제 codex 바이너리로 idempotent 경로(이미 설치+`codex login status` exit 0 → 둘 다 스킵, npm 미호출) → pass
- [x] install.ps1 brace/paren balance 휴리스틱(문자열 인식) → pass (depth 0)
- [x] Node v22 LTS 최신 버전 확인 + `node-v22.22.3.pkg` URL HEAD → HTTP 200
- [ ] install.ps1 `pwsh` 구문 파싱 → skip — Mac 개발기에 pwsh 미설치 (수동 게이트: Windows 실기)
- [ ] macOS `./install.sh` 완주(.pkg+sudo) → skip — 개발기 Node v26(≥22)라 .pkg 경로 미실행, sudo 권한 실기 불가 (수동 게이트)
- [ ] 실제 신규 `npm i -g` 설치 + 브라우저 oauth → skip — 부수효과/실기 (수동 게이트)

#### 추가 발견사항
- install.ps1 상단 `$ErrorActionPreference = "Stop"`는 PS 5.1(더블클릭 기본 타깃)에서 네이티브 exe 비정상 종료코드를 throw하지 않으므로 `$LASTEXITCODE` 분기는 유효하다(검토상). 단 PowerShell 7+ 에서는 `$PSNativeCommandUseErrorActionPreference` 설정에 따라 동작이 달라질 수 있어 Windows 실기 시 npm 실패 분기 동작 재확인 권장 — NOTES.

#### 질문 / 결정 사항
- 없음. (스펙의 설계를 그대로 구현; .pkg 버전은 nodejs.org dist에서 최신 LTS22 = v22.22.3 으로 고정하고 URL 200 확인.)

#### Scope Audit (orchestrator)
pass — install.sh, install.ps1 (scope), unattributed 0

#### Verification Re-run (orchestrator)
bash -n install.sh exit 0 (구문 OK). install.ps1은 pwsh 미설치로 정적검증 불가 — 수동 게이트 이월. 첫 검증 블록(./install.sh)은 interactive/destructive이므로 실행하지 않고 정적 등가 검증으로 대체 (partial 정합)

#### Simplify (orchestrator)
0 files, 0 edits — 보수적 skip (설치 스크립트, install.ps1 런타임 검증 불가)

#### Review (orchestrator)
VERDICT pass — F(보안: HTTPS .pkg, pipe-to-bash 미사용, 비밀값 없음, set -e 안전) 면밀 검수 통과, ISSUES 0

#### Commit
2ebe1e3
