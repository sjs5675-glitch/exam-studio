import { describe, it, expect } from "vitest";
import { latexToHwp } from "../latexToHwp";

/**
 * 시험 현실 코퍼스. 원본 hwp-eqn-ts 가 잘라먹던 케이스들이
 * 패치 후 "잘림 없이 구조 보존"되는지 측정한다.
 * (HWP 고유 후처리 R-01~R-10 은 equation.py 담당이므로 여기선 구조만 본다.)
 */
const corpus: { name: string; latex: string; mustContain: string[] }[] = [
  { name: "분수+제곱(괄호보존)", latex: "\\frac{x^{2}+1}{2}", mustContain: ["over", "x^2", "+ 1", "{", "}"] },
  { name: "루트(범위보존)", latex: "\\sqrt{x^{2}+y^{2}}", mustContain: ["sqrt", "x^2", "y^2"] },
  { name: "적분", latex: "\\int_{0}^{t} v(t) dt", mustContain: ["int_0", "^t", "v", "dt"] },
  { name: "분포 N(m,sigma^2) — 쉼표보존", latex: "N(m, \\sigma^{2})", mustContain: ["N", "m", ",", "sigma^2"] },
  { name: "부등식 — 멈춤 없이", latex: "x \\leq 3 \\geq y", mustContain: ["x", "leq", "3", "geq", "y"] },
  { name: "내적/점", latex: "a \\cdot b + \\cdots", mustContain: ["a", "cdot", "b", "cdots"] },
  { name: "단위 mathrm→rm", latex: "150 \\mathrm{kg}", mustContain: ["150", "rm", "kg"] },
  { name: "삼각함수+등호", latex: "\\sin^{2}\\theta + \\cos^{2}\\theta = 1", mustContain: ["sin^2", "theta", "cos^2", "=", "1"] },
  { name: "무한대 합", latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}", mustContain: ["sum_", "^inf", "over", "n^2"] },
  { name: "극한", latex: "\\lim_{x \\to 0} \\frac{\\sin x}{x}", mustContain: ["lim", "over", "sin"] },
  { name: "절댓값", latex: "\\left| x - 1 \\right|", mustContain: ["LEFT|", "x", "- 1", "RIGHT|"] },
  { name: "로그", latex: "\\log_{2} 8 = 3", mustContain: ["log_2", "8", "=", "3"] },
];

describe("latexToHwp — 시험 현실 코퍼스 (잘림/구조 보존)", () => {
  for (const c of corpus) {
    it(c.name, () => {
      const out = latexToHwp(c.latex);
      // eslint-disable-next-line no-console
      console.log(`[${c.name}]\n  IN : ${c.latex}\n  OUT: ${out}`);
      for (const frag of c.mustContain) {
        expect(out, `"${frag}" 가 출력에 있어야 함 (잘림/누락 아님)`).toContain(frag);
      }
    });
  }
});

describe("latexToHwp — 좌측첨자 순열·조합 (LSUB prescript)", () => {
  it("순열 nPr", () => {
    expect(latexToHwp("{}_{n}P_{r}")).toBe("{rm P}_{r} LSUB {n}");
  });
  it("조합 nCr (숫자)", () => {
    expect(latexToHwp("{}_{5}C_{3}")).toBe("{rm C}_{3} LSUB {5}");
  });
  it("중복조합 nHr", () => {
    expect(latexToHwp("{}_{n}H_{r}")).toBe("{rm H}_{r} LSUB {n}");
  });
  it("여러자리 첨자 {10}P{4}", () => {
    expect(latexToHwp("{}_{10}P_{4}")).toBe("{rm P}_{4} LSUB {10}");
  });
  it("식 안에서: nPr = n!/(n-r)!", () => {
    const out = latexToHwp("{}_{n}P_{r} = \\frac{n!}{(n-r)!}");
    expect(out).toContain("{rm P}_{r} LSUB {n}");
    expect(out).toContain("over");
    expect(out).toContain("=");
  });
});

