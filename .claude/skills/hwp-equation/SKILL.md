---
name: hwp-equation
description: "HWP/HWPX 수식 작성 규칙. 한글 문서의 수식(<hp:equation><hp:script>) 작성법과 기출작업 수식 규칙을 제공한다. 'HWP 수식', '한글 수식', 'equation script', '수식 입력' 키워드에 자동 로딩."
user-invocable: false
---

# HWP 수식 작성 스킬

HWPX 문서에서 수식은 `<hp:equation>` 요소의 `<hp:script>` 안에 HWP 수식 문법으로 작성된다.

상세 문법 레퍼런스는 [reference.md](reference.md) 참조.

## HWPX 수식 XML 구조

```xml
<hp:equation id="..." treatAsChar="1" ...>
  <hp:sz width="525" height="1125" .../>
  <hp:pos treatAsChar="1" .../>
  <hp:shapeComment>수식입니다.</hp:shapeComment>
  <hp:script>6</hp:script>
</hp:equation>
```

## HWP 수식 문법 핵심

### 기본 규칙

| 기호 | 효과 |
|------|------|
| `~` | 빈칸 (Space) |
| `` ` `` | 1/4 빈칸 |
| `{ }` | 여러 항 묶음 |
| `#` | 줄 바꾸기 |
| `&` | 세로 칸 맞춤 |

### 글꼴

| 명령 | 효과 |
|------|------|
| (기본) | 이탤릭체 |
| `rm` | 로만체 |
| `it` | 이탤릭 복귀 |
| `bold` | 볼드체 |

### 주요 명령어

| 명령어 | 예시 |
|--------|------|
| `over` | `1 over 2` → 1/2 |
| `sqrt` | `sqrt 2` → √2 |
| `^` / `_` | `x^2`, `a_n` (오른쪽 위/아래 첨자) |
| `SUP` / `SUB` | `^`, `_`와 동일 |
| `LSUP` / `LSUB` | **왼쪽** 위/아래 첨자 |
| `times` | `2 times 3` |
| `int` | `int_0^1 f(x)dx` |
| `sum` | `sum_{k=1}^n a_k` |
| `lim` | `lim_{x->0}` |
| `cases` | `cases{x#y}` |
| `left(` `right)` | 큰 괄호 |
| `binom` / `choose` | 조합 |
| `matrix` | `matrix{a&b#c&d}` |

### 왼쪽 첨자 — 중요!

**`_`(SUB)와 `^`(SUP)는 오른쪽 첨자 전용**이다. 수식이 `_`로 시작하면 **한컴에서 렌더링이 안 된다**.

왼쪽 첨자는 `{it`_N}` 패턴(이탤릭+백틱+하첨자 그룹)을 사용한다.

| 수식 | 잘못된 입력 (렌더링 실패) | 올바른 입력 |
|------|--------------------------|-------------|
| ₅P₃ | `_5 P _3` | `{it`_5}{rm P}_{it 3}` |
| ₙCᵣ | `_n C _r` | `{it`_n}{rm C}_{it r}` |
| ₅Π₃ | `_5 PI _3` | `{it`_5}{rm smallprod}_{it 3}` |
| ₄H₃ | `_4 rm H _3` | `{it`_4}{rm H}_{it 3}` |
| ¹³C₆ | `^{13} C _6` | `{it`^{13}}{rm C}_{it 6}` |

**패턴**: `{it`_왼쪽첨자}{rm 기호}_{it 오른쪽첨자}`

SMALL 접두어 기호 (`smallprod`, `SMALLUNION`, `SMALLINTER` 등)는 첨자 없는 크기 축소 버전이며, `_`/`^`로 첨자를 붙일 수 있다.

### 기호

| 기호 | 명령 | 기호 | 명령 |
|------|------|------|------|
| ⋯ | `cdots` | ∞ | `inf` |
| ∴ | `therefore` | ∵ | `because` |
| → | `->` | ⇒ | `RARROW` |
| ≤ | `leq` | ≥ | `geq` |
| ≠ | `neq` | ∈ | `IN` |
| ∪ | `cup` | ∩ | `cap` |
| ∅ | `emptyset` | ∂ | `partial` |
| • | `bullet` | · | `cdot` |
| △ | `TRIANGLE` | ⊥ | `BOT` |

### 자동 로만체 함수

sin, cos, tan, cot, sec, csc, log, ln, lg, lim, exp, det, gcd, max, min, arcsin, arccos, arctan, sinh, cosh, tanh, coth, mod

---

## 수식 작업 규칙

### 필수 규칙

1. **단위·도형 대문자는 rm체**: `rmA`, `rm ABC`, `150` `` ` `` `rm kg`
2. **쉼표 뒤 한 칸**: `(a,~b,~c)`, `{1,~2,~3}`
3. **cdots**: `[수식]+` `` ` `` `cdots` `` ` `` `+[수식]`
4. **명제 화살표**: `p` `` ` `` `->` `` ` `` `q`
5. **순열/조합/중복조합**: rm체 + `{it`_N}` 패턴으로 왼쪽 첨자
   - 순열: `{it`_n}{rm P}_{it r}`
   - 조합: `{it`_n}{rm C}_{it r}`
   - 중복순열: `{it`_n}{rm smallprod}_{it r}`
   - 중복조합: `{it`_n}{rm H}_{it r}`
6. **확률/분포**: rm체
   - `{rmP}(X=r)`, `{rmE}(X)`, `{rmV}(X)`
   - `{rmN}{it(m,~sigma^2)}`, `{rmB}(n,~p)`
7. **therefore/because 뒤**: `~` 한 칸
8. **cases 정렬**: `&` 3개, `~~`로 조건식 위치 통일, `` ` ``/`~`로 길이 보정
   - 예: `cases{ax+b~~&(x ne 1)#cx+d~~&(x=1)}`
