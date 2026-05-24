import { describe, expect, it } from "vitest";
import { parseResumeCommand, ResumeCommandParseError } from "../resumeCommand";
import fixtureList from "./fixtures/resume-commands.json";

// ──────────────────────────────────────────────
// Fixture round-trip: agentic→code 동치성 검증
// All 13 SKILL.md resume commands must parse correctly.
// ──────────────────────────────────────────────

describe("parseResumeCommand — fixture round-trip (SKILL.md:43-63)", () => {
  for (const fixture of fixtureList) {
    it(`[${fixture.id}] ${fixture.description}`, () => {
      const result = parseResumeCommand(fixture.input);
      expect(result).toEqual(fixture.expected);
    });
  }
});

// ──────────────────────────────────────────────
// Additional cases
// ──────────────────────────────────────────────

describe("parseResumeCommand — create command", () => {
  it("작업해줘 메타정보 → create", () => {
    const result = parseResumeCommand("작업해줘 학교: 소명여고 과목: 수1");
    expect(result).toEqual({ type: "create" });
  });

  it("structured create → create", () => {
    const result = parseResumeCommand({ type: "create" });
    expect(result).toEqual({ type: "create" });
  });
});

describe("parseResumeCommand — auto resume (bare)", () => {
  it("resume bare → auto resume", () => {
    const result = parseResumeCommand("resume");
    expect(result).toEqual({ type: "resume" });
  });
});

describe("parseResumeCommand — structured object input", () => {
  it("structured resume with questions + fromStage", () => {
    const result = parseResumeCommand({ type: "resume", questions: [3, 7], fromStage: "solver" });
    expect(result).toEqual({ type: "resume", questions: [3, 7], fromStage: "solver" });
  });

  it("structured resume with fromStage only", () => {
    const result = parseResumeCommand({ type: "resume", fromStage: "builder" });
    expect(result).toEqual({ type: "resume", fromStage: "builder" });
  });
});

describe("parseResumeCommand — error cases", () => {
  it("unknown stage throws ResumeCommandParseError", () => {
    expect(() => parseResumeCommand("resume --from=unknown_stage")).toThrow(
      ResumeCommandParseError
    );
  });

  it("invalid question number throws ResumeCommandParseError", () => {
    expect(() => parseResumeCommand("resume --q=0 --from=solver")).toThrow(
      ResumeCommandParseError
    );
  });

  it("structured invalid type throws ResumeCommandParseError", () => {
    expect(() => parseResumeCommand({ type: "invalid" })).toThrow(
      ResumeCommandParseError
    );
  });
});
