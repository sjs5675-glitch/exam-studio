import { describe, it, expect } from "vitest";
import { buildExtractorPrompt } from "../prompts/extractorPrompt";
import { buildSolverPrompt } from "../prompts/solverPrompt";
import { buildVerifierPrompt } from "../prompts/verifierPrompt";

describe("buildExtractorPrompt", () => {
  it("returns non-empty system and user strings", () => {
    const result = buildExtractorPrompt({ questionNumber: 1 });
    expect(typeof result.system).toBe("string");
    expect(result.system.trim().length).toBeGreaterThan(0);
    expect(typeof result.user).toBe("string");
    expect(result.user.trim().length).toBeGreaterThan(0);
  });

  it("includes question number in user message", () => {
    const result = buildExtractorPrompt({ questionNumber: 5 });
    expect(result.user).toContain("5번");
  });

  it("includes imagePathHint when provided", () => {
    const result = buildExtractorPrompt({
      questionNumber: 2,
      imagePathHint: "/some/path/q2.png",
    });
    expect(result.user).toContain("/some/path/q2.png");
  });

  it("includes examMeta fields when provided", () => {
    const result = buildExtractorPrompt({
      questionNumber: 3,
      examMeta: {
        school: "강북고",
        year: 2025,
        grade: 2,
        subject: "수학 I",
        semester: "1학기",
        examType: "중간",
        range: "지수-삼각함수",
      },
    });
    expect(result.user).toContain("강북고");
    expect(result.user).toContain("연도: 2025");
    expect(result.user).toContain("수학 I");
  });

  it("omits examMeta section when not provided", () => {
    const result = buildExtractorPrompt({ questionNumber: 1 });
    expect(result.user).not.toContain("시험 정보:");
  });
});

describe("buildSolverPrompt", () => {
  const sampleExtracted = { number: 1, type: "choice", score: "4.2" };

  it("returns non-empty system and user strings", () => {
    const result = buildSolverPrompt({ extracted: sampleExtracted });
    expect(typeof result.system).toBe("string");
    expect(result.system.trim().length).toBeGreaterThan(0);
    expect(typeof result.user).toBe("string");
    expect(result.user.trim().length).toBeGreaterThan(0);
  });

  it("serializes extracted JSON into user message", () => {
    const result = buildSolverPrompt({ extracted: sampleExtracted });
    expect(result.user).toContain('"number": 1');
  });

  it("includes guidelineContext when provided", () => {
    const result = buildSolverPrompt({
      extracted: sampleExtracted,
      guidelineContext: "이 문제는 수학 I 과목입니다.",
    });
    expect(result.user).toContain("이 문제는 수학 I 과목입니다.");
  });

  it("includes feedback section when provided", () => {
    const result = buildSolverPrompt({
      extracted: sampleExtracted,
      feedback: "3번째 등호 전환 오류",
    });
    expect(result.user).toContain("3번째 등호 전환 오류");
  });

  it("omits feedback section when not provided", () => {
    const result = buildSolverPrompt({ extracted: sampleExtracted });
    expect(result.user).not.toContain("verifier feedback");
  });
});


describe("buildVerifierPrompt", () => {
  const sampleExtracted = { number: 1, type: "choice" };
  const sampleSolved = { number: 1, answer: "②", explanation_parts: [] };

  it("returns non-empty system and user strings", () => {
    const result = buildVerifierPrompt({ extracted: sampleExtracted, solved: sampleSolved });
    expect(typeof result.system).toBe("string");
    expect(result.system.trim().length).toBeGreaterThan(0);
    expect(typeof result.user).toBe("string");
    expect(result.user.trim().length).toBeGreaterThan(0);
  });

  it("includes both extracted and solved JSON in user message", () => {
    const result = buildVerifierPrompt({ extracted: sampleExtracted, solved: sampleSolved });
    expect(result.user).toContain("추출된 문제 JSON");
    expect(result.user).toContain("solver 해설 JSON");
  });

  it("includes guidelineContext when provided", () => {
    const result = buildVerifierPrompt({
      extracted: sampleExtracted,
      solved: sampleSolved,
      guidelineContext: "이 문제는 수학 II 범위입니다.",
    });
    expect(result.user).toContain("이 문제는 수학 II 범위입니다.");
  });

  it("omits guidelineContext section when not provided", () => {
    const result = buildVerifierPrompt({ extracted: sampleExtracted, solved: sampleSolved });
    expect(result.user).not.toContain("교과 컨텍스트:");
  });
});

describe("schoolLevel branching", () => {
  const sampleExtracted = { number: 1, type: "choice" };
  const sampleSolved = { number: 1, answer: "①", explanation_parts: [] };

  it("(a) extractor schoolLevel='중' — system contains unit_classification_middle.json and not unit_classification.json", () => {
    const result = buildExtractorPrompt({
      questionNumber: 1,
      examMeta: { schoolLevel: "중" },
    });
    expect(result.system).toContain("unit_classification_middle.json");
    expect(result.system).not.toContain("unit_classification.json");
  });

  it("(b) extractor schoolLevel='고' / 미지정 — system contains unit_classification.json and not middle", () => {
    const resultHigh = buildExtractorPrompt({
      questionNumber: 1,
      examMeta: { schoolLevel: "고" },
    });
    expect(resultHigh.system).toContain("unit_classification.json");
    expect(resultHigh.system).not.toContain("unit_classification_middle.json");

    const resultDefault = buildExtractorPrompt({ questionNumber: 1 });
    expect(resultDefault.system).toContain("unit_classification.json");
    expect(resultDefault.system).not.toContain("unit_classification_middle.json");
  });

  it("(c) solver schoolLevel='중' — system contains 중학교 수준 안내", () => {
    const result = buildSolverPrompt({
      extracted: sampleExtracted,
      examMeta: { schoolLevel: "중" },
    });
    expect(result.system).toContain("중학교");
  });

  it("(d) verifier schoolLevel='중' — system contains 중학교 검증 안내", () => {
    const result = buildVerifierPrompt({
      extracted: sampleExtracted,
      solved: sampleSolved,
      examMeta: { schoolLevel: "중" },
    });
    expect(result.system).toContain("중학교");
  });
});
