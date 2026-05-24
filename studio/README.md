# Exam Studio — 웹앱 (`studio/`)

이 디렉토리는 Exam Studio 의 Next.js 웹 애플리케이션입니다.
설치·실행 안내는 저장소 루트의 [`../README.md`](../README.md) 를 참고하세요.

## 개발 명령 (이 디렉토리에서)

```bash
pnpm dev          # 개발 서버 (port 3020)
pnpm dev:sse      # SSE 로그 서버 (port 3021)
pnpm build        # 프로덕션 빌드
pnpm start        # 프로덕션 서버
pnpm test         # Vitest 단위 테스트
npx tsc --noEmit  # 타입 검증
```

처음이라면 루트에서 `./install.sh`(macOS/Linux) 또는 `install.bat`(Windows) 로
Node + Python 의존성을 먼저 설치하세요.
