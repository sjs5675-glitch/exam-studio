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

# 공식 Node LTS22 .pkg (universal — Intel/Apple Silicon 공용). 최신 LTS22 버전 고정.
NODE_PKG_URL="https://nodejs.org/dist/v22.22.3/node-v22.22.3.pkg"

say()  { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m!  %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

echo "============================================"
echo "  Exam Studio — installer"
echo "============================================"

# --- Node.js (>=22 보장) ---------------------------------------------------
# Codex CLI 가 Node 22+ 를 요구. 부재하거나 구버전이면 공식 .pkg 자동설치 (macOS).
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE_MAJOR="$(node_major)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ "$NODE_MAJOR" -eq 0 ]; then
    say "Node.js 미설치 — 공식 LTS22 .pkg 자동설치를 진행합니다."
  else
    say "Node $NODE_MAJOR 감지 — 22 미만이라 공식 LTS22 .pkg 로 업그레이드합니다."
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    say "Node .pkg 다운로드 중..."
    curl -fsSL "$NODE_PKG_URL" -o "$TMP/node.pkg" || die "Node .pkg 다운로드 실패 — 네트워크 확인 후 https://nodejs.org 에서 LTS22 수동 설치하세요."
    warn "macOS 로그인 비밀번호를 입력하세요 (관리자 권한으로 Node 설치)."
    sudo installer -pkg "$TMP/node.pkg" -target / || die "Node 설치 실패. https://nodejs.org 에서 LTS22 수동 설치하세요."
    hash -r 2>/dev/null || true
    NODE_MAJOR="$(node_major)"
    [ "$NODE_MAJOR" -ge 22 ] || die "Node 설치 후에도 버전이 22 미만입니다. 새 터미널을 열고 다시 실행하세요."
  else
    die "Node.js >=22 가 필요합니다. https://nodejs.org 에서 LTS22 를 설치한 뒤 다시 실행하세요."
  fi
fi
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

# --- AI CLI 선택 설치 + 로그인 ----------------------------------------------
# 로그인은 설치와 분리: 실패해도 설치 자체는 완료로 본다(앱 게이팅/배너가 후속 안내).

install_codex() {
  if command -v codex >/dev/null 2>&1; then
    say "Codex CLI 이미 설치됨 — 건너뜀."
  else
    say "Codex CLI 설치 중 (npm i -g @openai/codex)..."
    npm i -g @openai/codex || { warn "Codex CLI 설치 실패 — 나중에 'npm i -g @openai/codex' 로 재시도하세요."; return 0; }
  fi
  hash -r 2>/dev/null || true
  # 이미 로그인돼 있으면 스킵
  if codex login status >/dev/null 2>&1; then
    say "Codex 로그인 상태 확인됨 — 로그인 단계 건너뜀."
  else
    warn "Codex 로그인이 필요합니다. 브라우저 OAuth 창이 열립니다 (실패해도 설치는 완료)."
    codex login </dev/tty || warn "Codex 로그인 미완료 — 나중에 'codex login' 으로 다시 시도하세요."
  fi
}

install_claude() {
  if command -v claude >/dev/null 2>&1; then
    say "Claude Code CLI 이미 설치됨 — 건너뜀."
  else
    say "Claude Code CLI 설치 중 (npm i -g @anthropic-ai/claude-code)..."
    npm i -g @anthropic-ai/claude-code || { warn "Claude Code CLI 설치 실패 — 나중에 'npm i -g @anthropic-ai/claude-code' 로 재시도하세요."; return 0; }
  fi
  hash -r 2>/dev/null || true
  warn "Claude Code 로그인이 필요할 수 있습니다. 새 터미널에서 'claude' 를 1회 실행해 로그인하세요 (실패해도 설치는 완료)."
}

say "AI 도구를 선택해 설치합니다 (앱은 Codex 권장)."
printf "설치할 AI 도구를 고르세요:\n  1) Codex (권장)\n  2) Claude Code\n  3) 둘 다\n> "
CHOICE=""
if [ -r /dev/tty ]; then
  read -r CHOICE < /dev/tty || true
else
  read -r CHOICE || true
fi
case "${CHOICE:-1}" in
  2)  install_claude ;;
  3)  install_codex; install_claude ;;
  *)  install_codex ;;   # 빈 입력/그 외 → 기본 Codex
esac

echo ""
echo "============================================"
echo "  설치 완료 ✅"
echo "============================================"
echo "  실행(로그):       ./start-logs.command"; echo "  실행(백그라운드): ./start-background.command"
echo "  웹:     http://localhost:3020"
echo "  Python: .venv (런처가 자동으로 PATH에 추가)"
echo ""
