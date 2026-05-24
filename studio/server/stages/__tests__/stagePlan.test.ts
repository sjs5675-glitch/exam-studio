/**
 * stagePlan.test.ts — Phase 3
 *
 * Unit tests for buildStagePlan, runBatches, and applyVerifierRetry.
 * Fixture round-trip: stage-plan-cases.json 10개 케이스 전부 검증.
 * agentic→code 동치성: SKILL.md Step 4-2 재시도 루프 fixture 검증.
 */

import { describe, expect, it } from "vitest";
import {
  buildStagePlan,
  runBatches,
  applyVerifierRetry,
  DEFAULT_BATCH_CONCURRENCY,
} from "../stagePlan";
import type { ResumeCommand } from "../resumeCommand";
import type { QuestionState } from "../resumeState";
import cases from "./fixtures/stage-plan-cases.json";

// ──────────────────────────────────────────────
// buildStagePlan — fixture round-trip (10 cases)
// ──────────────────────────────────────────────

describe("buildStagePlan — fixture round-trip", () => {
  for (const tc of cases) {
    it(`[${tc.id}] ${tc.description}`, () => {
      const resume = tc.resume as ResumeCommand;
      const states = new Map<number, QuestionState>(
        Object.entries(tc.states).map(([k, v]) => [Number(k), v as QuestionState])
      );
      const allQuestions = tc.allQuestions as number[];

      const result = buildStagePlan(resume, states, allQuestions);

      // totalQuestions must always equal allQuestions
      expect(result.totalQuestions).toEqual(allQuestions);

      // perQuestion must match expected
      expect(result.perQuestion).toHaveLength(tc.expected.perQuestion.length);
      for (let i = 0; i < tc.expected.perQuestion.length; i++) {
        const exp = tc.expected.perQuestion[i]!;
        const got = result.perQuestion[i]!;
        expect(got.questionNumber).toBe(exp.questionNumber);
        expect(got.stages).toEqual(exp.stages);
      }
    });
  }
});

// ──────────────────────────────────────────────
// runBatches
// ──────────────────────────────────────────────

