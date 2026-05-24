/**
 * checker.test.ts
 *
 * Phase 5 — checker deterministic rules + auto-fix unit tests.
 *
 * Covers:
 *  1. `runDeterministicCheckerRules` — each of the 7 rule IDs fires correctly.
 *  2. `fixRunOnEquationsInXml` — run-on equation XML fix.
 *  3. `runCheckerWithAutoFix` — wrapper: clean XML passes immediately;
 *     run-on XML triggers fix and passes on second run; unfixable errors
 *     are returned as-is.
 *  4. NEW: endNote.structure rule (D6).
 *  5. NEW: section.style_format rule (D8).
 *  6. NEW: text.vocabulary rule (D9).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  runDeterministicCheckerRules,
  fixRunOnEquationsInXml,
  runCheckerWithAutoFix,
  checkTextVocabulary,
  _resetUnitClassificationCache,
  _injectUnitClassification,
  _resetUnitClassificationMiddleCache,
  _injectUnitClassificationMiddle,
  type UnitClassification,
} from "../checker";

// ─────────────────────────────────────────────────────────────────────────────
// XML helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap a bare hp:script content in a minimal valid equation block. */
function makeEquationXml(script: string, equationAttrs = ""): string {
  return `<hp:equation${equationAttrs ? " " + equationAttrs : ""}><hp:script>${script}</hp:script></hp:equation>`;
}

/** Wrap equation blocks in a minimal section XML shell. */
function wrapSection(inner: string): string {
  return `<hsp:secPr><hp:p>${inner}</hp:p></hsp:secPr>`;
}

