import { mkdtemp, readFile, rm, writeFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExamDataJson } from "../examData";
import { FileBackedStageCache } from "../cache";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "exam-data-test-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a FileBackedStageCache pointing at a fresh temp examDir
 * and ensure its .v3cache directory exists.
 */
async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  await mkdir(cacheDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

// ──────────────────────────────────────────────
// Realistic per-question cache fixtures.
// Mirrors actual disjoint schemas:
//   extracted: problem definition (type/score/parts/choices/...)
//   solved   : { number, answer, explanation_parts }
//   verified : { number, status, issues, feedback }  — gating only
// ──────────────────────────────────────────────

function makeExtracted(n: number): Record<string, unknown> {
  return {
    number: n,
    type: "choice",
    score: "3.8",
    difficulty: "하",
    subtopic: "정적분",
    has_figure: false,
    figure_info: null,
    parts: [{ t: `Q${n} 본문` }, { eq: "x^2" }],
    choices: [
      [{ t: "① " }, { eq: "1" }],
      [{ t: "② " }, { eq: "2" }],
    ],
    condition_box: null,
    bogi_box: null,
    data_table: null,
    explanation_table: null,
  };
}

function makeSolved(n: number, answer = "⑤"): Record<string, unknown> {
  return {
    number: n,
    answer,
    explanation_parts: [
      { t: `Q${n} 풀이` },
      { eq: "x^2 + 1" },
      { br: true },
      { t: "따라서 정답." },
    ],
  };
}

function makeVerified(n: number, status: "pass" | "fail" = "pass"): Record<string, unknown> {
  return {
    number: n,
    status,
    issues: [],
    feedback: null,
  };
}

/** Minimal complete meta for testing assertCompleteMeta */
const COMPLETE_META = {
  schoolLevel: "고" as const,
  school: "테스트고",
  grade: 2,
  year: 2025,
  subject: "수학 I",
  semester: "1학기",
  examType: "중간",
  range: "집합",
};

describe("buildExamDataJson — merge contract (A안: verifier = gating only)", () => {
  it("merges extracted (problem definition) + solved (answer/explanation) into one problem object", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [1],
    });

    const p = result.problems[0] as Record<string, unknown>;
    // Extractor-side fields survive
    expect(p.type).toBe("choice");
    expect(p.score).toBe("3.8");
    expect(p.parts).toEqual([{ t: "Q1 본문" }, { eq: "x^2" }]);
    expect(p.choices).toBeDefined();
    expect(p.has_figure).toBe(false);
    // Solver-side fields are layered on top
    expect(p.answer).toBe("⑤");
    expect(p.explanation_parts).toBeDefined();
    expect(Array.isArray(p.explanation_parts)).toBe(true);
  });

  it("solved fields override extracted on key conflict (number stays consistent)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Both files carry `number` — solved-side should win since merge is { ...extracted, ...solved }
    await writeFile(cache.extractorResultPath(2), JSON.stringify(makeExtracted(2)), "utf8");
    await writeFile(cache.solverResultPath(2), JSON.stringify(makeSolved(2, "③")), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [2],
    });
    const p = result.problems[0] as Record<string, unknown>;
    expect(p.number).toBe(2);
    expect(p.answer).toBe("③");
  });

  it("does NOT merge _verified.json into the problem body (verifier = gating ledger only)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(3), JSON.stringify(makeExtracted(3)), "utf8");
    await writeFile(cache.solverResultPath(3), JSON.stringify(makeSolved(3)), "utf8");
    // _verified carries gating fields that must NEVER appear on the problem
    await writeFile(cache.verifierResultPath(3), JSON.stringify(makeVerified(3, "pass")), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [3],
    });
    const p = result.problems[0] as Record<string, unknown>;

    // problem fields preserved
    expect(p.type).toBe("choice");
    expect(p.answer).toBe("⑤");
    // verifier-side fields must NOT leak into the problem body
    expect(p.status).toBeUndefined();
    expect(p.issues).toBeUndefined();
    expect(p.feedback).toBeUndefined();
  });

  it("throws when extracted is missing (problem definition unavailable)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Only solved — no extracted file at all
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    await expect(
      buildExamDataJson({
        cache,
        meta: COMPLETE_META,
        questionNumbers: [1],
      })
    ).rejects.toThrow(/Q1/);
  });

  it("throws when solved is missing (answer/explanation unavailable)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Only extracted — no solver result
    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");

    await expect(
      buildExamDataJson({
        cache,
        meta: COMPLETE_META,
        questionNumbers: [1],
      })
    ).rejects.toThrow(/Q1/);
  });

  it("throws for a question with no cache files at all", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");
    // Q4 entirely missing

    await expect(
      buildExamDataJson({
        cache,
        meta: COMPLETE_META,
        questionNumbers: [1, 4],
      })
    ).rejects.toThrow(/Q4/);
  });

  it("count match: problems.length === questionNumbers.length on full success", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    for (const n of [1, 2, 3]) {
      await writeFile(cache.extractorResultPath(n), JSON.stringify(makeExtracted(n)), "utf8");
      await writeFile(cache.solverResultPath(n), JSON.stringify(makeSolved(n)), "utf8");
    }

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [1, 2, 3],
    });

    expect(result.problems).toHaveLength(3);
    const written = JSON.parse(await readFile(cache.paths.examData, "utf8")) as { problems: unknown[] };
    expect(written.problems).toHaveLength(3);
  });

  it("regression guard: assembled problem carries every field build_hwpx.py reads", async () => {
    // assemble.py:300-310 reads: type, score, parts, choices, answer, explanation_parts, has_figure, figure_info.
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [1],
    });
    const p = result.problems[0] as Record<string, unknown>;

    for (const key of ["type", "score", "parts", "choices", "answer", "explanation_parts", "has_figure"]) {
      expect(p[key], `field ${key} must survive into merged problem`).not.toBeUndefined();
    }
  });
});