9. **분수 괄호**: `LEFT (` `RIGHT )` — 예: `left( 1 over 2 ,~2 over 3 right)`
10. **여집합**: 소문자 `c` → `A^c`
11. **합집합/교집합**: `cup`, `cap`
12. **조건제시법**: `A=left{(n,~m)` `` ` `` `|` `` ` `` `...` `` ` `` `right}`
13. **삼각함수/로그 분수 뒤**: `1 over 2` `` ` `` `sin` `` ` `` `x` (O), `1 over 2 sinx` (X)
14. **내적**: `cdot` (bullet 아님) — `veca cdot vecb`
15. **부등호 뒤 음수**: `it` → `x<it-2` (띄어쓰기하면 `larrow`로 변환됨)
16. **극한 음수**: `lim_{x->it-2}`
17. **절댓값**: `LEFT |` `RIGHT |` 사용
18. **수식창 한글 작업 안함** (예외: 규칙 27 참조)
19. **독립줄 수식**: tab 들여쓰기 (해설 제외)
20. **왼쪽 첨자는 `{it`_N}` 패턴 필수**: `_`로 시작하는 수식 금지
21. **DEG는 숫자에 붙여쓴다**: `60DEG` (O), `60 DEG` (X)
22. **LEFT/RIGHT 대문자**: `LEFT (` `RIGHT )` (대문자 + 공백)
23. **sqrt vs root**: `sqrt` = √(제곱근), `root 3 of` = ∛(세제곱근) — 혼동 금지
24. **닮음/수직/평행 기호**:
    - 평행: 유니코드 `⫽` → `rm barAB ⫽ rm bar CD`
    - 수직: `bot` → `rmbar AB bot barCD`
    - 닮음: 유니코드 `󰁀` → `rm triangle ABC` `` ` `` `󰁀` `` ` `` `triangle DEF`
    - 합동조건도 rm체 → `rmSSS`, `rmSAS`, `rmASA`
25. **`sim` 사용 금지**: 이항/정규분포에서 `~`(sim) 대신 텍스트로 "따른다" 표현
26. **rm/it 혼합 시 중괄호 묶기**: `{rmA}(a, b)` (X) → `{rmA}{it(a,````b)}` (O)
27. **수식창 한글 작업 예외**:
    - `cases` 내부: `cases{ax+b&&&(x 가~정수일~때)#cx+d&&&(x가~정수가~아닐 때)}`
    - `box` 내부: `box{~~(가)~~}`
28. **cdotscdots 뒤 원문자**: ㉠, ㉡ 등은 **바탕글(본문)**에서 작성 (수식 내부 X)
29. **연방풀이 원문자**: 연립방정식에서 (1),(2) 대신 문자표 **㉠, ㉡** 사용

### 연산자 띄어쓰기 규칙

HWP 수식에서 공백은 항 구분자 역할이므로, **연산자 앞뒤에 반드시 공백**:

| 연산자 유형 | 잘못된 입력 | 올바른 입력 |
|------------|------------|------------|
| 등호 | `4^3=64` | `4^3 = 64` |
| 덧셈 | `x+y=3` | `x + y = 3` |
| 뺄셈 | `5-r=2` | `5 - r = 2` |
| 부등호 | `a>0` | `a > 0` |
| 복합 | `x+y+z+w=10` | `x + y + z + w = 10` |

**예외** (공백 생략 가능):
- 중괄호 내부: `2^{n-1}` — 중괄호 안은 허용
- 괄호 안 음수 부호: `(-3)` — 부호로서의 `-`
- `it` 접두 음수: `x < it-2`

### 금지

- 통수식 → 등호 단위로 끊기
- 정답 수식 bold 금지
- `bullet`로 내적 → `cdot`
- `N(m, sigma^2)` → `{rmN}{it(m,~sigma^2)}`
- `sim` 사용 → 텍스트로 "따른다" 표현
- **`_`로 시작하는 수식** → `{it`_N}` 패턴 사용 (한컴 렌더링 실패)
- **순열/조합에 `_n C _r` 패턴** → `{it`_n}{rm C}_{it r}` 패턴으로
- **연산자 앞뒤 공백 누락** → `x+y=3`이 아닌 `x + y = 3`
