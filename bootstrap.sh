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
  # 설치 중 pnpm 이 자동 수정한 추적 파일(pnpm-workspace.yaml 등)을 되돌려 ff pull 이 막히지 않게.
  # (.env 등 gitignore 파일은 영향 없음)
  git -C "$DEST" checkout -- . 2>/dev/null || true
  git -C "$DEST" pull --ff-only
else
  git clone https://github.com/PNKmath/exam-studio.git "$DEST"
fi

# 2. installer 위임
cd "$DEST" && bash ./install.sh
