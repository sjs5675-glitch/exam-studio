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

### 2회차 (2026-05-25 — KST) — pnpm corepack EPERM 수정

**상태**: completed
**진행 모델**: claude-opus-4-7
**트리거**: Windows 실기 스모크 중 pnpm 설치 단계 실패 보고.

#### 증상
```
> pnpm 설치 중...
Internal Error: EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'
Preparing pnpm@latest for immediate activation...
pnpm : 'pnpm' 용어가 ... 인식되지 않습니다 (install.ps1:67  Say "pnpm $(pnpm -v)")
```

#### 원인
- `corepack enable` 은 pnpm/yarn **shim 을 Node 설치 폴더 안**에 쓴다. winget(공식 MSI) Node 는 `C:\Program Files\nodejs` 에 설치되므로 비관리자 권한에선 `EPERM` 으로 shim 생성 실패 → 이후 `pnpm -v` 가 "용어 인식 불가".
- `$ErrorActionPreference = "Stop"` 가 멈추지 못한 이유: PS 5.1 은 네이티브 명령의 비정상 종료코드를 throw 하지 않음(1회차 NOTES 동작과 일치).
- macOS `install.sh` 도 동일 패턴 — `.pkg` Node 는 `/usr/local/bin`(root 소유)이라 `corepack enable` 이 sudo 없이 EACCES 가능(개발기는 기존 Node 세팅이라 미노출, 신규 Mac 잠재).

#### 수정
- `install.ps1` (pnpm 블록): corepack 경로 제거 → `npm install -g pnpm`(전역 prefix `%AppData%\npm`, 사용자 쓰기 가능). 설치 후 `%AppData%\npm` 을 세션 PATH 에 prepend, 실패 시 `Die` 로 명확한 안내.
- `install.sh` (pnpm 블록): 동일하게 `npm install -g pnpm` + `hash -r` + 실패 시 `die`. (양 OS 패리티)

#### 검증
- [x] `bash -n install.sh` → syntax OK
- [ ] install.ps1 `pwsh` 파싱 → skip(개발기 pwsh 미설치, 브레이스/구문 육안 확인). Windows 실기 재스모크는 수동 게이트.

### 3회차 (2026-05-26 — KST) — Python 감지 견고화 + winget 자동설치

**상태**: completed
**진행 모델**: claude-opus-4-7
**트리거**: 2회차 수정 후 Windows 재스모크 — pnpm 통과, Python 단계 실패 보고.

#### 증상
```
> 가상환경 생성 (.venv)...
No global/local python version has been set yet. Please set the global/local version by typing:
pyenv global 3.7.4
& : 'C:\Users\LOQ\exam-studio\.venv\Scripts\python.exe' 용어가 ... 인식되지 않습니다 (install.ps1:92)
```

#### 원인
- 사용자 PC 에 **pyenv-win** 이 있으나 **버전 미설정**. `Get-Command python` 은 shim 존재만 확인하므로 "찾았다"로 통과하지만, 실제 인터프리터가 실행되지 않아 `python -m venv` 가 빈 깡통 → `.venv\Scripts\python.exe` 부재 → 후속 라인에서 "인식 불가".
- 근본: **존재 확인(Get-Command)만으로는 "동작하는" Python 을 보장하지 못함.**

#### 수정 (install.ps1 Python 블록)
- `Test-Python`: `& $cmd -c "import sys; print(sys.version_info[0])"` 로 **실제 실행 + 버전 출력**을 검증(pyenv 미설정 shim·MS Store stub 걸러냄).
- 후보 순서 `py, python, python3` — **py 런처 우선**(pyenv 의 `python` shim 그림자 회피, py 는 pyenv 가 가로채지 않음).
- 동작하는 Python 부재 시 **`winget install Python.Python.3.12`** 자동설치(Node 패턴과 동일) → 세션 PATH 갱신 → 재탐색, 그래도 없으면 새 창 재실행 안내로 `Die`.
- venv 생성 후 `.venv\Scripts\python.exe` **존재 검증**, 없으면 cryptic 에러 대신 명확한 `Die`(pyenv 버전 설정 안내 포함).

#### 검증
- [ ] install.ps1 `pwsh` 파싱 → skip(개발기 pwsh 미설치, 브레이스/구문 육안 확인). Windows 실기 재스모크는 수동 게이트.
- 사용자 즉시 해소책: `pyenv install 3.12.x && pyenv global 3.12.x` 후 재실행, 또는 python.org 3.12 설치('Add to PATH' 체크) 후 재실행.

