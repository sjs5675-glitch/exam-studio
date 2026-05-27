import { describe, it, expect } from "vitest";
import { convertProblemEquations } from "../convertProblemEquations";

describe("convertProblemEquations — eq/script 깊이 변환", () => {
  it("parts 의 eq 변환, t/br 보존", () => {
    const p = { parts: [{ t: "값은 " }, { eq: "\\frac{a}{b}" }, { br: true }] };
    expect(convertProblemEquations(p)).toEqual({
      parts: [{ t: "값은 " }, { eq: "a over b" }, { br: true }],
    });
  });
  it("choices(2D)·condition_box.items.parts 중첩 변환", () => {
    const p = {
      choices: [[{ eq: "x^{2}" }], [{ t: "①" }, { eq: "\\sqrt{x}" }]],
      condition_box: { type: "bogi", items: [{ label: "ㄱ", parts: [{ eq: "{}_{n}P_{r}" }] }] },
    };
    const out = convertProblemEquations(p) as typeof p;
    expect(out.choices[0][0]).toEqual({ eq: "x^2" });
    expect((out.choices[1][1] as { eq: string }).eq).toBe("sqrt x");
    expect((out.condition_box.items[0].parts[0] as { eq: string }).eq).toBe("{rm P}_{r} LSUB {n}");
  });
  it("explanation_table 조립제법 셀 script 변환", () => {
    const p = { explanation_table: { type: "synthetic_division",
      rows: [[{ type: "equation", script: "\\frac{1}{2}" }, { type: "equation", script: "2" }]] } };
    const out = convertProblemEquations(p) as typeof p;
    expect(out.explanation_table.rows[0][0].script).toBe("1 over 2");
    expect(out.explanation_table.rows[0][1].script).toBe("2");
  });
  it("data_table.row_parts 의 eq 변환", () => {
    const p = { data_table: { type: "normal_dist", row_parts: [[[{ eq: "P(Z<1)" }]]] } };
    const out = convertProblemEquations(p) as typeof p;
    expect((out.data_table.row_parts[0][0][0] as { eq: string }).eq).toBe("P(Z < 1)");
  });
  it("수식 아닌 필드는 그대로", () => {
    const p = { number: 3, type: "choice", score: "4점", subtopic: "지수함수" };
    expect(convertProblemEquations(p)).toEqual(p);
  });
});
