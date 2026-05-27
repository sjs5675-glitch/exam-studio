import { describe, it, expect } from "vitest";
import { latexToHwp } from "../latexToHwp";

/** 극단적 중첩 — AST 재귀가 임의 깊이를 처리하는지 증명. */
describe("극단 중첩 분수/루트 (AST 재귀 증명)", () => {
  it("4단 중첩분수", () => {
    expect(latexToHwp("\\frac{\\frac{\\frac{\\frac{a}{b}}{c}}{d}}{e}"))
      .toBe("{ { { a over b } over c } over d } over e");
  });
  it("연분수(continued fraction)", () => {
    expect(latexToHwp("\\frac{1}{1+\\frac{1}{1+\\frac{1}{x}}}"))
      .toBe("1 over { 1 + 1 over { 1 + 1 over x } }");
  });
  it("분수∈루트∈분수", () => {
    expect(latexToHwp("\\frac{\\sqrt{\\frac{a}{b}}}{\\frac{c}{\\sqrt{d}}}"))
      .toBe("{ sqrt { a over b } } over { c over { sqrt d } }");
  });
  it("지수탑에 분수", () => {
    expect(latexToHwp("e^{\\frac{1}{\\frac{2}{3}}}")).toBe("e^{ 1 over { 2 over 3 } }");
  });
});

/** 분수 + 지수 + 근호 복합 (사용자 지목 최난도). */
describe("복합: 분수+지수+근호", () => {
  const log = (n: string, s: string) => console.log(`${n}: ${s}`); // eslint-disable-line no-console
  it("루트 안 분수+지수", () => { const o = latexToHwp("\\sqrt{\\frac{x^{2}}{y^{2}}}"); log("루트(분수^)", o);
    expect(o).toBe("sqrt { { x^2 } over { y^2 } }"); });
  it("분수 분모에 루트", () => { const o = latexToHwp("\\frac{x^{2}}{\\sqrt{y}}"); log("분모루트", o);
    expect(o).toBe("{ x^2 } over { sqrt y }"); });
  it("루트에 지수 \\sqrt{x}^2 (뒤따르는 ^)", () => { const o = latexToHwp("\\sqrt{x}^{2}"); log("루트^지수", o);
    expect(o).toBe("{ sqrt x }^2"); });
  it("괄호분수의 거듭제곱 (a/b)^n", () => { const o = latexToHwp("\\left(\\frac{a}{b}\\right)^{n}"); log("괄호분수^n", o);
    expect(o).toContain("LEFT(");  expect(o).toContain("^n"); });
  it("지수에 루트분수", () => { const o = latexToHwp("e^{\\sqrt{\\frac{x}{2}}}"); log("지수루트분수", o);
    expect(o).toBe("e^{ sqrt { x over 2 } }"); });
  it("근의공식 완전체", () => { const o = latexToHwp("x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}"); log("근의공식", o);
    expect(o).toBe("x = { - b pm sqrt { b^2 - 4 ac } } over { 2 a }"); });
  it("표준편차형 sqrt(분수)", () => { const o = latexToHwp("\\sigma = \\sqrt{\\frac{\\sum (x-m)^{2}}{n}}"); log("표준편차", o);
    expect(o).toContain("sqrt {"); expect(o).toContain("over"); expect(o).toContain("(x - m) }^2"); });
});
