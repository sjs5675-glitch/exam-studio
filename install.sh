#!/usr/bin/env bash
# Exam Studio — dependency installer (macOS / Linux)
#
#   git clone <repo> && cd exam-studio && ./install.sh
#
# Installs Node dependencies (pnpm) and Python dependencies (.venv).
# After this, launch with:  ./start.command   (or: cd studio && ./scripts/start.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$ROOT/studio"
VENV="$ROOT/.venv"

say()  { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m!  %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

echo "============================================"
echo "  Exam Studio — installer"
echo "============================================"

# --- Node.js ---------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js를 찾을 수 없습니다. https://nodejs.org 에서 LTS(>=20)를 설치하세요."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || warn "Node $NODE_MAJOR 감지 — 20 이상을 권장합니다."
say "Node $(node -v)"

# --- pnpm ------------------------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  say "pnpm 설치 중..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable && corepack prepare pnpm@latest --activate
  else
    npm install -g pnpm
  fi
fi
say "pnpm $(pnpm -v)"

# --- Node deps -------------------------------------------------------------
say "Node 의존성 설치 중 (studio/)..."
( cd "$STUDIO" && { pnpm install --frozen-lockfile 2>/dev/null || pnpm install; } )

# --- Python ----------------------------------------------------------------
PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[ -n "$PY" ] || die "Python 3을 찾을 수 없습니다. https://www.python.org 에서 3.10+ 를 설치하세요."
say "Python $("$PY" --version 2>&1 | awk '{print $2}')"

say "가상환경 생성 (.venv)..."
"$PY" -m venv "$VENV"
# shellcheck disable=SC1091
"$VENV/bin/python" -m pip install --upgrade pip >/dev/null
say "Python 의존성 설치 중 (requirements.txt)..."
"$VENV/bin/python" -m pip install -r "$ROOT/requirements.txt"

# --- .env ------------------------------------------------------------------
if [ ! -f "$STUDIO/.env" ]; then
  cp "$STUDIO/.env.example" "$STUDIO/.env"
  say ".env 생성 (studio/.env) — API 키를 채워주세요."
fi

# --- AI provider hint ------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  warn "Claude CLI 미설치 — legacy 흐름을 쓰려면 'claude' CLI 설치 또는 studio/.env 에 API 키 설정이 필요합니다."
fi

echo ""
echo "============================================"
echo "  설치 완료 ✅"
echo "============================================"
echo "  실행:   ./start.command      (또는: cd studio && ./scripts/start.sh)"
echo "  웹:     http://localhost:3020"
echo "  Python: .venv (런처가 자동으로 PATH에 추가)"
echo ""
