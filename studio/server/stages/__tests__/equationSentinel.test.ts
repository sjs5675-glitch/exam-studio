import { describe, it, expect } from "vitest";
import {
  escapeEquationSentinels,
  stripEquationSentinels,
  buildSentinelCandidates,
  EQ_SENTINEL_OPEN,
  EQ_SENTINEL_CLOSE,
} from "../equationSentinel";
import { parseModelJsonOutput } from "../modelHarness";

const wrap = (eq: string) => `${EQ_SENTINEL_OPEN}${eq}${EQ_SENTINEL_CLOSE}`;

describe("escapeEquationSentinels (단일 백슬래시 raw → 이스케이프)", () => {
  it("단일 백슬래시 LaTeX 를 감싼 JSON 이 파싱 가능해진다", () => {
    const raw = `{"eq": "${wrap("\\frac{1}{2}")}"}`;
    const out = escapeEquationSentinels(raw);
    expect(out).toBe('{"eq": "\\\\frac{1}{2}"}');
    expect(JSON.parse(out)).toEqual({ eq: "\\frac{1}{2}" });
  });

  it("여러 수식을 각각 독립적으로 이스케이프한다", () => {
    const raw = `{"parts":[{"eq":"${wrap("\\sqrt{3}")}"},{"eq":"${wrap("\\pi r^2")}"}]}`;
    const parsed = JSON.parse(escapeEquationSentinels(raw));
    expect(parsed).toEqual({ parts: [{ eq: "\\sqrt{3}" }, { eq: "\\pi r^2" }] });
  });

  it("수식 안의 따옴표·줄바꿈도 안전하게 이스케이프한다", () => {
    const raw = `{"eq": "${wrap('\\text{"a"}\nb')}"}`;
    const parsed = JSON.parse(escapeEquationSentinels(raw)) as { eq: string };
    expect(parsed.eq).toBe('\\text{"a"}\nb');
  });

  it("센티넬이 없는 출력은 무변경(no-op)", () => {
    const raw = `{"t": "순수 한국어 텍스트", "n": 3}`;
    expect(escapeEquationSentinels(raw)).toBe(raw);
  });
});

describe("stripEquationSentinels (이중 백슬래시 유효 JSON → 토큰만 제거)", () => {
  it("토큰만 제거하고 JSON 구조는 그대로 둔다", () => {
    const raw = `{"eq": "${wrap("\\\\frac{1}{2}")}"}`; // 소스 \\\\ = 렌더 \\ (백슬래시 2개)
    const out = stripEquationSentinels(raw);
    expect(out).toBe('{"eq": "\\\\frac{1}{2}"}');
    expect(JSON.parse(out)).toEqual({ eq: "\\frac{1}{2}" });
  });
});

describe("parseModelJsonOutput + 센티넬 (전송 결정론 end-to-end)", () => {
  it("codex 스타일: 이중 백슬래시(유효 JSON) 가 손상 없이 파싱된다 (회귀 케이스)", () => {
    // 모델이 JSON 습관대로 \\mathrm \\geq \\int 등 이중 백슬래시를 낸 실제 codex 출력 형태.
    // (소스의 \\\\ = 모델이 낸 백슬래시 2개)
    const raw =
      `{"parts":[{"eq":"${wrap("\\\\mathrm{P}")}"},` +
      `{"eq":"${wrap("t(t \\\\geq 0)")}"},` +
      `{"eq":"${wrap("\\\\int_{0}^{b} v(t)\\\\,dt")}"}]}`;
    const result = parseModelJsonOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parts = (result.value as { parts: Array<{ eq: string }> }).parts;
      // 단일 백슬래시 LaTeX 로 복원 — 다운스트림 변환기가 정상 처리할 수 있는 형태.
      expect(parts[0].eq).toBe("\\mathrm{P}");
      expect(parts[1].eq).toBe("t(t \\geq 0)");
      expect(parts[2].eq).toBe("\\int_{0}^{b} v(t)\\,dt");
    }
  });

  it("claude 스타일: 단일 백슬래시 LaTeX 가 파싱된다", () => {
    const raw = `{"number":1,"parts":[{"eq":"${wrap("\\frac{1}{2}+\\sqrt{3}")}"}]}`;
    const result = parseModelJsonOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parts = (result.value as { parts: Array<{ eq: string }> }).parts;
      expect(parts[0].eq).toBe("\\frac{1}{2}+\\sqrt{3}");
    }
  });

  it("단일 백슬래시 \\frac 도 센티넬 안이면 form-feed 손상 없이 복원된다", () => {
    // 센티넬이 없으면 \f(form feed)로 조용히 손상되던 케이스 — 센티넬+escape 우선이 막는다.
    const raw = `{"eq":"${wrap("\\frac{1}{2}")}"}`;
    const result = parseModelJsonOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { eq: string }).eq).toBe("\\frac{1}{2}");
    }
  });

  it("센티넬 없는 단일 백슬래시는 여전히 throw/손상 (센티넬 사용을 강제하는 근거)", () => {
    // \s 는 무효 JSON 이스케이프 → 파싱 실패
    expect(parseModelJsonOutput(`{"eq":"\\sqrt{2}"}`).ok).toBe(false);
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

describe("buildSentinelCandidates (우선순위)", () => {
  it("이중 백슬래시 구간이 있으면 strip 을 먼저 시도", () => {
    const raw = `{"eq":"${wrap("\\\\frac{1}{2}")}"}`;
    const [first] = buildSentinelCandidates(raw);
    expect(first).toBe(stripEquationSentinels(raw));
  });

  it("단일 백슬래시면 escape 를 먼저 시도", () => {
    const raw = `{"eq":"${wrap("\\frac{1}{2}")}"}`;
    const [first] = buildSentinelCandidates(raw);
    expect(first).toBe(escapeEquationSentinels(raw));
  });
});
