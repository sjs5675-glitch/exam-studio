#!/usr/bin/env bash
# Exam Studio Launcher (macOS) — Finder 에서 더블클릭하면 실행됩니다.
# 처음 한 번은 ./install.sh 를 먼저 실행해 의존성을 설치하세요.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/studio"

if [ ! -d "node_modules/.bin" ]; then
  echo "의존성이 설치되지 않았습니다. 먼저 ./install.sh 를 실행하세요."
  read -r -p "엔터를 누르면 종료합니다..." _
  exit 1
fi

# .venv(파이썬 의존성)를 PATH 앞에 추가 — spawn 되는 python3 가 .venv 를 쓰도록
[ -d "$ROOT/.venv/bin" ] && export PATH="$ROOT/.venv/bin:$PATH"

# 서버가 뜨면 브라우저 자동 오픈
( for _ in $(seq 1 90); do
    if curl -s http://localhost:3020 >/dev/null 2>&1; then open "http://localhost:3020"; break; fi
    sleep 1
  done ) &

exec ./scripts/start.sh dev