describe("latexToHwp — 잔여 gap 보강 (n제곱근·이항계수·악센트·간격)", () => {
  it("세제곱근 \\sqrt[3]{x}", () => {
    expect(latexToHwp("\\sqrt[3]{x}")).toBe("root 3 of x");
  });
  it("n제곱근 다항 \\sqrt[n]{x^2+1}", () => {
    expect(latexToHwp("\\sqrt[n]{x^{2}+1}")).toBe("root n of { x^2 + 1 }");
  });
  it("일반 루트는 그대로 sqrt", () => {
    expect(latexToHwp("\\sqrt{2}")).toBe("sqrt 2");
  });
  it("이항계수 \\binom{n}{k} (단일토큰은 괄호 불필요)", () => {
    expect(latexToHwp("\\binom{n}{k}")).toBe("n choose k");
  });
  it("이항계수 다항 \\binom{n+1}{k} (다항은 묶음)", () => {
    expect(latexToHwp("\\binom{n+1}{k}")).toBe("{ n + 1 } choose k");
  });
  it("이항계수 식 안에서", () => {
    const out = latexToHwp("\\binom{n}{r} = \\frac{n!}{r!(n-r)!}");
    expect(out).toContain("choose");
    expect(out).toContain("over");
  });
  it("악센트 check", () => {
    expect(latexToHwp("\\check{x}")).toBe("check x");
  });
  it("벡터 \\overrightarrow{AB} → vec", () => {
    expect(latexToHwp("\\overrightarrow{AB}")).toBe("vec AB");
    expect(latexToHwp("\\overrightarrow{a} - 3\\overrightarrow{b}")).toBe("vec a - 3 vec b");
  });
  it("선분/켤레 \\overline{AB} (통과)", () => {
    expect(latexToHwp("\\overline{AB}")).toBe("overline{AB}");
  });
  it("빈칸 \\boxed → box{ }", () => {
    expect(latexToHwp("( x^{\\boxed{~~}} )^2 = x^{28}")).toContain("box{~ ~}");
  });
  it("간격 \\, \\; 는 ~ 로 (백슬래시 누수 없음)", () => {
    const out = latexToHwp("a \\, b \\; c");
    expect(out).toContain("~");
    expect(out).not.toContain("\\");
  });
});

describe("latexToHwp — 절댓값/델리미터 중첩 (라운드트립 발견 회귀)", () => {
  it("지수 안 절댓값은 묶인다", () => {
    expect(latexToHwp("r^{\\left| ab \\right|}")).toBe("r^{ LEFT| ab RIGHT| }");
  });
  it("분수 분자 절댓값은 묶인다", () => {
    expect(latexToHwp("\\frac{\\left| -4+3+k \\right|}{\\sqrt{4^2+3^2}}"))
      .toBe("{ LEFT| - 4 + 3 + k RIGHT| } over { sqrt { 4^2 + 3^2 } }");
  });
  it("중첩 절댓값(바깥 RIGHT| 누수 없음)", () => {
    expect(latexToHwp("\\left| f \\left( 0 \\right) \\right|"))
      .toBe("LEFT| f LEFT( 0 RIGHT) RIGHT|");
  });
  it("집합 표기 \\left\\{ ... \\right\\} → 리터럴 { } (백슬래시 누수 없음)", () => {
    const out = latexToHwp("\\left\\{ x | x>0 \\right\\}");
    expect(out).toBe("LEFT { x | x > 0 RIGHT }");
    expect(out).not.toContain("\\");
  });
  it("가우스 기호 \\lfloor x \\rfloor → 유니코드 ⌊ ⌋", () => {
    expect(latexToHwp("\\left\\lfloor x \\right\\rfloor")).toBe("LEFT ⌊ x RIGHT ⌋");
  });
  it("이스케이프 특수문자 \\% 누수 없음", () => {
    const out = latexToHwp("5\\%");
    expect(out).toBe("5 %");
    expect(out).not.toContain("\\");
  });
  it("factor 위치의 \\times 누수 없음 (선두/괄호 뒤)", () => {
    expect(latexToHwp("\\times 10^{8}")).toBe("times 10^8");
    expect(latexToHwp("3 \\times 10^{8}")).toBe("3 times 10^8");
    expect(latexToHwp("\\times 10^{8}")).not.toContain("\\");
  });
});

