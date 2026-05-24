/**
 * builder.test.ts
 *
 * Phase 4 — builder stage 단위 테스트.
 *
 * Covers:
 *  1. camelCase info 키 (filenameBase 포함) 로 구성된 exam_data.json + figure_status.json
 *     을 받을 때 build 명령이 성공 경로를 타는지 확인.
 *  2. figure_status.json 없을 때도 build 성공 (그림 없는 시험지).
 *  3. commandRunner mock 을 통해 HWPX 경로 파싱/조립이 올바른지 확인.
 *  4. resolveBuilderScripts 가 올바른 경로를 반환하는지 확인.
 *  5. build_hwpx 커맨드 실패 시 failed 상태로 반환.
 */

import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBuilderStage,
  resolveBuilderScripts,
  type BuilderStageInput,
} from "../builder";
import { FileBackedStageCache } from "../cache";
import type { StageCommandResult } from "../commands";

// ─── helpers ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "builder-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeBaseDir(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  await mkdir(cacheDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

/** camelCase-only exam_data.json fixture (P2 assertCompleteMeta 준수) */
function makeExamDataJson(): object {
  return {
    info: {
      year: "2026",
      semester: "1학기",
      examType: "중간고사",
      school: "한빛고등학교",
      schoolLevel: "고",
      grade: "2",
      subject: "수학 I",
      subjectCode: "수1",
      region: "서울",
      code: "12345",
      range: "수열",
      filenameBase: "[12345][고][2026][2-1-a][서울][한빛고등학교][수1][수열][12345]",
    },
    problems: [
      {
        number: 1,
        type: "choice",
        score: 4,
        parts: [{ t: "다음 중 옳은 것은?" }],
        choices: [[{ t: "①" }], [{ t: "②" }], [{ t: "③" }], [{ t: "④" }], [{ t: "⑤" }]],
        answer: "①",
        explanation_parts: [{ t: "풀이" }],
        has_figure: false,
        subtopic: "수열",
        difficulty: "중",
      },
    ],
  };
}

/** figure_status.json fixture (camelCase finalImage — P3 결과) */
function makeFigureStatusJson(imagePath: string): object {
  return {
    questions: {
      "2": {
        questionNumber: 2,
        status: "completed",
        finalImage: imagePath,
        boundaryUncertain: false,
        cropAttempts: 1,
        needsAgentReview: false,
      },
    },
  };
}

/** StageCommandResult 형식의 성공 응답 헬퍼 */
function makeOkResult(command: string, args: string[], stdout: string): StageCommandResult {
  return {
    command,
    args,
    status: "success",
    exitCode: 0,
    stdout,
    stderr: "",
    signal: null,
    elapsedMs: 100,
  };
}

/** StageCommandResult 형식의 실패 응답 헬퍼 */
function makeErrorResult(command: string, args: string[], stderr: string): StageCommandResult {
  return {
    command,
    args,
    status: "non_zero_exit",
    exitCode: 1,
    stdout: "",
    stderr,
    signal: null,
    elapsedMs: 10,
  };
}

/**
 * 성공 케이스 commandRunner mock.
 * build_hwpx.py stdout에 "HWPX written: <path>" 형식으로 출력해 경로를 알려준다.
 */
function makeSuccessCommandRunner(hwpxOutputPath: string) {
  return vi.fn(async ({ command, args }: { command: string; args: string[]; cwd: string; timeoutMs: number }): Promise<StageCommandResult> => {
    const scriptName = args[0] ?? "";

    if (scriptName.endsWith("build_hwpx.py")) {
      // build_hwpx.py 성공 — HWPX 파일을 실제로 생성
      const { writeFile: wf } = await import("fs/promises");
      await wf(hwpxOutputPath, "MOCK_HWPX_CONTENT");
      return makeOkResult(command, args,
        `Building section0.xml...\nWriting HWPX to ${hwpxOutputPath}...\nHWPX written: ${hwpxOutputPath}\nTotal problems: 1 (choice: 1, essay: 0)\nExtra images: 0`
      );
    }

    if (scriptName.endsWith("fix_namespaces.py")) {
      return makeOkResult(command, args, "fix_namespaces: OK");
    }

    if (scriptName.endsWith("validate.py")) {
      return makeOkResult(command, args, "validate: OK");
    }

    // 알 수 없는 스크립트
    return makeErrorResult(command, args, `Unknown script: ${scriptName}`);
  });
}

// ─── 1. 정상 케이스: camelCase exam_data.json + figure_status.json ──────────

