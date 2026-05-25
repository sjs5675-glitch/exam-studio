#!/usr/bin/env bash
set -euo pipefail

# 0. git 확인 — 없으면 Xcode CLT 유도
if ! command -v git >/dev/null 2>&1; then
  echo "git 설치가 필요합니다. 설치 창이 뜨면 '설치'를 누르세요."
  xcode-select --install || true
  echo "설치 완료 후 이 명령을 다시 실행하세요."; exit 1
fi

# 1. clone or pull
DEST="$HOME/exam-studio"
if [ -d "$DEST/.git" ]; then
  # 항상 GitHub 최신 main 으로 강제 동기화한다.
  # pull --ff-only 는 로컬 커밋/분기·force-push 시 막혀 stale 코드로 설치가 진행될 수 있어,
  # fetch + reset --hard 로 추적 파일·로컬 커밋을 모두 origin/main 에 맞춘다.
  # (.env/.venv/node_modules 등 gitignore untracked 파일은 reset --hard 가 건드리지 않음 → 보존)
  git -C "$DEST" fetch origin
  git -C "$DEST" reset --hard origin/main
else
  git clone https://github.com/PNKmath/exam-studio.git "$DEST"
fi

# 2. installer 위임
cd "$DEST" && bash ./install.sh
