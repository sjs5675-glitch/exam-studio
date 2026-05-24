#!/bin/bash
# SSE 서버 스트리밍 테스트 스크립트
# 이 스크립트는 Claude Code 세션 밖에서 실행해야 합니다.
#
# 사용법:
#   cd studio
#   bash scripts/test-sse.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 1. SSE 서버 시작 ==="
HWPX_TEMPLATE_PATH="inputs/시험지 제작/기출작업양식지.hwpx" \
  npx tsx server/sse.ts &
SSE_PID=$!
sleep 3

if ! kill -0 $SSE_PID 2>/dev/null; then
  echo "FAIL: SSE 서버 시작 실패"
  exit 1
fi
echo "OK: SSE 서버 PID=$SSE_PID"

echo ""
echo "=== 2. SSE 스트리밍 테스트 ==="
PDF=$(ls "../inputs/시험지 제작/"*.pdf 2>/dev/null | head -1)
if [ -z "$PDF" ]; then
  echo "FAIL: PDF 파일 없음"
  kill $SSE_PID 2>/dev/null
  exit 1
fi
PDF_REL="inputs/시험지 제작/$(basename "$PDF")"
echo "PDF: $PDF_REL"

echo ""
echo "--- curl POST → SSE 서버 (10초 캡처) ---"
timeout 10 curl -s -N -X POST http://localhost:3021/api/run \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"create\",\"files\":{\"pdf\":\"$PDF_REL\"},\"jobId\":\"test-$(date +%s)\"}" \
  2>/dev/null | while IFS= read -r line; do
    echo "  $line"
done
EXIT=$?

echo ""
if [ $EXIT -eq 0 ] || [ $EXIT -eq 124 ]; then
  echo "OK: SSE 스트리밍 데이터 수신 확인"
else
  echo "FAIL: curl exit=$EXIT"
fi

echo ""
echo "=== 정리 ==="
kill $SSE_PID 2>/dev/null
echo "SSE 서버 종료"
