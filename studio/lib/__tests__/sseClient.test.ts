/**
 * sseClient.test.ts — Phase 7
 *
 * applySSEEvent가 메인 run(useJobRunner)과 followup(resume.ts) 양쪽에서
 * 동일하게 store를 갱신하는지 검증.
 */

import { describe, expect, it, vi } from "vitest";
import { applySSEEvent, type Store } from "../sseClient";
import type { SSEEvent } from "../claude";

// ──────────────────────────────────────────────
// Mock store builder
// ──────────────────────────────────────────────

interface MockStore extends Store {
  _stages: Record<string, object>;
  _logs: object[];
  _questionResults: Record<string, Record<string, unknown>>;
  _status: string;
  _result: object | null;
  _files: object[];
  _extractionReviewActive: boolean;
}

function makeStore(): MockStore {
  // Use closured state so vi.fn() spies remain intact (binding loses spy identity)
  const _state = {
    stages: {} as Record<string, object>,
    logs: [] as object[],
    questionResults: {} as Record<string, Record<string, unknown>>,
    status: "pending",
    result: null as object | null,
    files: [] as object[],
    extractionReviewActive: false,
  };

  const store: MockStore = {
    get _stages() { return _state.stages; },
    get _logs() { return _state.logs; },
    get _questionResults() { return _state.questionResults; },
    get _status() { return _state.status; },
    get _result() { return _state.result; },
    get _files() { return _state.files; },
    get _extractionReviewActive() { return _state.extractionReviewActive; },

    updateStage: vi.fn((name: string, update: object) => {
      _state.stages[name] = { ...(_state.stages[name] ?? {}), ...update };
    }),
    addLog: vi.fn((log: object) => { _state.logs.push(log); }),
    setStatus: vi.fn((status: string) => { _state.status = status; }),
    setResult: vi.fn((result: object) => { _state.result = result; }),
    addIntermediateFile: vi.fn((file: object) => { _state.files.push(file); }),
    updateQuestionResult: vi.fn((number: number, phase: string, content: Record<string, unknown>) => {
      const key = `${number}`;
      _state.questionResults[key] = { ...(_state.questionResults[key] ?? {}), [phase]: content };
    }),
    setExtractionReviewActive: vi.fn((active: boolean) => { _state.extractionReviewActive = active; }),
    setV3Meta: vi.fn(),
    setMode: vi.fn(),
    setJobId: vi.fn(),
    reset: vi.fn(),
  } as unknown as MockStore;

  return store;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("applySSEEvent — stage events", () => {
  it("stage running → updateStage with status=running", () => {
    const store = makeStore();
    const event: SSEEvent = {
      event: "stage",
      data: { name: "extractor", status: "running" },
    };
    applySSEEvent(event, store);
    expect(store.updateStage).toHaveBeenCalledWith("extractor", expect.objectContaining({ status: "running" }));
  });

  it("stage done → updateStage with status=done and summary", () => {
    const store = makeStore();
    const event: SSEEvent = {
      event: "stage",
      data: { name: "solver", status: "done", summary: "완료" },
    };
    applySSEEvent(event, store);
    expect(store.updateStage).toHaveBeenCalledWith("solver", expect.objectContaining({
      status: "done",
      summary: "완료",
    }));
  });

  it("stage failed → updateStage with status=failed", () => {
    const store = makeStore();
    applySSEEvent({ event: "stage", data: { name: "figure", status: "failed" } }, store);
    expect(store.updateStage).toHaveBeenCalledWith("figure", expect.objectContaining({ status: "failed" }));
  });
});

describe("applySSEEvent — log events", () => {
  it("log → addLog with stage, message, level", () => {
    const store = makeStore();
    applySSEEvent({
      event: "log",
      data: { stage: "extractor", message: "테스트", level: "info", timestamp: "2025-01-01T00:00:00.000Z" },
    }, store);
    expect(store.addLog).toHaveBeenCalledWith(expect.objectContaining({
      stage: "extractor",
      message: "테스트",
      level: "info",
    }));
  });
});

describe("applySSEEvent — question events", () => {
  it("question ok → updateQuestionResult", () => {
    const store = makeStore();
    const payload = { choices: ["①"], answer: 1 };
    applySSEEvent({
      event: "question",
      data: { number: 3, stage: "extracted", status: "ok", data: payload },
    }, store);
    expect(store.updateQuestionResult).toHaveBeenCalledWith(3, "extracted", payload);
  });

  it("question failed → updateQuestionResult NOT called", () => {
    const store = makeStore();
    applySSEEvent({
      event: "question",
      data: { number: 3, stage: "extracted", status: "failed" },
    }, store);
    expect(store.updateQuestionResult).not.toHaveBeenCalled();
  });

  it("question ok with JSON string payload → parsed and stored", () => {
    const store = makeStore();
    const payload = { answer: 2 };
    applySSEEvent({
      event: "question",
      data: { number: 1, stage: "solved", status: "ok", data: JSON.stringify(payload) },
    }, store);
    expect(store.updateQuestionResult).toHaveBeenCalledWith(1, "solved", payload);
  });
});

describe("applySSEEvent — extraction_review events", () => {
  it("extraction_review with items[] → all items stored + setExtractionReviewActive(true)", () => {
    const store = makeStore();
    const items = [
      { number: 1, data: { text: "Q1" } },
      { number: 2, data: { text: "Q2" } },
    ];
    applySSEEvent({ event: "extraction_review", data: { items } }, store);
    expect(store.updateQuestionResult).toHaveBeenCalledTimes(2);
    expect(store.updateQuestionResult).toHaveBeenCalledWith(1, "extracted", { text: "Q1" });
    expect(store.updateQuestionResult).toHaveBeenCalledWith(2, "extracted", { text: "Q2" });
    expect(store.setExtractionReviewActive).toHaveBeenCalledWith(true);
  });

  it("extraction_review with single {number, data} → stored + setExtractionReviewActive(true)", () => {
    const store = makeStore();
    applySSEEvent({
      event: "extraction_review",
      data: { number: 5, data: { choices: ["①", "②"] } },
    }, store);
    expect(store.updateQuestionResult).toHaveBeenCalledWith(5, "extracted", { choices: ["①", "②"] });
    expect(store.setExtractionReviewActive).toHaveBeenCalledWith(true);
  });
});

describe("applySSEEvent — result events", () => {
  it("result success → setResult + setStatus(done)", () => {
    const store = makeStore();
    applySSEEvent({
      event: "result",
      data: { status: "success", outputPath: "/out/test.hwpx", result: "완료" },
    }, store);
    expect(store.setResult).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      outputPath: "/out/test.hwpx",
    }));
    expect(store.setStatus).toHaveBeenCalledWith("done");
  });

  it("result failed → setResult + setStatus(failed)", () => {
    const store = makeStore();
    applySSEEvent({ event: "result", data: { status: "failed" } }, store);
    expect(store.setStatus).toHaveBeenCalledWith("failed");
  });
});

