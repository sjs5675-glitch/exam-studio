# Exam Studio

수학 기출 시험지를 **HWPX(한컴오피스 개방형 포맷)** 로 제작하는 워크플로우 도구입니다.
PDF에서 문제를 추출하고, 해설을 생성·검증하고, 그림을 처리한 뒤 HWPX 문서로 조립합니다.

- **웹 UI**: Next.js (`studio/`)
- **문서 엔진**: Python (HWPX = ZIP+XML 직접 조작)
- **AI 파이프라인**: Claude / Gemini (추출·해설·그림)

---

## 빠른 시작 (사람용)

### macOS / Linux
```bash
./install.sh                  # 1회: Node + Python 의존성 설치 (.venv 생성)
```
실행 — 둘 중 하나를 **Finder 에서 더블클릭** (둘 다 http://localhost:3020 자동 오픈):
- `start-background.command` — 백그라운드 실행 (창 닫아도 계속, 로그는 `.logs/`)
- `start-logs.command` — 터미널 창에 **실시간 로그** 표시

### Windows
1회 설치: `install.bat` **더블클릭**. 이후 실행 — 둘 중 하나를 더블클릭:
- `start-background.vbs` — 백그라운드 실행 (콘솔 없이 브라우저 자동 오픈)
- `start-logs.bat` — 로그 창을 띄워 **실시간 로그** 표시

> 백그라운드 실행을 멈추려면: mac `lsof -ti tcp:3020 tcp:3021 | xargs kill`,
> Windows 는 `start-logs.bat` 으로 한 번 실행 후 키 입력으로 종료하거나 작업 관리자에서 node 종료.

설치 전 **Node.js 20+** 와 **Python 3.10+**, 그리고 **AI 제공자 CLI 하나**가 있어야 합니다
— **Codex CLI 권장**, 또는 Claude Code CLI (기본값). pnpm 은 설치 스크립트가 자동으로 준비합니다.
(Windows는 Python 설치 시 *Add Python to PATH* 체크.) AI 제공자는 아래 "설정" 참고.

---

## 자동 설치 (AI 코딩 에이전트용 — Claude Code / Codex)

이 저장소를 클론한 뒤 아래 절차를 **순서대로** 실행하면 설치·실행이 끝납니다. 먼저 OS를 판별하세요.

### macOS / Linux
```bash
# 1) 사전 요건 확인 (없으면 사용자에게 설치 요청)
node -v        # v20 이상
python3 --version   # 3.10 이상

# 2) 설치 (Node 의존성 + .venv 파이썬 의존성)
chmod +x install.sh && ./install.sh

# 3) AI 제공자 준비 — 추출/해설 단계 실행에 필요 (둘 중 하나)
#    - Codex CLI (권장): `codex` 설치 + 인증 → /settings 에서 provider를 Codex CLI로
#    - Claude Code CLI (기본): `claude` 설치 + 로그인 (별도 설정 없이 동작)
#    (선택) 그림 처리: studio/.env 의 GEMINI_API_KEY. API키 provider(OpenAI/DeepSeek)도 /settings 지정 가능.

# 4) 실행 (백그라운드로 띄우고 검증)
( cd studio && export PATH="$PWD/../.venv/bin:$PATH" && pnpm dev:sse & )
( cd studio && export PATH="$PWD/../.venv/bin:$PATH" && pnpm dev & )

# 5) 검증: 200 이 나오면 성공
sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3020
```
대화형 실행/브라우저 오픈까지 안내하려면 `./start-logs.command`(로그 창) 또는 `./start-background.command`(백그라운드) 를 더블클릭하라고 사용자에게 알려주세요.

### Windows (PowerShell)
```powershell
node -v ; python --version
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# 실행: start-background.vbs (백그라운드) 또는 start-logs.bat (로그 창) 더블클릭
```

### 검증 기준 (성공 조건)
- `cd studio && npx tsc --noEmit` → 에러 0
- `cd studio && pnpm test` → 통과 (Live API 테스트는 키 없으면 skip)
- `http://localhost:3020` 접속 시 대시보드가 뜨고 좌측 메뉴에 **시험지 제작 / 히스토리 / 설정** 이 보임

---

## 설정 (`studio/.env`)

`install` 스크립트가 `studio/.env.example` → `studio/.env` 를 복사합니다. 필요한 키만 채우세요.

| 변수 | 용도 | 필수 |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | 그림(figure) 재생성·크롭 (nano-banana) | 그림 처리 시 |
| `DEEPSEEK_API_KEY` | DeepSeek API provider (opt-in) | 선택 |
| `HWPX_TEMPLATE_PATH` | 공통 양식지 HWPX 경로 (비우면 업로드 파일 사용) | 선택 |
| `NEXT_PUBLIC_SSE_URL` | SSE 서버 URL (기본 `http://localhost:3021`) | — |

**AI 제공자** (추출/해설/검증 단계 실행): 모든 단계는 코드 orchestrator(`runStageOrchestrator`)가 결정론적으로 실행하며, 단계별 provider를 `/settings` 에서 지정합니다. 다음 중 하나가 필요합니다.
- **Codex CLI** (권장): `codex` 설치 + 인증. 구독으로 추가 토큰 과금 없이 사용. `/settings` 에서 provider를 Codex CLI로 지정.
- **Claude Code CLI** (기본값 `auto`): `claude` 설치 + 로그인. 별도 설정 없이 동작.
- API 키 provider: Claude SDK(`ANTHROPIC_API_KEY`) / OpenAI SDK(`OPENAI_API_KEY`) / DeepSeek(`DEEPSEEK_API_KEY`) — `/settings` 에서 stage별 지정.

---

## 명령어 (개발자용)

`studio/` 에서 실행:

| 명령 | 설명 |
| :--- | :--- |
| `pnpm dev` | Next.js 개발 서버 (port 3020) |
| `pnpm dev:sse` | SSE 로그 서버 (port 3021) |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm start` | 프로덕션 서버 |
| `pnpm test` | Vitest 단위 테스트 |
| `npx tsc --noEmit` | 타입 검증 |

---

## 프로젝트 구조

```
exam-studio/
├── install.sh / install.bat / install.ps1   # 의존성 설치
├── start-background.* / start-logs.*       # 실행 런처 (mac/win × 백그라운드/로그)
├── requirements.txt          # Python 의존성 (PyMuPDF, Pillow, google-genai)
├── studio/                   # Next.js 웹앱 (UI + API + SSE + stage orchestrator)
├── .claude/                  # AI 에이전트(exam-*) + 스킬(exam-create 등)
├── resources/hwpx_base/      # HWPX 템플릿 XML (빌더가 사용)
├── docs/                     # 아키텍처 · 작업 가이드라인
├── build_hwpx.py, assemble.py, tables.py, ... # HWPX 조립 엔진
└── workspaces/               # PDF 크롭 등 Python 워크스페이스
```

---

## 문제 해결

- **`python3: command not found` / 그림 처리 실패** → `./install.sh`(또는 `install.ps1`)로 `.venv` 를 만들었는지 확인. 런처가 `.venv` 를 PATH 에 자동 추가하므로 **런처로 실행**해야 파이썬 의존성이 인식됩니다.
- **포트 충돌 (3020/3021)** → 런처가 기존 프로세스를 정리합니다. 수동: 해당 포트 점유 프로세스 종료.
- **PowerShell 실행 차단** → `install.bat` 이 `-ExecutionPolicy Bypass` 로 우회합니다.
- **PyMuPDF/Pillow 설치 실패** → Python 버전을 확인하세요(3.10–3.12 권장). 일부 최신 버전은 휠이 없을 수 있습니다.