describe("runBatches", () => {
  it("runs all items and returns results in input order", async () => {
    const signal = new AbortController().signal;
    const items = [1, 2, 3, 4, 5];
    const results = await runBatches({
      concurrency: 2,
      items,
      worker: async (n) => n * 10,
      signal,
    });
    expect(results).toHaveLength(5);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50]);
  });

  it("captures individual failures without re-throwing", async () => {
    const signal = new AbortController().signal;
    const results = await runBatches({
      concurrency: 3,
      items: [1, 2, 3],
      worker: async (n) => {
        if (n === 2) throw new Error("item 2 failed");
        return n;
      },
      signal,
    });
    expect(results[0]).toMatchObject({ ok: true, value: 1 });
    expect(results[1]).toMatchObject({ ok: false });
    expect((results[1] as { ok: false; error: Error }).error.message).toBe("item 2 failed");
    expect(results[2]).toMatchObject({ ok: true, value: 3 });
  });

  it("respects concurrency limit", async () => {
    const signal = new AbortController().signal;
    let concurrent = 0;
    let maxConcurrent = 0;

    await runBatches({
      concurrency: 2,
      items: [1, 2, 3, 4, 5],
      worker: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      },
      signal,
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("calls onProgress for each item", async () => {
    const signal = new AbortController().signal;
    const progressLog: Array<{ done: number; total: number }> = [];

    await runBatches({
      concurrency: 2,
      items: [1, 2, 3],
      worker: async (n) => n,
      onProgress: (done, total) => progressLog.push({ done, total }),
      signal,
    });

    // 3 calls — one per item
    expect(progressLog).toHaveLength(3);
    expect(progressLog[progressLog.length - 1]).toMatchObject({ done: 3, total: 3 });
  });

  it("skips (ok:false AbortError) items when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const signal = controller.signal;

    const results = await runBatches({
      concurrency: 2,
      items: [1, 2, 3],
      worker: async (n) => n,
      signal,
    });
    // All items should be captured as { ok: false } with AbortError
    for (const r of results) {
      expect(r.ok).toBe(false);
    }
  });

  it("DEFAULT_BATCH_CONCURRENCY is 8", () => {
    expect(DEFAULT_BATCH_CONCURRENCY).toBe(8);
  });

  it("handles empty items array", async () => {
    const signal = new AbortController().signal;
    const results = await runBatches({
      concurrency: 4,
      items: [],
      worker: async () => "x",
      signal,
    });
    expect(results).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// applyVerifierRetry — agentic→code 동치성
// ──────────────────────────────────────────────

describe("applyVerifierRetry — agentic→code parity (SKILL.md Step 4-2)", () => {
  it("passes on first attempt when verifier returns pass immediately", async () => {
    let solverCalls = 0;
    let verifierCalls = 0;

    const result = await applyVerifierRetry(
      async () => { solverCalls++; return { answer: "①" }; },
      async () => { verifierCalls++; return { status: "pass" }; },
      { maxAttempts: 3 }
    );

    expect(result.status).toBe("pass");
    expect(result.attempts).toBe(1);
    expect(solverCalls).toBe(1);   // initial solver call only
    expect(verifierCalls).toBe(1);
    expect(result.feedbackHistory).toHaveLength(0);
  });

  it("retries solver once on first verifier fail, passes on second verifier", async () => {
    let solverCalls = 0;
    let verifierCalls = 0;
    const feedbackReceived: Array<string | undefined> = [];

    const result = await applyVerifierRetry(
      async (feedback) => {
        solverCalls++;
        feedbackReceived.push(feedback);
        return { answer: "①" };
      },
      async () => {
        verifierCalls++;
        if (verifierCalls === 1) return { status: "fail", feedback: "fix calculation" };
        return { status: "pass" };
      },
      { maxAttempts: 3 }
    );

    expect(result.status).toBe("pass");
    expect(result.attempts).toBe(2);
    expect(solverCalls).toBe(2);   // initial + 1 retry
    expect(verifierCalls).toBe(2);
    expect(feedbackReceived[0]).toBeUndefined();  // first call has no feedback
    expect(feedbackReceived[1]).toBe("fix calculation");
    expect(result.feedbackHistory).toEqual(["fix calculation"]);
  });

  it("adopts the solver revision after 3 verifier feedback rounds", async () => {
    let verifierCalls = 0;
    let solverCalls = 0;
    const failAttempts: number[] = [];

    const result = await applyVerifierRetry(
      async () => ({ answer: `revision-${++solverCalls}` }),
      async () => {
        verifierCalls++;
        return { status: "fail", feedback: `feedback-${verifierCalls}` };
      },
      {
        maxAttempts: 3,
        onAttemptFail: (attempt) => failAttempts.push(attempt),
      }
    );

    expect(result.status).toBe("revised");
    expect(result.attempts).toBe(3);
    expect(verifierCalls).toBe(3);
    expect(solverCalls).toBe(4); // initial + one solver revision per failed round
    expect(result.feedbackHistory).toHaveLength(3);
    expect(failAttempts).toHaveLength(3);
    expect(result.finalSolverOutput).toEqual({ answer: "revision-4" });
  });

  it("onAttemptFail is called with correct attempt and feedback on each failure", async () => {
    const failLog: Array<{ attempt: number; feedback: string }> = [];
    let calls = 0;

    await applyVerifierRetry(
      async () => ({}),
      async () => {
        calls++;
        return { status: "fail", feedback: `fb-${calls}` };
      },
      {
        maxAttempts: 3,
        onAttemptFail: (attempt, feedback) => failLog.push({ attempt, feedback }),
      }
    );

    expect(failLog).toHaveLength(3);
    expect(failLog[0]).toMatchObject({ attempt: 1, feedback: "fb-1" });
    expect(failLog[1]).toMatchObject({ attempt: 2, feedback: "fb-2" });
    expect(failLog[2]).toMatchObject({ attempt: 3, feedback: "fb-3" });
  });

  it("finalSolverOutput reflects last solver call", async () => {
    let solverVersion = 0;

    const result = await applyVerifierRetry(
      async () => ({ version: ++solverVersion }),
      async () => ({
        status: solverVersion >= 2 ? ("pass" as const) : ("fail" as const),
        feedback: "try again",
      }),
      { maxAttempts: 3 }
    );

    expect(result.status).toBe("pass");
    expect((result.finalSolverOutput as { version: number }).version).toBe(2);
  });

  it("maxAttempts=1 still applies verifier feedback through one solver revision", async () => {
    let solverCalls = 0;
    const feedbackReceived: Array<string | undefined> = [];

    const result = await applyVerifierRetry(
      async (feedback) => {
        solverCalls++;
        feedbackReceived.push(feedback);
        return { revision: solverCalls };
      },
      async () => ({ status: "fail" as const, feedback: "nope" }),
      { maxAttempts: 1 }
    );

    expect(result.status).toBe("revised");
    expect(result.attempts).toBe(1);
    expect(solverCalls).toBe(2); // initial + feedback revision
    expect(feedbackReceived).toEqual([undefined, "nope"]);
    expect(result.finalSolverOutput).toEqual({ revision: 2 });
  });
});