describe("latexToHwp — 장소별정의함수 cases (셀 분리 회귀)", () => {
  it("piecewise: 셀 안 다항이 열로 안 쪼개짐", () => {
    const out = latexToHwp("f(x) = \\begin{cases} -\\frac{1}{2}x-3+k & (x<1) \\\\ \\frac{1}{2}x+1 & (x \\geq 1) \\end{cases}");
    // 셀 경계(&)는 행당 정확히 1개여야 함 (값 & 조건). 토큰마다 쪼개지면 다수 발생.
    expect(out).toContain("cases{");
    const rows = out.slice(out.indexOf("{") + 1, out.lastIndexOf("}")).split(" # ");
    expect(rows.length).toBe(2);
    for (const r of rows) expect((r.match(/&/g) || []).length).toBe(1);
    expect(out).toContain("over");
  });
  it("행렬 셀 보존", () => {
    expect(latexToHwp("\\begin{pmatrix} a+b & 0 \\\\ 0 & c-d \\end{pmatrix}"))
      .toBe("pmatrix{a + b & 0 # 0 & c - d}");
  });
});

describe("latexToHwp — rm 스코프/괄호 견고성 + overbrace + 화살표", () => {
  it("{…} 안의 짝없는 )가 그룹을 끊지 않음 (rm 스코프)", () => {
    // 원본은 (x+rmA)^2=rmB. 참조 카탈로그 rm-스코프 표현을 받아도 내용 보존.
    const out = latexToHwp("(x+\\mathrm{A)^2 =}\\mathrm{B})");
    expect(out).toContain("rm{");
    expect(out).toContain("B");
    expect(out).not.toMatch(/^\{ \(x \+ rm\{A\) \}/); // 예전엔 A)에서 끊겨 truncate 됐음
  });
  it("균형 괄호 분자는 그대로 (회귀)", () => {
    expect(latexToHwp("\\frac{(a+b)}{c}")).toBe("{ (a + b) } over c");
  });
  it(") 로 시작하는 조각수식도 안 버림", () => {
    expect(latexToHwp(")x+b")).toBe(") x + b");
  });
  it("\\overbrace / \\underbrace", () => {
    expect(latexToHwp("\\overbrace{x+y}")).toBe("overbrace{x + y}");
    expect(latexToHwp("\\underbrace{a+b}")).toBe("underbrace{a + b}");
  });
  it("화살표 \\Rightarrow→RARROW, \\Leftrightarrow→LRARROW", () => {
    expect(latexToHwp("p \\Rightarrow q")).toBe("p RARROW q");
    expect(latexToHwp("A \\Leftrightarrow B")).toBe("A LRARROW B");
  });
});

describe("latexToHwp — 부등호·계승 보존 (UNKNOWN 폐기 회귀)", () => {
  it("부등식 체인 < >", () => {
    const out = latexToHwp("0 < \\frac{1}{n+1} < \\frac{1}{n}");
    expect(out).toContain("0 <");
    expect((out.match(/</g) || []).length).toBe(2);
  });
  it("계승 ! (순열 분수)", () => {
    const out = latexToHwp("{}_{n}P_{r} = \\frac{n!}{(n-r)!}");
    expect(out).toContain("n !");
    expect((out.match(/!/g) || []).length).toBe(2);
  });
  it("초과/이상 혼합", () => {
    expect(latexToHwp("x > 0")).toContain(">");
  });
});

describe("latexToHwp — 분수 결합 정확성 (괄호 보존 회귀)", () => {
  it("다항 분자는 반드시 묶인다", () => {
    // 원본 버그: "x^2 + 1 over 2" (분자 괄호 소실 → 결합 깨짐)
    const out = latexToHwp("\\frac{x^{2}+1}{2}");
    expect(out).toContain("} over");
    expect(out).not.toMatch(/\+\s*1\s+over/); // "+ 1 over" 형태(괄호 없는 분자) 금지
  });
});
