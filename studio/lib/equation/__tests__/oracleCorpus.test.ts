import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseModelJsonOutput } from "@/server/stages/modelHarness";
import { convertProblemEquations } from "../convertProblemEquations";
import { EQ_SENTINEL_OPEN as O, EQ_SENTINEL_CLOSE as C } from "@/server/stages/equationSentinel";

/**
 * 대규모 수식 회귀 — 외부 레퍼런스 코퍼스(골드 수식 8만여 건의 {h, L} 쌍)를 전체 파이프라인에
 * 통과시켜 구조 불변식을 검증한다. 과거 분수/우극한/순열 변환 버그가 모두 이 불변식(빈출력·
 * 백슬래시누수·중괄호불균형·모드불일치)으로 드러났다.
 *
 * 코퍼스는 사유 데이터라 repo 에 포함되지 않는다(.gitignore). 경로는 환경변수 EQ_ORACLE_CORPUS
 * 또는 기본값(repo 루트의 .equation-oracle/corpus.json). 코퍼스가 없으면 이 테스트는 skip 되므로
 * 코퍼스 없이 clone 한 환경/CI 에서는 무해하다.
 *
 * 코퍼스 형식: { meta, pairs: [{ h: <골드 HWP>, L: <LaTeX 입력> }] }
 */
const CORPUS_PATH =
  process.env.EQ_ORACLE_CORPUS ||
  path.resolve(process.cwd(), "..", ".equation-oracle", "corpus.json");

// 알려진 baseline: 중괄호 불균형은 `LEFT { … RIGHT .`(반열림 델리미터 — HWP 정상)와 코퍼스의
// malformed 입력에서만 발생하며 깨끗한 입력엔 0. 이 수치보다 늘면 새 회귀로 간주해 실패시킨다.
const MAX_BRACE_IMBALANCE = 91;

const jsonEsc = (s: string) => JSON.stringify(s).slice(1, -1); // 유효 JSON(이중 백슬래시) 형태

function pipe(innerForJson: string): string | null {
  const parsed = parseModelJsonOutput(`{"eq":"${O}${innerForJson}${C}"}`);
  if (!parsed.ok) return null;
  return (convertProblemEquations(parsed.value) as { eq: string }).eq;
}

const hasCorpus = existsSync(CORPUS_PATH);
const maybe = hasCorpus ? it : it.skip;

describe("equation reference corpus regression", () => {
  if (!hasCorpus) {
    it.skip(`코퍼스 없음 → skip (${CORPUS_PATH})`, () => {});
  }

  maybe(
    "전체 코퍼스: 파싱실패·빈출력·백슬래시누수·모드불일치 0, 중괄호불균형 ≤ baseline",
    () => {
      const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as {
        pairs: Array<{ h: string; L: string }>;
      };
      const pairs = corpus.pairs;
      expect(pairs.length).toBeGreaterThan(1000);

      let parseFail = 0,
        empty = 0,
        leak = 0,
        imbalance = 0,
        modeMismatch = 0;
      const samples: string[] = [];
      const note = (s: string) => {
        if (samples.length < 12) samples.push(s);
      };

      for (const { L } of pairs) {
        const dbl = pipe(jsonEsc(L)); // codex 스타일(유효 JSON)
        const sgl = pipe(L); // claude 스타일(단일 백슬래시 raw)
        if (dbl === null || sgl === null) {
          parseFail++;
          note(`PARSE-FAIL: ${L}`);
          continue;
        }
        if (dbl !== sgl) {
          modeMismatch++;
          note(`MODE-MISMATCH: ${L}\n  single=${sgl}\n  double=${dbl}`);
        }
        const H = dbl;
        if (!H.trim() && L.trim()) {
          empty++;
          note(`EMPTY: ${L}`);
        }
        if (/\\/.test(H)) {
          leak++;
          note(`LEAK: ${L} -> ${H}`);
        }
        if (((H.match(/{/g) || []).length - (H.match(/}/g) || []).length) !== 0) {
          imbalance++;
        }
      }

      const summary =
        `corpus=${pairs.length} parseFail=${parseFail} empty=${empty} ` +
        `leak=${leak} modeMismatch=${modeMismatch} imbalance=${imbalance}`;
      if (parseFail || empty || leak || modeMismatch || imbalance > MAX_BRACE_IMBALANCE) {
        // 실패 시 로컬 디버깅용 샘플 출력(코퍼스 데이터는 로컬에만 존재).
        console.error(summary + "\n" + samples.join("\n"));
      }

      expect(parseFail, summary).toBe(0);
      expect(empty, summary).toBe(0);
      expect(leak, summary).toBe(0);
      expect(modeMismatch, summary).toBe(0);
      expect(imbalance, summary).toBeLessThanOrEqual(MAX_BRACE_IMBALANCE);
    },
    60_000
  );
});
