import { NextResponse } from "next/server";
import crossSpawn from "cross-spawn";
import { existsSync } from "fs";
import path from "path";
import { getDataRoot } from "@/lib/server/paths";

/**
 * 업데이트 후 서버(Next 3020 + sse 3021)를 재시작한다.
 *
 * 파이프라인은 `tsx server/sse.ts` 프로세스에서 도는데 hot-reload 가 없어,
 * 재시작 없이는 git reset 으로 받은 새 코드(프롬프트·전송 등)가 적용되지 않는다.
 * 기존 런처(start-background.*)가 이미 "포트 kill 후 재기동" 을 하므로, 응답이
 * 나간 뒤 잠시 대기했다가 런처를 detached 로 재실행한다(EXAM_STUDIO_NO_OPEN=1 로
 * 브라우저 재오픈은 생략 — 프론트가 같은 탭을 새로고침한다).
 *
 * 반환값: 재시작 트리거 성공 여부(런처 부재 등으로 실패하면 false → 수동 재시작 안내).
 */
function scheduleServerRestart(root: string): boolean {
  const isWin = process.platform === "win32";
  const launcher = path.join(root, isWin ? "start-background.vbs" : "start-background.command");
  if (!existsSync(launcher)) return false;
  const env = { ...process.env, EXAM_STUDIO_NO_OPEN: "1" };
  try {
    if (isWin) {
      crossSpawn("cmd", ["/c", `timeout /t 2 /nobreak >nul & wscript "${launcher}"`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env,
      }).unref();
    } else {
      crossSpawn("bash", ["-c", `sleep 2; exec bash ${JSON.stringify(launcher)}`], {
        detached: true,
        stdio: "ignore",
        env,
      }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command (cross-platform via cross-spawn so `pnpm` resolves to
 * `pnpm.cmd` on Windows) and capture its output. Never rejects — failures are
 * reported through `code`/`stderr` so callers can branch without try/catch.
 */
function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = crossSpawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);
    const finish = (res: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) =>
      finish({ code: -1, stdout: stdout.trim(), stderr: (stderr + "\n" + String(e)).trim() })
    );
    child.on("close", (code) =>
      finish({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() })
    );
  });
}

interface CommitInfo {
  hash: string;
  date: string;
  subject: string;
}

function parseCommits(raw: string): CommitInfo[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split("|");
      return { hash, date, subject: rest.join("|") };
    });
}

async function currentBranch(root: string): Promise<string | null> {
  const r = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root, 10000);
  if (r.code !== 0 || !r.stdout) return null;
  return r.stdout;
}

/**
 * GET /api/update — 업데이트 가능 여부 확인.
 * git 저장소가 아니면 error, 네트워크 실패 시 offline:true 로 응답한다.
 */
export async function GET() {
  const root = getDataRoot();

  const branch = await currentBranch(root);
  if (!branch) {
    return NextResponse.json(
      { ok: false, error: "git 저장소를 찾을 수 없습니다." },
      { status: 200 }
    );
  }

  const cur = await run("git", ["log", "-1", "--format=%h|%cI|%s"], root, 10000);
  const current = parseCommits(cur.stdout)[0] ?? null;

  const fetched = await run("git", ["fetch", "origin", branch], root, 60000);
  if (fetched.code !== 0) {
    // 네트워크 단절 등 — 현재 버전은 알려주되 확인 실패로 표시
    return NextResponse.json({
      ok: true,
      offline: true,
      branch,
      current,
      updateAvailable: false,
      behind: 0,
      commits: [],
    });
  }

  const range = `HEAD..origin/${branch}`;
  const behindR = await run("git", ["rev-list", "--count", range], root, 10000);
  const behind = parseInt(behindR.stdout, 10) || 0;

  const logR = await run(
    "git",
    ["log", "--format=%h|%cI|%s", "-n", "20", range],
    root,
    10000
  );

  return NextResponse.json({
    ok: true,
    offline: false,
    branch,
    current,
    updateAvailable: behind > 0,
    behind,
    commits: parseCommits(logR.stdout),
  });
}

/**
 * POST /api/update — 최신 코드로 업데이트.
 * 안전을 위해 merge 대신 `git reset --hard origin/<branch>` 사용
 * (사용자 데이터(outputs/inputs/.env/jobs)는 gitignore 되어 영향 없음).
 * 이후 의존성 변경 대비 `pnpm install` 실행.
 */
export async function POST() {
  const root = getDataRoot();
  // Next 앱 디렉터리(= 서버 실행 cwd) 에서 pnpm install 실행
  const appDir = process.cwd();

  const branch = await currentBranch(root);
  if (!branch) {
    return NextResponse.json(
      { ok: false, error: "git 저장소를 찾을 수 없습니다." },
      { status: 200 }
    );
  }

  const fetched = await run("git", ["fetch", "origin", branch], root, 60000);
  if (fetched.code !== 0) {
    return NextResponse.json({
      ok: false,
      step: "fetch",
      error: "원격 저장소에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.",
      detail: fetched.stderr,
    });
  }

  const reset = await run(
    "git",
    ["reset", "--hard", `origin/${branch}`],
    root,
    30000
  );
  if (reset.code !== 0) {
    return NextResponse.json({
      ok: false,
      step: "reset",
      error: "코드 업데이트(git reset)에 실패했습니다.",
      detail: reset.stderr,
    });
  }

  const install = await run("pnpm", ["install"], appDir, 300000);
  if (install.code !== 0) {
    return NextResponse.json({
      ok: false,
      step: "install",
      error:
        "코드는 업데이트됐지만 라이브러리 설치에 실패했습니다. 프로그램을 다시 실행해 보고, 계속 실패하면 관리자에게 문의하세요.",
      detail: install.stderr,
    });
  }

  const cur = await run("git", ["log", "-1", "--format=%h|%cI|%s"], root, 10000);

  // 새 코드가 실제로 적용되려면 서버 재시작이 필수(tsx sse 는 hot-reload 없음).
  const restarting = scheduleServerRestart(root);

  return NextResponse.json({
    ok: true,
    restartRequired: true,
    restarting,
    current: parseCommits(cur.stdout)[0] ?? null,
  });
}
