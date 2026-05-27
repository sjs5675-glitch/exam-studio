#!/bin/bash
# Exam Studio 시작 스크립트
# 팀 서버 또는 로컬에서 실행

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

cd "$PROJECT_DIR"

# 데이터 루트를 명시적으로 고정 — 서버 실행 위치가 달라도 API가 outputs/inputs 를 찾도록
export EXAM_STUDIO_ROOT="$REPO_ROOT"

# .venv(파이썬 의존성)를 PATH 앞에 추가 — spawn 되는 python3 가 .venv 를 쓰도록
[ -d "$REPO_ROOT/.venv/bin" ] && export PATH="$REPO_ROOT/.venv/bin:$PATH"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js가 설치되어 있지 않습니다."
  echo "   https://nodejs.org 에서 설치해주세요."
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "pnpm 설치중..."
  npm install -g pnpm
fi

# Check Claude CLI
if ! command -v claude &> /dev/null; then
  echo "Claude CLI가 설치되어 있지 않습니다."
  echo "   작업 실행은 불가하지만 UI는 확인 가능합니다."
fi

# Install dependencies
echo "의존성 설치중..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Ports
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3020}"
SSE_PORT="${SSE_PORT:-3021}"
MODE="${1:-dev}"

# Cleanup on exit
cleanup() {
  [ -n "$SSE_PID" ] && kill "$SSE_PID" 2>/dev/null
  exit
}
trap cleanup EXIT INT TERM

# Kill any existing processes on our ports
fuser -k "${SSE_PORT}/tcp" 2>/dev/null || true
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

# Start SSE server (separate process to avoid Next.js buffering)
echo "SSE 서버 시작 (port ${SSE_PORT})..."
SSE_PORT="$SSE_PORT" pnpm dev:sse &
SSE_PID=$!
sleep 2

if [ "$MODE" = "prod" ]; then
  echo "빌드중..."
  pnpm build
  echo ""
  echo "Exam Studio 시작 (프로덕션)"
  echo "   로컬:  http://localhost:${PORT}"
  echo "   네트워크: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${PORT}"
  echo ""
  pnpm start -H "$HOST" -p "$PORT"
else
  echo ""
  echo "Exam Studio 시작 (개발 모드)"
  echo "   UI:   http://localhost:${PORT}"
  echo "   SSE:  http://localhost:${SSE_PORT}"
  echo ""
  pnpm dev -H "$HOST" -p "$PORT"
fi
