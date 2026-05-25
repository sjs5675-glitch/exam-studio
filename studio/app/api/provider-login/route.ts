import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

// 허용된 provider만 처리 — 임의 명령 주입 방지
type AllowedProvider = "codex" | "claude";
const LOGIN_CMDS: Record<AllowedProvider, string> = {
  codex: "codex login",
  claude: "claude",
};

export async function POST(req: NextRequest) {
  let provider: string;
  try {
    const body = await req.json();
    provider = body.provider;
  } catch {
    return NextResponse.json({ launched: false, error: "invalid body" }, { status: 400 });
  }

  if (provider !== "codex" && provider !== "claude") {
    return NextResponse.json(
      { launched: false, error: "unknown provider" },
      { status: 400 }
    );
  }

  const loginCmd = LOGIN_CMDS[provider];

  try {
    if (process.platform === "win32") {
      // Windows: 새 콘솔 창에서 loginCmd 실행
      spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", loginCmd], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      // macOS: Terminal.app에 loginCmd 전달
      spawn(
        "osascript",
        ["-e", `tell application "Terminal" to do script "${loginCmd}"`],
        { detached: true, stdio: "ignore" }
      ).unref();
    }
    return NextResponse.json({ launched: true });
  } catch (err) {
    return NextResponse.json(
      { launched: false, error: String(err) },
      { status: 500 }
    );
  }
}
