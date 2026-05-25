# 온보딩 설계서 — 처음 보는 사용자 → 시험지 제작 가능까지

> 대상: 비전문가(강사·교사). "한 줄 붙여넣기"로 설치~로그인~기동까지 도달하는 것이 목표.
> 배포 타깃: Windows / macOS **네이티브** (WSL 불필요).

## 1. 확정 결정 (locked)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 진입점 | **A — 한 줄 부트스트랩**. GitHub raw 호스팅 (`PNKmath/exam-studio`, public 확인됨) |
| D2 | CLI 실행 방식 | **네이티브** claude/codex. **WSL 브리지 제거** |
| D3 | AI CLI 설치 | 설치 시 **선택**: `[1] Codex(권장)` / `[2] Claude Code` / `[3] 둘 다` |
| D4 | 설치 직후 | 선택한 CLI마다 **대화형 로그인 터미널**을 띄워 브라우저 oauth 유도 |
| D5 | 게이팅 | 앱이 job 시작 전 "선택·설치된 CLI 중 **≥1개가 로그인까지 완료**"인지 확인, 아니면 차단+안내 |
| D6 | Mac prereq | git·python3 = Xcode CLT / **Node = 공식 .pkg 자동설치**(`sudo installer`) |
| D7 | Win prereq | git·Node = `winget` 무인 설치 |
| D8 | Node 버전 | **≥ 22** (codex 요구) — 현 installer의 `>=20` 체크 상향 |

부트스트랩 명령:
- Mac: `curl -fsSL https://raw.githubusercontent.com/PNKmath/exam-studio/main/bootstrap.sh | bash`
- Win: `irm https://raw.githubusercontent.com/PNKmath/exam-studio/main/bootstrap.ps1 | iex`

## 2. 파이프라인 (Win/Mac 동일 — 셸 문법만 다름)

```
[부트스트랩 한 줄]
 0. git 확인/유도      Mac: Xcode CLT 프롬프트  /  Win: winget install Git.Git
 1. git clone          ~/exam-studio (있으면 git pull)
 2. install 위임       Node(≥22)·Python·pnpm·deps
                       Mac Node: nodejs.org 공식 .pkg → sudo installer -pkg … -target /
                       Win Node: winget install OpenJS.NodeJS.LTS
 3. AI CLI 선택 설치    [1]Codex(기본) [2]Claude [3]둘다
                       codex: npm i -g @openai/codex
                       claude: npm i -g @anthropic-ai/claude-code (또는 공식 installer)
                       ※ Mac(curl|bash): 메뉴는 read … < /dev/tty 로 입력받음
                       ※ Win(irm|iex): Read-Host 정상
 4. 로그인 화면         선택분마다 보이는 터미널 띄움 → 브라우저 oauth
                       codex: codex login   /  claude: claude (첫 실행 시 로그인)
 5. 앱 기동 + 게이팅    start → http://localhost:3020
```

## 3. 시나리오 매트릭스 (각 셀의 동작)

| OS | 상태 | 동작 |
|---|---|---|
| Mac | git 없음 | `git` 첫 호출 → Xcode CLT 설치 프롬프트 (일회성) |
| Mac | Node 없음 | 공식 .pkg 자동설치 (관리자 암호 1회) |
| Win | git/Node 없음 | winget 무인 설치 |
| 공통 | CLI 없음 | D3 선택 메뉴 → npm 설치 |
| 공통 | CLI 있음·미로그인 | D4 로그인 터미널 자동 기동 |
| 공통 | CLI 있음·로그인됨 | 게이팅 통과 → 바로 사용 |
| 재실행 | 이미 clone됨 | `git pull` 후 변경분만 |

## 4. 인증(로그인) 판별 — provider별 비대칭

- **codex**: `codex login status` → 로그인 exit 0 / 미로그인 exit 1. **스크립트 판별 가능**.
- **claude**: 공식 상태확인 CLI **없음**. 우회:
  - 자격증명 파일 확인: Win `%USERPROFILE%\.claude\.credentials.json` / Mac=Keychain(파일 확인 불가) →
  - 또는 헤드리스 프로브 `claude -p "ok"` 호출해 auth 에러 여부로 판정 (Mac은 이 쪽이 신뢰 가능).
- 헤드리스 재사용: 대화형 로그인으로 저장된 자격증명을 `claude -p` / `codex exec`가 그대로 사용함(검증됨).

## 5. 코드 변경 (구현 단위 + 검증)

### 5-1. WSL 브리지 제거 (논란 없음, 먼저)
- `lib/claude.ts`: `IS_WINDOWS ? spawn("wsl.exe",…) : spawn("claude",…)` → 네이티브 단일화. `toWslPath`/`fromWslPath` 호출 제거.
- `server/sse.ts`: `toAbsWsl`(372) → `path.resolve`만. 출력경로 변환(538) 제거.
- `app/api/status/route.ts`: WSL 분기 제거, 네이티브 `--version` 체크.
- **검증**: `npx tsc --noEmit` + 기존 vitest. Mac 실기 1회.

### 5-2. codex 네이티브 spawn 보정
- `lib/ai/providers/codexCli.ts`: Windows에서 npm 전역 bin이 `.cmd` shim일 수 있음 → spawn 시 확장자/`shell` 처리. **Windows 실기 스모크 필수**.

### 5-3. 런타임 게이팅
- job 시작 전(orchestrator 또는 `app/api/create`) 사전점검: 선택 provider가 설치+인증됐는지. 실패 시 명확한 한국어 에러 + 로그인 유도.
- `/api/status` 확장: `installed` + `authenticated` 둘 다 반환.

### 5-4. 로그인 터미널 런처 (앱에서도)
- 로컬 Node 서버가 보이는 터미널 spawn: Win `start "" cmd /k codex login`, Mac `open -a Terminal`/osascript.
- 프론트: "로그인 필요" 배너 + 버튼 → 위 런처 호출.

### 5-5. 부트스트랩 + installer 본체
- 신규 `bootstrap.sh` / `bootstrap.ps1` (0~1단계 + install 위임).
- `install.sh`/`install.ps1`: D3 선택 설치 + D4 로그인 기동 추가. Mac Node .pkg. Node 체크 `>=22`.

### 5-6. 영향 없음 확인
- 오케스트레이터/extractor/solver/verifier/builder/checker/figure = OS-agnostic, **무변경**. Python은 이미 Node가 `process.platform` 분기로 spawn.

## 6. 구현 순서

1. **5-1 WSL 브리지 제거** → tsc+test+Mac 실기 (가장 안전, 즉시 가치)
2. **5-3 게이팅** (status 확장 포함) → 미설치/미인증 시 의문사 방지
3. **5-2 codex spawn** + Windows 스모크
4. **5-5 부트스트랩/installer** (선택설치 + Node .pkg + Node22)
5. **5-4 로그인 런처 + 프론트 배너**

## 7. 남은 실측 포인트 (구현 중)
- Windows 네이티브 `codex exec --json --sandbox danger-full-access` 1회 스모크 (+ .cmd spawn).
- claude 미로그인 판별 방식(파일 vs 프로브) 실기 확정.
- (참고) 2026-06-15부터 구독 플랜 `claude -p`는 별도 Agent SDK 크레딧 차감 — 비용 안내용.
