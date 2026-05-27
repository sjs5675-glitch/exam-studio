import { describe, it, expect } from "vitest";
import { unwrapEquationSentinels, EQ_SENTINEL_OPEN, EQ_SENTINEL_CLOSE } from "../equationSentinel";
import { parseModelJsonOutput } from "../modelHarness";

const wrap = (eq: string) => `${EQ_SENTINEL_OPEN}${eq}${EQ_SENTINEL_CLOSE}`;

describe("unwrapEquationSentinels", () => {
  it("단일 백슬래시 LaTeX 를 감싼 JSON 이 파싱 가능해진다", () => {
    const raw = `{"eq": "${wrap("\\frac{1}{2}")}"}`;
    const out = unwrapEquationSentinels(raw);
    expect(out).toBe('{"eq": "\\\\frac{1}{2}"}');
    expect(JSON.parse(out)).toEqual({ eq: "\\frac{1}{2}" });
  });

  it("여러 수식을 각각 독립적으로 이스케이프한다", () => {
    const raw = `{"parts":[{"eq":"${wrap("\\sqrt{3}")}"},{"eq":"${wrap("\\pi r^2")}"}]}`;
    const parsed = JSON.parse(unwrapEquationSentinels(raw));
    expect(parsed).toEqual({ parts: [{ eq: "\\sqrt{3}" }, { eq: "\\pi r^2" }] });
  });

  it("수식 안의 따옴표·줄바꿈도 안전하게 이스케이프한다", () => {
    const raw = `{"eq": "${wrap('\\text{"a"}\nb')}"}`;
    const parsed = JSON.parse(unwrapEquationSentinels(raw)) as { eq: string };
    expect(parsed.eq).toBe('\\text{"a"}\nb');
  });

  it("이미 백슬래시가 없는 평범한 내용도 그대로 통과", () => {
    const raw = `{"eq": "${wrap("x^2 + 1")}"}`;
    expect(JSON.parse(unwrapEquationSentinels(raw))).toEqual({ eq: "x^2 + 1" });
  });

  it("센티넬이 없는 출력은 무변경(no-op)", () => {
    const raw = `{"t": "순수 한국어 텍스트", "n": 3}`;
    expect(unwrapEquationSentinels(raw)).toBe(raw);
  });

  it("script(조립제법 셀) 필드도 동일하게 처리", () => {
    const raw = `{"type":"equation","script":"${wrap("\\frac{a}{b}")}"}`;
    expect(JSON.parse(unwrapEquationSentinels(raw))).toEqual({
      type: "equation",
      script: "\\frac{a}{b}",
    });
  });

  it("닫는 센티넬이 없으면 그 구간은 그대로 둔다(파싱은 상위에서 재시도)", () => {
    const raw = `{"eq": "${EQ_SENTINEL_OPEN}\\frac{1}{2}"}`;
    // 변환 안 됨 → 원문 유지 (단일 백슬래시 그대로라 JSON.parse 는 실패할 것 = 재시도 트리거)
    expect(unwrapEquationSentinels(raw)).toBe(raw);
  });
});

describe("parseModelJsonOutput + 센티넬 (전송 결정론 end-to-end)", () => {
  it("센티넬+단일백슬래시 LLM 출력이 파싱된다 (원래 깨지던 케이스)", () => {
    const raw = `{"number":1,"parts":[{"eq":"${wrap("\\frac{1}{2}+\\sqrt{3}")}"}]}`;
    const result = parseModelJsonOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parts = (result.value as { parts: Array<{ eq: string }> }).parts;
      expect(parts[0].eq).toBe("\\frac{1}{2}+\\sqrt{3}");
    }
  });

  it("센티넬 없는 단일 백슬래시는 throw(\\sqrt) 또는 silent corruption(\\frac) — 둘 다 센티넬로 해결", () => {
    // \s 는 무효 JSON 이스케이프 → JSON.parse throw → 파싱 실패(=재시도)
    expect(parseModelJsonOutput(`{"eq":"\\sqrt{2}"}`).ok).toBe(false);
    // \f 는 형식상 valid escape(form feed) → 파싱은 되지만 값이 조용히 손상됨(더 위험)
    const corrupted = parseModelJsonOutput(`{"eq":"\\frac{1}{2}"}`);
    expect(corrupted.ok).toBe(true);
    if (corrupted.ok) {
      expect((corrupted.value as { eq: string }).eq).not.toBe("\\frac{1}{2}");
      expect((corrupted.value as { eq: string }).eq).toContain("\f"); // form feed 로 손상
    }
  });

  it("마크다운 펜스로 감싼 센티넬 출력도 파싱된다", () => {
    const raw = "```json\n" + `{"answer":"3","explanation_parts":[{"eq":"${wrap("\\pi r^2")}"}]}` + "\n```";
    const result = parseModelJsonOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ep = (result.value as { explanation_parts: Array<{ eq: string }> }).explanation_parts;
      expect(ep[0].eq).toBe("\\pi r^2");
    }
  });
});
