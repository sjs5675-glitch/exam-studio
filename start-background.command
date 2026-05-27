#!/usr/bin/env bash
# Exam Studio — 백그라운드 실행 (macOS). Finder 에서 더블클릭.
# 서버를 백그라운드로 띄우고 브라우저를 연 뒤 이 창은 닫아도 됩니다.
# 로그는  .logs/  폴더에 기록됩니다.  (처음엔 ./install.sh 먼저 실행)
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/studio"

if [ ! -d "node_modules/.bin" ]; then
  echo "의존성이 없습니다. 먼저 ./install.sh 를 실행하세요."
  read -r -p "엔터로 종료..." _ ; exit 1
fi

# .venv(파이썬 의존성)를 PATH 에 추가 — spawn 되는 python3 가 .venv 를 쓰도록
[ -d "$ROOT/.venv/bin" ] && export PATH="$ROOT/.venv/bin:$PATH"

# 데이터 루트 고정 — 서버 실행 위치 무관하게 API가 outputs/inputs 를 찾도록
export EXAM_STUDIO_ROOT="$ROOT"

# 기존 포트 정리
for p in 3020 3021; do lsof -ti "tcp:$p" 2>/dev/null | xargs kill 2>/dev/null || true; done

mkdir -p "$ROOT/.logs"
nohup pnpm dev:sse > "$ROOT/.logs/sse.log" 2>&1 &  disown
nohup pnpm dev     > "$ROOT/.logs/next.log" 2>&1 & disown

# 서버 준비되면 브라우저 오픈 (업데이트 재시작 시엔 EXAM_STUDIO_NO_OPEN=1 → 생략, 프론트가 같은 탭 새로고침)
if [ "$EXAM_STUDIO_NO_OPEN" != "1" ]; then
( for _ in $(seq 1 90); do
    curl -s http://localhost:3020 >/dev/null 2>&1 && { open "http://localhost:3020"; break; }
    sleep 1
  done ) &
fi

echo "Exam Studio 백그라운드 실행 중  →  http://localhost:3020"
echo "로그: $ROOT/.logs/   |  중지:  lsof -ti tcp:3020 tcp:3021 | xargs kill"
echo "이 창은 닫아도 서버는 계속 실행됩니다."
sleep 2