/** Build minimal section XML with a text node. */
function makeTextXml(text: string): string {
  return wrapSection(`<hp:t>${text}</hp:t>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Deterministic rule: xml.well_formed
// ─────────────────────────────────────────────────────────────────────────────

describe("checkXmlWellFormed (xml.well_formed)", () => {
  it("clean XML produces no issues", () => {
    const xml = "<root><child>text</child></root>";
    const issues = runDeterministicCheckerRules(xml);
    const wellFormed = issues.filter((i) => i.ruleId === "xml.well_formed");
    expect(wellFormed).toHaveLength(0);
  });

  it("mismatched closing tag produces error", () => {
    const xml = "<root><child>text</wrong></root>";
    const issues = runDeterministicCheckerRules(xml);
    const wellFormed = issues.filter((i) => i.ruleId === "xml.well_formed");
    expect(wellFormed).toHaveLength(1);
    expect(wellFormed[0]?.severity).toBe("error");
  });

  it("unclosed tag produces error", () => {
    const xml = "<root><child>text</root>";
    const issues = runDeterministicCheckerRules(xml);
    const wellFormed = issues.filter((i) => i.ruleId === "xml.well_formed");
    expect(wellFormed).toHaveLength(1);
    expect(wellFormed[0]?.severity).toBe("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Deterministic rule: xml.raw_escape
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRawEscapes (xml.raw_escape)", () => {
  it("clean script produces no issues", () => {
    const xml = makeEquationXml("f(x) = x^2");
    const issues = runDeterministicCheckerRules(xml);
    expect(issues.filter((i) => i.ruleId === "xml.raw_escape")).toHaveLength(0);
  });

  it("unescaped < inside hp:script produces error", () => {
    const xml = `<hp:equation><hp:script>a < b</hp:script></hp:equation>`;
    const issues = runDeterministicCheckerRules(xml);
    expect(issues.filter((i) => i.ruleId === "xml.raw_escape").length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Deterministic rule: text.difficulty_vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe("checkDifficultyVocabulary (text.difficulty_vocabulary)", () => {
  it("valid difficulty values pass", () => {
    for (const val of ["하", "중", "상", "킬"]) {
      const xml = makeTextXml(`[난이도] ${val}`);
      const issues = runDeterministicCheckerRules(xml);
      expect(issues.filter((i) => i.ruleId === "text.difficulty_vocabulary")).toHaveLength(0);
    }
  });

  it("invalid difficulty value produces error", () => {
    const xml = makeTextXml("[난이도] 극상");
    const issues = runDeterministicCheckerRules(xml);
    const diff = issues.filter((i) => i.ruleId === "text.difficulty_vocabulary");
    expect(diff).toHaveLength(1);
    expect(diff[0]?.severity).toBe("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Deterministic rule: equation.run_on
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRunOnEquations (equation.run_on)", () => {
  it("single = in equation passes", () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));
    const issues = runDeterministicCheckerRules(xml);
    expect(issues.filter((i) => i.ruleId === "equation.run_on")).toHaveLength(0);
  });

  it("two = in equation triggers warning", () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2 = y"));
    const issues = runDeterministicCheckerRules(xml);
    const runOn = issues.filter((i) => i.ruleId === "equation.run_on");
    expect(runOn).toHaveLength(1);
    expect(runOn[0]?.severity).toBe("warning");
    expect(runOn[0]?.fallbackRequired).toBe(true);
  });

  it("three = in equation triggers warning", () => {
    const xml = wrapSection(makeEquationXml("a = b = c = d"));
    const issues = runDeterministicCheckerRules(xml);
    expect(issues.filter((i) => i.ruleId === "equation.run_on")).toHaveLength(1);
  });

  it("= inside equation string is counted (detect is conservative)", () => {
    // The detect rule counts all = signs in the script (including internal ones).
    // "k = LEFT(a=1 RIGHT)" has 2 = signs → triggers warning.
    // The split fix is smarter and knows LEFT() is depth-guarded.
    const xml = wrapSection(makeEquationXml("k = LEFT(a=1 RIGHT)"));
    const issues = runDeterministicCheckerRules(xml);
    // 2 = signs → warning triggered (conservative detection)
    expect(issues.filter((i) => i.ruleId === "equation.run_on")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. fixRunOnEquationsInXml
// ─────────────────────────────────────────────────────────────────────────────

describe("fixRunOnEquationsInXml", () => {
  it("no-op for equation with single =", () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));
    expect(fixRunOnEquationsInXml(xml)).toBe(xml);
  });

  it("splits equation with two = into two sibling equations", () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2 = y"));
    const fixed = fixRunOnEquationsInXml(xml);

    // Should have two <hp:equation> blocks now
    const equationMatches = [...fixed.matchAll(/<hp:equation\b[^>]*>/g)];
    expect(equationMatches).toHaveLength(2);

    // Should have a glue text node between them
    expect(fixed).toContain("<hp:t> </hp:t>");

    // First block contains "f(x) = x^2"
    const firstScript = fixed.match(/<hp:script>([\s\S]*?)<\/hp:script>/)?.[1] ?? "";
    expect(firstScript.trim()).toBe("f(x) = x^2");

    // Second block contains "= y"
    const scripts = [...fixed.matchAll(/<hp:script>([\s\S]*?)<\/hp:script>/g)].map((m) => m[1].trim());
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toBe("= y");
  });

  it("splits equation with three = into three sibling equations", () => {
    const xml = wrapSection(makeEquationXml("a = b = c = d"));
    const fixed = fixRunOnEquationsInXml(xml);

    const scripts = [...fixed.matchAll(/<hp:script>([\s\S]*?)<\/hp:script>/g)].map((m) => m[1].trim());
    expect(scripts).toHaveLength(3);
    expect(scripts[0]).toBe("a = b");
    expect(scripts[1]).toBe("= c");
    expect(scripts[2]).toBe("= d");
  });

  it("is idempotent: applying fix twice yields same result", () => {
    const xml = wrapSection(makeEquationXml("a = b = c"));
    const fixed = fixRunOnEquationsInXml(xml);
    const fixedTwice = fixRunOnEquationsInXml(fixed);
    expect(fixedTwice).toBe(fixed);
  });

  it("preserves equation attributes on all split blocks", () => {
    const xml = wrapSection(makeEquationXml("x = y = z", 'id="eq1" style="font-size:11"'));
    const fixed = fixRunOnEquationsInXml(xml);
    const openTags = [...fixed.matchAll(/<hp:equation\b([^>]*)>/g)].map((m) => m[1].trim());
    expect(openTags).toHaveLength(2);
    for (const tag of openTags) {
      expect(tag).toContain('id="eq1"');
      expect(tag).toContain('style="font-size:11"');
    }
  });

  it("does not split = inside LEFT() — depth-guarded by fix splitter", () => {
    // "k = LEFT(a=1 RIGHT)" — the fix splitter uses depth tracking so the
    // internal = inside LEFT() is ignored. Only 1 top-level = → no split.
    const xml = wrapSection(makeEquationXml("k = LEFT(a=1 RIGHT)"));
    const fixed = fixRunOnEquationsInXml(xml);
    // Should still be a single equation (fix splitter is smarter than detect)
    const equationMatches = [...fixed.matchAll(/<hp:equation\b[^>]*>/g)];
    expect(equationMatches).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. runCheckerWithAutoFix
// ─────────────────────────────────────────────────────────────────────────────

describe("runCheckerWithAutoFix", () => {
  it("clean XML: ok=true, autofixed=false, no fix needed", async () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml });

    expect(autofixed).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.output?.ok).toBe(true);
    expect(result.output?.autofixed).toBe(false);
  });

  it("run-on equation: triggers auto-fix, checker passes after fix", async () => {
    // XML with a run-on equation ("equation.run_on" is a warning, not error)
    // The fix is still applied to demonstrate the fix path.
    const xml = wrapSection(makeEquationXml("a = b = c"));
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml });

    // After fix, equation.run_on should no longer fire (split into two equations each with 1 =)
    expect(autofixed).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.output?.ok).toBe(true);
    // No run-on issues after fix
    const runOnIssues = result.output?.issues.filter((i) => i.ruleId === "equation.run_on") ?? [];
    expect(runOnIssues).toHaveLength(0);
    expect(result.output?.autofixed).toBe(true);
  });

  it("unfixable error (invalid difficulty): returns failed, autofixed=false", async () => {
    const xml = makeTextXml("[난이도] 극상");
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml });

    expect(autofixed).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.output?.ok).toBe(false);
  });

  it("missing input: falls back to plain runCheckerStage error path", async () => {
    const { result, autofixed } = await runCheckerWithAutoFix({});

    expect(autofixed).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("maxAttempts=1: fix is not attempted even for fixable issue", async () => {
    const xml = wrapSection(makeEquationXml("a = b = c"));
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 1);

    // With maxAttempts=1 the loop runs once, finds the issue, no fix pass
    expect(autofixed).toBe(false);
    // ok is true because equation.run_on is warning-only (no errors)
    expect(result.output?.ok).toBe(true);
  });

  it("validation message includes 'auto-fix' when fix was applied", async () => {
    const xml = wrapSection(makeEquationXml("a = b = c"));
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml });

    expect(autofixed).toBe(true);
    expect(result.validation?.message).toContain("auto-fix");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. NEW: maxAttempts 시맨틱 회귀 테스트 (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

describe("runCheckerWithAutoFix maxAttempts 시맨틱 — 회귀 검증", () => {
  it("maxAttempts=1 → runDeterministicCheckerRules 1회 호출, fix 호출 안 됨", async () => {
    // fixable issue (equation.run_on 경고)가 발생하는 XML
    const xml = wrapSection(makeEquationXml("a = b = c"));

    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 1);

    // Verification
    expect(autofixed).toBe(false);
    expect(result.output?.autofixed).toBe(false);
    // maxAttempts=1 이므로 루프가 1회만 실행: attempt 0에서 issues 확인하고 루프 종료
    // (fixableIssues가 있어도 attempt >= maxAttempts - 1이므로 fix는 발동 안 함)
    expect(result.output?.issues.filter((i) => i.ruleId === "equation.run_on")).toHaveLength(1);
  });

  it("maxAttempts=2 → runDeterministicCheckerRules 2회 호출, fix 1회 호출, autofixed=true", async () => {
    const xml = wrapSection(makeEquationXml("a = b = c"));

    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 2);

    // Verification
    // attempt=0: rules 호출 → fixable issues 발견 → fix 적용
    // attempt=1: rules 호출 → fixable issues 없음 → 루프 종료
    expect(autofixed).toBe(true);
    expect(result.output?.autofixed).toBe(true);
    // fix 후 run-on 경고가 사라져야 함 (분할됨)
    expect(result.output?.issues.filter((i) => i.ruleId === "equation.run_on")).toHaveLength(0);
    expect(result.output?.ok).toBe(true);
  });

  it("maxAttempts=3 → runDeterministicCheckerRules 최대 3회 호출, fix 최대 2회", async () => {
    // 이 테스트는 모든 라운드에서 fixable을 유지하는 경우를 검증
    // 단, 현재 RULES에서는 equation.run_on만 fixable한 warning이고,
    // 그 fix는 idempotent하므로 2회째 fix 후 run-on 경고가 사라짐
    // → attempt=0: rules → fix, attempt=1: rules → no more fixable → return
    // 따라서 실제로는 2회 호출만 일어남

    const xml = wrapSection(makeEquationXml("a = b = c"));
    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 3);

    // maxAttempts=3이어도 fixable issues가 남지 않으면 루프가 조기 종료
    expect(autofixed).toBe(true);
    expect(result.output?.ok).toBe(true);
    // 모든 fixable 이슈 해결됨
    expect(result.output?.issues.filter((i) => i.fallbackRequired)).toHaveLength(0);
  });

  it("maxAttempts=2 + clean XML → runDeterministicCheckerRules 1회만 호출, fix 호출 안 됨", async () => {
    // clean XML에는 fixable issues가 없으므로 루프 첫 시도에서 바로 반환
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));

    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 2);

    expect(autofixed).toBe(false);
    expect(result.output?.autofixed).toBe(false);
    expect(result.output?.ok).toBe(true);
    expect(result.output?.issues).toHaveLength(0);
  });

  it("maxAttempts=1 + clean XML → attempt 0에서 즉시 반환", async () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));

    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 1);

    expect(autofixed).toBe(false);
    expect(result.output?.ok).toBe(true);
  });

  it("maxAttempts >= 1 일 때 unfixable error는 autofixed=false로 반환", async () => {
    // unfixable error: 난이도 어휘 오류
    const xml = makeTextXml("[난이도] 극상");

    const { result, autofixed } = await runCheckerWithAutoFix({ sectionXml: xml }, 2);

    expect(autofixed).toBe(false);
    expect(result.output?.ok).toBe(false);
    expect(result.output?.issues.some((i) => i.ruleId === "text.difficulty_vocabulary")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. NEW Deterministic rule: endNote.structure (D6)
// ─────────────────────────────────────────────────────────────────────────────

function makeEndNoteXml(options: {
  suffixChar?: string;
  number?: string;
  autoNum?: boolean;
  answerText?: string;
  bold?: boolean;
}): string {
  const {
    suffixChar = "46",
    number = "1",
    autoNum = true,
    answerText = "[정답] ①",
    bold = false,
  } = options;

  const attrs = [
    suffixChar !== undefined ? `suffixChar="${suffixChar}"` : "",
    number !== undefined ? `number="${number}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<hp:endNote ${attrs}>${autoNum ? '<hp:autoNum numType="digit" />' : ""}<hp:p><hp:run>${bold ? '<hp:charPr bold="true" />' : ""}<hp:t>${answerText}</hp:t></hp:run></hp:p></hp:endNote>`;
}

describe("checkEndNoteStructure (endNote.structure)", () => {
  it("pass: valid endNote with all required elements", () => {
    const xml = wrapSection(makeEndNoteXml({}));
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues).toHaveLength(0);
  });

  it("fail: missing [정답] text produces error", () => {
    const xml = wrapSection(makeEndNoteXml({ answerText: "풀이만 있고 정답 없음" }));
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("[정답]"))).toBe(true);
  });

  it("fail: missing suffixChar attribute produces error", () => {
    // Build endNote without suffixChar
    const xmlNoSuffix = wrapSection(
      `<hp:endNote number="1"><hp:autoNum numType="digit" /><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p></hp:endNote>`,
    );
    const issues = runDeterministicCheckerRules(xmlNoSuffix).filter(
      (i) => i.ruleId === "endNote.structure",
    );
    expect(issues.some((i) => i.message.includes("suffixChar"))).toBe(true);
  });

  it("fail: missing autoNum child produces error", () => {
    const xml = wrapSection(makeEndNoteXml({ autoNum: false }));
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.some((i) => i.message.includes("autoNum"))).toBe(true);
  });

  it("edge: no endNote elements in XML → no issues fired", () => {
    const xml = wrapSection(makeEquationXml("f(x) = x^2"));
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues).toHaveLength(0);
  });

  it("pass: multiple endNotes all valid", () => {
    const xml = wrapSection(
      makeEndNoteXml({ answerText: "[정답] ①", number: "1" }) +
        makeEndNoteXml({ answerText: "[정답] ②", number: "2" }),
    );
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues).toHaveLength(0);
  });

  // ── Order checks ──────────────────────────────────────────────────────────

  it("pass: suffixChar precedes number in attrs (correct order)", () => {
    const xml = `<hsp:secPr><hp:endNote suffixChar="46" number="1"><hp:autoNum numType="digit" /><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p></hp:endNote></hsp:secPr>`;
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    // No order-related issues
    expect(issues.filter((i) => i.message.includes("order"))).toHaveLength(0);
  });

  it("fail: number precedes suffixChar in attrs — order violation warning", () => {
    const xml = `<hsp:secPr><hp:endNote number="1" suffixChar="46"><hp:autoNum numType="digit" /><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p></hp:endNote></hsp:secPr>`;
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.some((i) => i.message.includes("suffixChar") && i.message.includes("number"))).toBe(true);
  });

  it("fail: <hp:autoNum> appears after <hp:t> in body — order violation warning", () => {
    // autoNum after the text node
    const xml = `<hsp:secPr><hp:endNote suffixChar="46" number="1"><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p><hp:autoNum numType="digit" /></hp:endNote></hsp:secPr>`;
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.some((i) => i.message.includes("autoNum") && i.message.includes("order"))).toBe(true);
  });

  // ── 미주-문제 띄어쓰기 없음 ────────────────────────────────────────────────

  it("pass: preceding <hp:p> ends without whitespace — no spacing error", () => {
    const xml = `<hsp:secPr><hp:p><hp:run><hp:t>다음 물음에 답하시오.</hp:t></hp:run></hp:p><hp:endNote suffixChar="46" number="1"><hp:autoNum numType="digit" /><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p></hp:endNote></hsp:secPr>`;
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.filter((i) => i.message.includes("whitespace"))).toHaveLength(0);
  });

  it("fail: preceding <hp:p> last text ends with space — spacing error", () => {
    // The last hp:t in the preceding <hp:p> ends with a trailing space
    const xml = `<hsp:secPr><hp:p><hp:run><hp:t>다음 물음에 답하시오. </hp:t></hp:run></hp:p><hp:endNote suffixChar="46" number="1"><hp:autoNum numType="digit" /><hp:p><hp:run><hp:t>[정답] ①</hp:t></hp:run></hp:p></hp:endNote></hsp:secPr>`;
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "endNote.structure");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("whitespace"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. NEW Deterministic rule: section.style_format (D8)
// ─────────────────────────────────────────────────────────────────────────────

function makeStyleXml(batangglCount: number): string {
  const styles = Array.from({ length: batangglCount }, (_, i) => `<hp:style name="바탕글${i > 0 ? i + 1 : ""}" styleId="Normal${i}" type="para"></hp:style>`).join("\n");
  return `<hsp:secPr><hp:styles>${styles}</hp:styles></hsp:secPr>`;
}

describe("checkSectionStyleFormat (section.style_format)", () => {
  it("pass: single 바탕글 style, no lineBreak, no bold in endNote", () => {
    const xml = makeStyleXml(1);
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    expect(issues).toHaveLength(0);
  });

  it("fail: multiple 바탕글 styles produces error", () => {
    const xml = makeStyleXml(2);
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("바탕글"))).toBe(true);
  });

  it("warning: lineBreak present produces warning with fallbackRequired", () => {
    const xml = wrapSection(`<hp:run><hp:lineBreak /></hp:run>`);
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("lineBreak"))).toBe(true);
    expect(issues.some((i) => i.fallbackRequired === true)).toBe(true);
  });

  it("fail: bold inside endNote body produces error", () => {
    const xml = wrapSection(makeEndNoteXml({ bold: true }));
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("bold"))).toBe(true);
  });

  it("pass: bold outside endNote (in main body) does not trigger rule", () => {
    const xml = wrapSection(`<hp:run><hp:charPr bold="true" /><hp:t>일반 텍스트 굵게</hp:t></hp:run>`);
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    // Bold outside endNote is not checked by this rule
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("edge: no 바탕글 styles (0 count) → no error (rule only fires if count > 1)", () => {
    const xml = wrapSection(`<hp:t>본문만</hp:t>`);
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "section.style_format");
    expect(issues.filter((i) => i.severity === "error" && i.message.includes("바탕글"))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. NEW Deterministic rule: text.vocabulary (D9)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal UnitClassification fixture for vocabulary tests. */
const TEST_CLASSIFICATION: UnitClassification = {
  subjects: [
    {
      code: "수1",
      name: "수학 I",
      grade: 2,
      units: [
        {
          code: "I",
          name: "수열",
          topics: ["등차수열", "등비수열", "수열의 합", "수학적 귀납법"],
        },
      ],
    },
    {
      code: "수2",
      name: "수학 II",
      grade: 2,
      units: [
        {
          code: "K",
          name: "미분법",
          topics: ["미분계수와 도함수"],
        },
      ],
    },
  ],
};

describe("checkTextVocabulary (text.vocabulary)", () => {
  beforeEach(() => {
    _resetUnitClassificationCache();
    _injectUnitClassification(TEST_CLASSIFICATION);
  });

  it("pass: valid 과목, 중단원, 범위", () => {
    const xml = makeTextXml("[과목] 수학 I [중단원] 등차수열 [범위] 등차수열");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues).toHaveLength(0);
  });

  it("fail: unknown 과목 produces error", () => {
    const xml = makeTextXml("[과목] 물리학 I");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("과목"))).toBe(true);
    expect(issues.some((i) => i.evidence?.includes("물리학 I"))).toBe(true);
  });

  it("fail: unknown 중단원 produces error", () => {
    const xml = makeTextXml("[중단원] 열역학");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("중단원"))).toBe(true);
  });

  it("fail: unknown 범위 produces error", () => {
    const xml = makeTextXml("[범위] 알수없는범위");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("범위"))).toBe(true);
  });

  it("pass: valid 범위 matching a topic", () => {
    const xml = makeTextXml("[범위] 수열의 합");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues).toHaveLength(0);
  });

  it("edge: no vocabulary tags → no issues", () => {
    const xml = makeTextXml("일반 본문 텍스트");
    const issues = runDeterministicCheckerRules(xml).filter((i) => i.ruleId === "text.vocabulary");
    expect(issues).toHaveLength(0);
  });

  it("checkTextVocabulary direct: unit name also accepted as 중단원", () => {
    // unit.name "수열" is also in the valid set
    const xml = makeTextXml("[중단원] 수열");
    const issues = checkTextVocabulary(xml, "test.xml", TEST_CLASSIFICATION);
    expect(issues).toHaveLength(0);
  });

  it("checkTextVocabulary direct: accepts array of classifications (union)", () => {
    // Passing an array is the new generalised signature
    const xml = makeTextXml("[과목] 수학 I [중단원] 등차수열");
    const issues = checkTextVocabulary(xml, "test.xml", [TEST_CLASSIFICATION]);
    expect(issues).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. NEW: schoolLevel 분기 (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal middle-school classification fixture. */
const TEST_CLASSIFICATION_MIDDLE: UnitClassification = {
  subjects: [
    {
      code: "중1",
      name: "중학교 1학년",
      grade: 1,
      units: [
        {
          code: "A",
          name: "소인수분해",
          topics: ["소수와 합성수 및 소인수분해", "최대공약수 및 최소공배수"],
        },
      ],
    },
  ],
};

describe("schoolLevel branching (text.vocabulary)", () => {
  beforeEach(() => {
    _resetUnitClassificationCache();
    _resetUnitClassificationMiddleCache();
    _injectUnitClassification(TEST_CLASSIFICATION);        // 고등: 수학 I / 수학 II
    _injectUnitClassificationMiddle(TEST_CLASSIFICATION_MIDDLE); // 중학교: 소인수분해
  });

  it("(a) schoolLevel='중' + 중학교 vocab pass — 소인수분해 is valid", () => {
    const xml = makeTextXml("[과목] 중학교 1학년 [중단원] 소인수분해");
    const issues = runDeterministicCheckerRules(xml, "section0.xml", { schoolLevel: "중" }).filter(
      (i) => i.ruleId === "text.vocabulary",
    );
    expect(issues).toHaveLength(0);
  });

  it("(b) schoolLevel='중' + 고등 only vocab (수학 I) → error", () => {
    // 수학 I is from high-school classification; with schoolLevel='중' only middle vocab is checked
    const xml = makeTextXml("[과목] 수학 I");
    const issues = runDeterministicCheckerRules(xml, "section0.xml", { schoolLevel: "중" }).filter(
      (i) => i.ruleId === "text.vocabulary",
    );
    // 수학 I not in middle classification → error
    expect(issues.some((i) => i.severity === "error" && i.message.includes("과목"))).toBe(true);
  });

  it("(c) schoolLevel 미지정 + 중학교 + 고등 vocab 모두 pass (union)", () => {
    // Without schoolLevel, both classifications are unioned — all vocab passes
    const xmlHigh = makeTextXml("[과목] 수학 I [중단원] 등차수열");
    const xmlMiddle = makeTextXml("[과목] 중학교 1학년 [중단원] 소인수분해");

    const issuesHigh = runDeterministicCheckerRules(xmlHigh, "section0.xml").filter(
      (i) => i.ruleId === "text.vocabulary",
    );
    const issuesMiddle = runDeterministicCheckerRules(xmlMiddle, "section0.xml").filter(
      (i) => i.ruleId === "text.vocabulary",
    );

    expect(issuesHigh).toHaveLength(0);
    expect(issuesMiddle).toHaveLength(0);
  });
});
