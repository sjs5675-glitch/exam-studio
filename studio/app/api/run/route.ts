/**
 * Fallback route — CLI 실행은 별도 SSE 서버(server/sse.ts)에서 처리.
 * 클라이언트는 NEXT_PUBLIC_SSE_URL로 직접 연결하므로
 * 이 route는 잘못된 요청이 올 때만 안내 메시지를 반환한다.
 */
export async function POST() {
  return new Response(
    JSON.stringify({
      error: "이 엔드포인트는 비활성화되었습니다. SSE 서버(port 3021)가 실행 중인지 확인하세요.",
    }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}
