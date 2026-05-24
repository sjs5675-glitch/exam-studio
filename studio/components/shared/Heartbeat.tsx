"use client";

import { useEffect } from "react";

const SSE_BASE = process.env.NEXT_PUBLIC_SSE_URL ?? "http://localhost:3021";
const INTERVAL = 10_000; // 10초

/**
 * SSE 서버에 주기적으로 heartbeat를 전송.
 * 탭이 백그라운드로 가면 setInterval이 throttle되므로
 * visibilitychange 이벤트로 보완하여 복귀 시 즉시 ping.
 */
export function Heartbeat() {
  useEffect(() => {
    const ping = () => {
      fetch(`${SSE_BASE}/api/heartbeat`).catch(() => {});
    };

    // 즉시 1회 + 이후 주기적
    ping();
    const id = setInterval(ping, INTERVAL);

    // 탭이 다시 활성화되면 즉시 heartbeat (백그라운드 throttle 보완)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        ping();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