#### 보강 (Windows 재스모크 2 — "설치됐는데 못 찾음")
재스모크에서 winget 이 "이미 설치된 기존 패키지를 찾았습니다 … 업그레이드 없음" 을 반환했으나 `Find-Python` 이 여전히 실패 → **Python 3.12 는 설치돼 있으나 PATH 에 없고(무인설치 기본 PrependPath off) pyenv shim 이 `python`/`python3` 를 가려** 셋 다 도달 불가. winget 도 멱등이라 무한 루프.
- `Find-Python` 2단계화: **(1) PATH 후보**(py/python/python3) **(2) 표준 설치 폴더 직접 탐색** — `%LOCALAPPDATA%\Programs\Python\Python3*`, `%ProgramFiles%`, `(x86)`, `C:\` 에서 `python.exe` 를 글롭(최신 버전 우선)해 **절대경로로** Test-Python. PATH/pyenv 를 완전히 우회.
- 찾은 절대경로로 `& $py -m venv` → venv 의 python 은 독립적이고, 런타임 런처가 `.venv\Scripts` 를 prepend 하므로 pyenv 무관.
- winget 호출에 `--source winget` 추가(msstore 소스 동의 프롬프트 회피).

#### 보강 (Windows 재스모크 3 — codex stderr 가 스크립트를 죽임)
Python·.env 통과 후 AI CLI 단계에서 `codex login status` 가 정상 상태 메시지 **"Logged in using ChatGPT" 를 stderr 로** 출력 → 상단 `$ErrorActionPreference = "Stop"` 이 이를 `NativeCommandError`(치명)로 바꿔 `codex.ps1:24`(`& node ...`)에서 스크립트 중단. **로그인 성공인데 죽는 역설.** `2>&1 > $null` 은 셈 내부에서 던져진 예외를 못 막음.
- AI CLI 설치/로그인 구간 진입 시 **`$ErrorActionPreference = "Continue"`** 로 낮춤. 이 구간은 전부 native 호출 + 수동 `$LASTEXITCODE` 체크라 Stop 불필요(Install-Codex/Install-Claude 의 `npm i -g` stderr 도 동일 위험이었음).
- install.sh 는 bash `set -e` 가 stderr 아닌 exit code 에만 반응 + 이미 `codex login status >/dev/null 2>&1` 로 감싸서 무관(패리티 불필요).

#### 보강 (Windows 재스모크 4 — 설치 성공 후 기동 실패: pnpm 11 빌드정책)
설치 완료 후 `start-background.vbs`(→`pnpm dev`/`pnpm dev:sse`) 실행 시 백그라운드 로그에서 `[ERR_PNPM_IGNORED_BUILDS]` 후 `runDepsStatusCheck` → 내부 `pnpm install` **exit 1** 로 기동 차단.
- 원인: **pnpm 11 이 `onlyBuiltDependencies` 를 더 이상 읽지 않음**(→ `allowBuilds` 로 대체, 공식 문서 확인). 그래서 `studio/pnpm-workspace.yaml` 의 `onlyBuiltDependencies:[esbuild,sharp]` 가 무시되고 esbuild·sharp 까지 "ignored builds" 로 떠 네 패키지(esbuild/msw/sharp/unrs-resolver)의 빌드 결정이 **미정** → 스크립트 실행 전 deps 점검이 미정 빌드를 exit 1 로 처리. (재스모크1에서 pnpm 이 자동 추가하려던 `allowBuilds` 템플릿이 사실 이 마이그레이션 요구였음 — 그때 되돌린 게 잘못.)
- 수정: `pnpm-workspace.yaml` 에 `allowBuilds` 추가, 네 패키지 모두 `false`(이 프로젝트 네이티브 의존성은 전부 prebuilt 바이너리로 동작 — `@img/sharp-*`·`@esbuild/*`·napi 플랫폼 패키지 — 빌드 불필요). `onlyBuiltDependencies` 는 구 pnpm 9 호환으로 유지. 런타임 영향 없음(prebuilt). Windows 실기 재기동 검증 필요.

#### 파이프라인 forward-audit (설치 이후 런타임까지 동일 클래스 점검)
사용자 질의("뒤 단계에서 또 비슷한 문제 없나?")로 install 이후 런타임 python 호출 경로를 전수 점검:
- ✅ Windows 런처(`start-logs.bat`·`start-background.vbs`)는 `.venv\Scripts` 를 PATH 에 prepend → 런타임 bare `python` 이 venv 를 먼저 가리켜 pyenv shim 우회.
- ✅ `cleanerRunner.ts`·`figureRunner.ts`·`app/api/{auto-crop,pdf-meta,pdf-preview}` 는 `win32 ? "python" : "python3"` 정합.
- ✅ preflight(`lib/ai/preflight.ts`)는 AI provider(codex/claude/SDK)만 점검 — Python 오탐 차단 없음.
- 🔧 **`studio/server/stages/builder.ts:58`** — `input.pythonCommand ?? "python3"` 인데 `pythonCommand` 는 코드 어디서도 미할당 → 항상 `python3`. **Windows venv 는 `python3.exe` 를 안 만들므로**(python.exe 만) 핵심 build 스테이지가 Windows 런타임에서 실패. → `win32 ? "python" : "python3"` 로 수정(다른 러너와 동일 패턴). tsc 통과, builder.test 는 mock runner 주입이라 영향 없음.

#### NOTES
- macOS `install.sh` Python 감지에도 **감지 견고화 + venv 검증 패리티 적용함**(`test_python` 으로 실제 실행 검증, venv 생성 후 `.venv/bin/python` 존재 확인). 자동설치(.pkg)는 macOS 가 python3 흔함 + sudo .pkg 큰 변경이라 **미적용**(사용자 결정). builder 는 `process.platform` 분기라 양 OS 무관.
