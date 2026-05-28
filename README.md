# Exam Studio

과학 시험지, 과학 문제집(학생용), 과학 문제집(교사용)을 PDF에서 읽어 HWPX 문서로 정리하는 로컬 실행형 도구입니다.

교사용 문제집은 학생용 파일에 파란 글씨로 답이나 해설이 적힌 형태를 기준으로 하며, 문제집 고유 번호, 중요 태그, QR, 쪽수 같은 편집용 표시는 작업 옵션에 따라 제외할 수 있습니다.

## 주요 기능

- PDF 문제 이미지 업로드 및 문제별 crop
- 과학 시험지 / 과학 문제집 / 교사용 문제집 메타데이터 입력
- 손글씨 제거와 그림 재생성 엔진 분리 설정
- 교사용 그림의 파란 답 표시 제거 및 흑백 처리
- 보기 ㄱㄴㄷ형 선지의 3+2 배치
- HWPX 결과물 생성

## 빠른 설치

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/sjs5675-glitch/exam-studio/main/bootstrap.ps1 | iex
```

설치 후에는 설치 폴더에서 `start-background.vbs`를 실행하면 앱이 백그라운드로 켜지고 브라우저가 열립니다.

로그를 보면서 실행하려면 `start-logs.bat`를 실행하세요.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/sjs5675-glitch/exam-studio/main/bootstrap.sh | bash
```

설치 후 `start-background.command` 또는 `start-logs.command`를 실행하세요.

## 직접 설치

이미 저장소를 받은 경우:

### Windows

```powershell
.\install.bat
```

실행:

```text
start-background.vbs
```

또는:

```text
start-logs.bat
```

### macOS / Linux

```bash
chmod +x install.sh
./install.sh
```

실행:

```bash
./start-background.command
```

또는:

```bash
./start-logs.command
```

## 접속 주소

앱이 켜지면 브라우저에서 다음 주소로 접속합니다.

```text
http://localhost:3020
```

SSE 로그 서버는 내부적으로 다음 포트를 사용합니다.

```text
http://localhost:3021
```

## 필요 환경

- Python 3.10 이상
- Node.js 22 이상
- pnpm
- Codex CLI 또는 지원되는 AI provider
- HWPX 파일을 열 수 있는 한글/Hancom 또는 HWPX 뷰어

설치 스크립트는 가능한 의존성을 자동으로 준비합니다. Windows에서는 Python 설치 시 `Add Python to PATH`가 켜져 있어야 합니다.

## AI 설정

설정 화면(`/settings`)에서 작업 단계별 AI provider를 선택할 수 있습니다.

- 텍스트 추출, 풀이, 검수: Codex CLI, Claude, OpenAI SDK, DeepSeek 등
- 손글씨 제거: 별도 이미지 정리 엔진
- 그림 재생성: 별도 그림 재생성 엔진

그림 재생성이나 Gemini 기반 처리를 쓰려면 `studio/.env`에 API 키가 필요할 수 있습니다.

```env
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
```

## 개발 명령

`studio/` 폴더에서 실행합니다.

```bash
pnpm dev
pnpm dev:sse
pnpm test
npx tsc --noEmit
```

## 배포 시 주의

이 저장소에는 앱 코드만 올리고, 실제 문제집 PDF, 학생 답안, 생성 결과물, API 키는 올리지 마세요.

특히 출판사 문제집 PDF와 교사용 답안 파일은 저작권 문제가 생길 수 있으므로 각 사용자가 본인 권한 안에서 직접 업로드해 사용해야 합니다.

## 원본

이 배포본은 `PNKmath/exam-studio`를 기반으로 수정한 과학 자료 타이핑용 버전입니다.