// ──────────────────────────────────────────────
// buildExamDataJson — assertCompleteMeta + camelCase only
// ──────────────────────────────────────────────

describe("buildExamDataJson — assertCompleteMeta + camelCase only info", () => {
  it("throws when meta is incomplete (missing required fields)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    // schoolLevel/grade/subject/semester/examType/range all missing
    await expect(
      buildExamDataJson({
        cache,
        meta: { school: "학교", year: 2025 },
        questionNumbers: [1],
      })
    ).rejects.toThrow(/meta missing required fields/);
  });

  it("info is camelCase only — snake_case keys must not be present", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [1],
    });

    // camelCase keys present
    expect(result.info.schoolLevel).toBe("고");
    expect(result.info.examType).toBe("중간");
    expect(result.info.filenameBase).toBeDefined();

    // snake_case keys MUST NOT exist on info
    const info = result.info as unknown as Record<string, unknown>;
    expect(info.school_level).toBeUndefined();
    expect(info.exam_type).toBeUndefined();
    expect(info.filename_base).toBeUndefined();
  });

  it("disk exam_data.json info is also camelCase only (no snake_case keys)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    await buildExamDataJson({
      cache,
      meta: COMPLETE_META,
      questionNumbers: [1],
    });

    const written = JSON.parse(await readFile(cache.paths.examData, "utf8")) as { info: Record<string, unknown> };
    expect(written.info.schoolLevel).toBe("고");
    expect(written.info.examType).toBe("중간");
    expect(written.info.school_level).toBeUndefined();
    expect(written.info.exam_type).toBeUndefined();
    expect(written.info.filename_base).toBeUndefined();
  });

  it("filenameBase is auto-filled by buildFilenameBase when not supplied", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const metaWithoutFilenameBase = { ...COMPLETE_META };
    const result = await buildExamDataJson({
      cache,
      meta: metaWithoutFilenameBase,
      questionNumbers: [1],
    });

    expect(result.info.filenameBase).toBeDefined();
    expect(typeof result.info.filenameBase).toBe("string");
    expect(result.info.filenameBase!.length).toBeGreaterThan(0);
  });

  it("filenameBase supplied in meta is preserved as-is", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const customBase = "[CUSTOM][고][2025][2-1-a][서울][테스트고][수학 I][집합][]";
    const result = await buildExamDataJson({
      cache,
      meta: { ...COMPLETE_META, filenameBase: customBase },
      questionNumbers: [1],
    });

    expect(result.info.filenameBase).toBe(customBase);
  });

  it("schoolLevel='중' is preserved in camelCase info", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    await writeFile(cache.extractorResultPath(1), JSON.stringify(makeExtracted(1)), "utf8");
    await writeFile(cache.solverResultPath(1), JSON.stringify(makeSolved(1)), "utf8");

    const result = await buildExamDataJson({
      cache,
      meta: { ...COMPLETE_META, schoolLevel: "중" as const, school: "테스트중학교" },
      questionNumbers: [1],
    });

    expect(result.info.schoolLevel).toBe("중");
    expect(result.info.filenameBase).toContain("[중]");
    const info = result.info as unknown as Record<string, unknown>;
    expect(info.school_level).toBeUndefined();
  });
});