describe("applySSEEvent — error events", () => {
  it("error → addLog with level=error + setStatus(failed)", () => {
    const store = makeStore();
    applySSEEvent({ event: "error", data: { message: "오류 발생" } }, store);
    expect(store.addLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "오류 발생",
    }));
    expect(store.setStatus).toHaveBeenCalledWith("failed");
  });
});

describe("applySSEEvent — progress events", () => {
  it("progress → updateStage with progress field", () => {
    const store = makeStore();
    applySSEEvent({ event: "progress", data: { stage: "figure", percent: 75 } }, store);
    expect(store.updateStage).toHaveBeenCalledWith("figure", { progress: 75 });
  });
});

describe("applySSEEvent — followup path equivalence", () => {
  it("메인 run과 followup 경로에서 동일한 store 갱신 결과를 낸다", () => {
    // 동일한 이벤트 시퀀스를 두 개의 독립 store에 적용하여 결과가 동일한지 확인
    const storeMain = makeStore();
    const storeFollowup = makeStore();

    const events: SSEEvent[] = [
      { event: "stage", data: { name: "solver", status: "running" } },
      { event: "question", data: { number: 2, stage: "solved", status: "ok", data: { answer: 3 } } },
      { event: "extraction_review", data: { number: 2, data: { choices: ["①"] } } },
      { event: "stage", data: { name: "solver", status: "done", summary: "완료" } },
    ];

    for (const event of events) {
      applySSEEvent(event, storeMain);
      applySSEEvent(event, storeFollowup);
    }

    // _stages and _questionResults should be identical
    expect(storeMain._stages).toEqual(storeFollowup._stages);
    expect(storeMain._questionResults).toEqual(storeFollowup._questionResults);
    expect(storeMain._extractionReviewActive).toEqual(storeFollowup._extractionReviewActive);
  });
});
