import { describe, it } from "vitest";
import { latexToHwp } from "../latexToHwp";

/** 복잡·중첩 수식 스트레스 — 출력만 찍어 육안/결합 검증 (assert 최소). */
const hard: [string, string][] = [
  ["중첩분수", "\\frac{\\frac{a}{b}}{\\frac{c}{d}}"],
  ["근의공식", "x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}"],
  ["루트안 분수", "\\sqrt{\\frac{b^{2}-4ac}{2a}}"],
  ["적분+분수", "\\int_{0}^{1} \\frac{1}{1+x^{2}} dx"],
  ["합+분수", "\\sum_{k=1}^{n} \\frac{1}{k(k+1)}"],
  ["극한+분수", "\\lim_{x \\to 0} \\frac{\\sin x}{x}"],
  ["지수에 분수", "e^{\\frac{x^{2}}{2}}"],
  ["수열 점화식", "a_{n+1} = a_{n} + \\frac{1}{2^{n}}"],
  ["행렬+분수", "\\begin{pmatrix} \\frac{1}{2} & 0 \\\\ 0 & 1 \\end{pmatrix}"],
  ["순열+분수", "{}_{n}P_{r} = \\frac{n!}{(n-r)!}"],
  ["정규분포(복합)", "f(x) = \\frac{1}{\\sqrt{2\\pi}\\sigma} e^{-\\frac{(x-m)^{2}}{2\\sigma^{2}}}"],
  ["삼각+제곱", "\\frac{1-\\cos^{2}\\theta}{\\sin\\theta}"],
  ["로그+분수", "\\log_{2}\\frac{x+1}{x-1}"],
  ["중첩루트", "\\sqrt{x+\\sqrt{x}}"],
  ["부등식 체인", "0 < \\frac{1}{n+1} < \\frac{1}{n}"],
  ["조합+이항", "(a+b)^{n} = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^{k}"],
];

describe("복잡 수식 스트레스 (육안 검증)", () => {
  for (const [name, latex] of hard) {
    it(name, () => {
      const out = latexToHwp(latex);
      // eslint-disable-next-line no-console
      console.log(`■ ${name}\n   IN : ${latex}\n   OUT: ${out}`);
    });
  }
});