describe("runBuilderStage — camelCase exam_data.json + figure_status.json", () => {
  it("build 성공 — completed 상태와 hwpxPath 반환", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeBaseDir(baseDir);

    // exam_data.json 작성 (camelCase info)
    const examDataPath = cache.paths.examData;
    await writeFile(examDataPath, JSON.stringify(makeExamDataJson(), null, 2), "utf8");

    // 더미 이미지 파일 생성 (figure_status의 finalImage 경로용)
    const imgPath = path.join(cache.paths.cacheDir, "q02_cleaned.png");
    await writeFile(imgPath, "MOCK_PNG");

    // figure_status.json 작성 (camelCase finalImage)
    const figureStatusPath = cache.paths.figureStatus;
    await writeFile(figureStatusPath, JSON.stringify(makeFigureStatusJson(imgPath), null, 2), "utf8");

    const outputDir = path.join(baseDir, "outputs");
    const hwpxOutputPath = path.join(outputDir, "exam_output.hwpx");
    const commandRunner = makeSuccessCommandRunner(hwpxOutputPath);

    const input: BuilderStageInput = {
      baseDir,
      examDataPath,
      outputDir,
      cache,
      commandRunner,
    };

    const result = await runBuilderStage(input);

    expect(result.status).toBe("completed");
    expect(result.output?.hwpxPath).toBe(hwpxOutputPath);
    expect(result.output?.commands).toHaveLength(3); // build + fix + validate
    expect(result.output?.commands[0]?.name).toBe("build_hwpx");
    expect(result.output?.commands[0]?.status).toBe("success");
  });
});

// ─── 2. figure_status.json 없어도 build 성공 ────────────────────────────────

describe("runBuilderStage — figure_status.json 없는 경우", () => {
  it("figure_status.json 없어도 build 성공 (그림 없는 시험지)", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeBaseDir(baseDir);

    const examDataPath = cache.paths.examData;
    await writeFile(examDataPath, JSON.stringify(makeExamDataJson(), null, 2), "utf8");
    // figure_status.json 파일 미생성 (의도적 생략)

    const outputDir = path.join(baseDir, "outputs");
    const hwpxOutputPath = path.join(outputDir, "exam_output.hwpx");
    const commandRunner = makeSuccessCommandRunner(hwpxOutputPath);

    const input: BuilderStageInput = {
      baseDir,
      examDataPath,
      outputDir,
      cache,
      commandRunner,
    };

    const result = await runBuilderStage(input);
    expect(result.status).toBe("completed");
    // figure_status.json 없어도 3개 명령 모두 성공
    expect(result.output?.commands).toHaveLength(3);
  });
});

// ─── 3. exam_data.json 없을 때 → failed ─────────────────────────────────────

describe("runBuilderStage — exam_data.json 누락", () => {
  it("exam_data.json 없으면 failed 반환", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeBaseDir(baseDir);

    const nonExistentPath = path.join(cache.paths.cacheDir, "exam_data.json");
    // 파일을 생성하지 않음

    const commandRunner = vi.fn();

    const input: BuilderStageInput = {
      baseDir,
      examDataPath: nonExistentPath,
      outputDir: path.join(baseDir, "outputs"),
      cache,
      commandRunner,
    };

    const result = await runBuilderStage(input);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("builder_file_missing");
    // commandRunner는 호출되지 않아야 함
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

// ─── 4. build_hwpx.py 실패 시 → failed ───────────────────────────────────

describe("runBuilderStage — build_hwpx.py 명령 실패", () => {
  it("build_hwpx.py exit != 0 이면 failed 반환", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeBaseDir(baseDir);

    const examDataPath = cache.paths.examData;
    await writeFile(examDataPath, JSON.stringify(makeExamDataJson(), null, 2), "utf8");

    const commandRunner = vi.fn(async ({ command, args }: { command: string; args: string[]; cwd: string; timeoutMs: number }): Promise<StageCommandResult> =>
      makeErrorResult(command, args, "KeyError: 'filenameBase'")
    );

    const input: BuilderStageInput = {
      baseDir,
      examDataPath,
      outputDir: path.join(baseDir, "outputs"),
      cache,
      commandRunner,
    };

    const result = await runBuilderStage(input);
    expect(result.status).toBe("failed");
    // error.message에 KeyError 포함 여부는 optional이지만 code는 설정돼야 함
    expect(result.error?.code).toBeTruthy();
  });
});

// ─── 5. resolveBuilderScripts ─────────────────────────────────────────────

describe("resolveBuilderScripts", () => {
  it("baseDir 기준 상대 경로로 스크립트 3개 반환", () => {
    const baseDir = "/some/base";
    const scripts = resolveBuilderScripts(baseDir);

    expect(scripts.buildHwpx).toBe(path.join(baseDir, "build_hwpx.py"));
    expect(scripts.fixNamespaces).toBe(
      path.join(baseDir, "resources", "hwpx_scripts", "fix_namespaces.py")
    );
    expect(scripts.validateHwpx).toBe(
      path.join(baseDir, "resources", "hwpx_scripts", "validate.py")
    );
  });
});
