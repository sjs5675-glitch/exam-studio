import { mkdtemp, rm, readFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExtractorStage, validateExtractorOutput, sanitizeExtractedChoices } from "../extractor";
import { buildExtractorPrompt } from "../prompts/extractorPrompt";
import { FileBackedStageCache } from "../cache";
import type { AIProviderAdapter, ProviderRunOptions } from "@/lib/ai/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "extractor-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  await mkdir(cacheDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

/** Minimal valid extractor output JSON */
const VALID_OUTPUT = {
  number: 1,
  type: "choice",
  score: "4.2",
  difficulty: "중",
  subtopic: "삼각함수",
  question: "다음 중 옳은 것은?",
  has_figure: false,
  figure_info: null,
  parts: [{ t: "다음 중 옳은 것은?" }],
  choices: [
    [{ eq: "1" }],
    [{ eq: "2" }],
    [{ eq: "3" }],
    [{ eq: "4" }],
    [{ eq: "5" }],
  ],
  condition_box: null,
  bogi_box: null,
  data_table: null,
  answer: "①",
};

/**
 * Build a mock AIProviderAdapter that returns the given JSON string (or raw
 * string) as the assistant message, then exits with exitCode.
 *
 * supportsTools defaults to true so that runExtractorStage (which requires
 * tool-capable providers) works in most tests. Pass supportsTools=false to
 * test the error path.
 */
function makeMockProvider(
  responseJson: string,
  exitCode = 0,
  runSpy?: ReturnType<typeof vi.fn>,
  supportsTools = true
): AIProviderAdapter {
  const runFn = runSpy ?? vi.fn();

  return {
    id: "claude-sdk",
    label: "Mock Provider",
    supportsTools,
    run(prompt: string, options?: ProviderRunOptions) {
      runFn(prompt, options);

      let exitResolve: (code: number) => void = () => undefined;
      const exitCodePromise = new Promise<number>((resolve) => {
        exitResolve = resolve;
      });

      async function* events() {
        if (exitCode === 0) {
          yield {
            type: "assistant" as const,
            message: {
              role: "assistant" as const,
              content: [{ type: "text" as const, text: responseJson }],
            },
          };
        }
        yield { type: "result" as const, subtype: exitCode === 0 ? ("success" as const) : ("error" as const), result: responseJson };
        exitResolve(exitCode);
      }

      return {
        process: {} as import("child_process").ChildProcess,
        events: events(),
        exitCode: exitCodePromise,
        metadata: {
          requestedProvider: "claude-sdk",
          provider: "claude-sdk",
          label: "Mock Provider",
        },
      };
    },
  };
}

// ─── runExtractorStage ────────────────────────────────────────────────────────

describe("runExtractorStage", () => {
  it("returns completed and writes cache file on valid JSON response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT));

    const result = await runExtractorStage({
      questionNumber: 1,
      imagePath: "/some/path/q01.png",
      cache,
      provider,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
    expect(result.output?.has_figure).toBe(false);

    // Cache file must have been written
    const cachePath = cache.extractorResultPath(1);
    const written = JSON.parse(await readFile(cachePath, "utf8")) as typeof VALID_OUTPUT;
    expect(written.answer).toBe("①");
  });

  it("returns failed on invalid JSON response (validation failure)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Completely non-JSON output
    const provider = makeMockProvider("이것은 JSON이 아닙니다.");

    const result = await runExtractorStage({
      questionNumber: 2,
      imagePath: "/some/path/q02.png",
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("model_json_parse_failed");
  });

  it("returns failed with provider_failed code when exit code != 0", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    const provider = makeMockProvider("", 1);

    const result = await runExtractorStage({
      questionNumber: 3,
      imagePath: "/some/path/q03.png",
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("extractor_provider_failed");
  });

  it("returns validation failure when has_figure=true but description_en contains Korean", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    const badOutput = {
      ...VALID_OUTPUT,
      has_figure: true,
      figure_info: {
        description_en: "그래프 그림",  // Korean characters — must fail
        position: "right",
        crop_ratio: [0.5, 0.1, 1.0, 0.9],
      },
    };

    const provider = makeMockProvider(JSON.stringify(badOutput));

    const result = await runExtractorStage({
      questionNumber: 4,
      imagePath: "/some/path/q04.png",
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Korean");
  });

  it("passes imagePaths and stageKey to provider.run", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    const spy = vi.fn();
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT), 0, spy);

    const imagePath = "/abs/path/q01.png";

    await runExtractorStage({
      questionNumber: 1,
      imagePath,
      cache,
      provider,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, options] = spy.mock.calls[0] as [string, ProviderRunOptions];
    expect(options.stageKey).toBe("create.extractor");
    expect(options.imagePaths).toEqual([imagePath]);
  });
});

// ─── validateExtractorOutput ──────────────────────────────────────────────────

describe("validateExtractorOutput", () => {
  it("passes for valid output with has_figure=false", () => {
    const result = validateExtractorOutput(VALID_OUTPUT);
    expect(result.ok).toBe(true);
  });

  it("passes for valid output with has_figure=true and English description_en", () => {
    const input = {
      ...VALID_OUTPUT,
      has_figure: true,
      figure_info: {
        description_en: "A graph showing a sine curve",
        position: "right",
        crop_ratio: [0.5, 0.0, 1.0, 0.5],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  it("passes when answer is missing (extractor는 answer를 추출하지 않음 — solver 책임)", () => {
    const rest: Partial<typeof VALID_OUTPUT> = { ...VALID_OUTPUT };
    delete rest.answer;
    const result = validateExtractorOutput(rest);
    expect(result.ok).toBe(true);
  });

  it("fails when answer is present but wrong type", () => {
    const result = validateExtractorOutput({ ...VALID_OUTPUT, answer: true });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("answer");
  });

  it("passes when question is missing (parts 배열이 본문 — question은 optional)", () => {
    const withoutQuestion: Record<string, unknown> = { ...VALID_OUTPUT };
    delete withoutQuestion.question;
    const result = validateExtractorOutput(withoutQuestion);
    expect(result.ok).toBe(true);
  });

  it("fails when question is present but empty/whitespace string", () => {
    const result = validateExtractorOutput({ ...VALID_OUTPUT, question: "   " });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("question");
  });

  it("fails when has_figure is not boolean", () => {
    const result = validateExtractorOutput({ ...VALID_OUTPUT, has_figure: "yes" });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("has_figure");
  });

  it("fails when choices length is outside 3-5", () => {
    const result = validateExtractorOutput({ ...VALID_OUTPUT, choices: [[{ eq: "1" }]] });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("choices");
  });

  it("fails when crop_ratio has wrong number of elements", () => {
    const result = validateExtractorOutput({
      ...VALID_OUTPUT,
      has_figure: true,
      figure_info: {
        description_en: "A figure",
        crop_ratio: [0.1, 0.2],  // only 2 elements
      },
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("crop_ratio");
  });

  it("fails when crop_ratio values are outside [0, 1]", () => {
    const result = validateExtractorOutput({
      ...VALID_OUTPUT,
      has_figure: true,
      figure_info: {
        description_en: "A figure",
        crop_ratio: [0.1, 0.2, 1.5, 0.9],  // 1.5 is out of range
      },
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("crop_ratio");
  });

  it("fails when description_en contains Korean characters", () => {
    const result = validateExtractorOutput({
      ...VALID_OUTPUT,
      has_figure: true,
      figure_info: {
        description_en: "사인 곡선 그래프",
        position: "center",
      },
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("Korean");
  });

  it("passes when parts is missing (parts is optional)", () => {
    const withoutParts: Record<string, unknown> = { ...VALID_OUTPUT };
    delete withoutParts.parts;
    const result = validateExtractorOutput(withoutParts);
    expect(result.ok).toBe(true);
  });

  it("fails when parts is present but not an array", () => {
    const result = validateExtractorOutput({ ...VALID_OUTPUT, parts: "not an array" });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("parts");
  });
});

// ─── Phase 3: new type tag validation ────────────────────────────────────────

describe("validateExtractorOutput — new type tags (Phase 3)", () => {
  /** bogi type — condition_box with type="bogi" */
  it("passes for bogi condition_box with 3 items", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "bogi",
        items: [
          { parts: [{ t: "ㄱ. 항목1" }] },
          { parts: [{ eq: "x > 0" }] },
          { parts: [{ t: "ㄷ. 항목3" }] },
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** proposition type — choice_table with table_type="proposition" */
  it("passes for choice_table with table_type=proposition (5x5 명제 테이블)", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "choice_table",
        table_type: "proposition",
        rows: [
          ["h1", "c1"], ["h2", "c2"], ["h3", "c3"], ["h4", "c4"], ["h5", "c5"],
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** choice_image type — choice_table with table_type="choice_image" */
  it("passes for choice_table with table_type=choice_image (그림 5선지)", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "choice_table",
        table_type: "choice_image",
        rows: [],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** choice_grid_2cols — (가)(나) 2열 선지 */
  it("passes for choice_table with table_type=choice_grid_2cols", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "choice_table",
        table_type: "choice_grid_2cols",
        rows: [
          ["", "(가)", "(나)"],
          ["①", "v1", "v2"],
          ["②", "v3", "v4"],
          ["③", "v5", "v6"],
          ["④", "v7", "v8"],
          ["⑤", "v9", "v10"],
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** choice_grid_3cols — (가)(나)(다) 3열 선지 */
  it("passes for choice_table with table_type=choice_grid_3cols", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "choice_table",
        table_type: "choice_grid_3cols",
        rows: [
          ["", "(가)", "(나)", "(다)"],
          ["①", "v1", "v2", "v3"],
          ["②", "v4", "v5", "v6"],
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** increase_decrease — explanation_table */
  it("passes for increase_decrease explanation_table", () => {
    const input = {
      ...VALID_OUTPUT,
      explanation_table: {
        type: "increase_decrease",
        x_values: ["a", "b"],
        rows: [
          { label: "f prime(x)", values: ["+", "0", "-"] },
          { label: "f(x)", values: ["NEARROW", "극대", "SEARROW"] },
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** normal_dist — data_table */
  it("passes for normal_dist data_table with row_parts", () => {
    const input = {
      ...VALID_OUTPUT,
      data_table: {
        type: "normal_dist",
        row_parts: [
          [[{ eq: "1.0" }], [{ eq: "0.3413" }]],
          [[{ eq: "1.5" }], [{ eq: "0.4332" }]],
          [[{ eq: "2.0" }], [{ eq: "0.4772" }]],
        ],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** probability — data_table */
  it("passes for probability data_table with header_parts and row_parts", () => {
    const input = {
      ...VALID_OUTPUT,
      data_table: {
        type: "probability",
        header_parts: [[{ eq: "0" }], [{ eq: "1" }], [{ eq: "2" }]],
        row_parts: [[{ eq: "1 over 3" }], [{ eq: "1 over 3" }], [{ eq: "1 over 3" }]],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });

  /** backward compat — old table_type "5x5" still accepted */
  it("passes for choice_table with legacy table_type=5x5 (backward compat)", () => {
    const input = {
      ...VALID_OUTPUT,
      condition_box: {
        type: "choice_table",
        table_type: "5x5",
        rows: [["h1", "c1"], ["h2", "c2"], ["h3", "c3"], ["h4", "c4"], ["h5", "c5"]],
      },
    };
    const result = validateExtractorOutput(input);
    expect(result.ok).toBe(true);
  });
});

// ─── Phase 2: agentic extractor — prompt + tool call tests ───────────────────

describe("buildExtractorPrompt — agentic Read guidance (Phase 2)", () => {
  it("system prompt does NOT contain [REF_DOC_SECTION] placeholder", () => {
    const { system } = buildExtractorPrompt({ questionNumber: 1 });
    expect(system).not.toContain("[REF_DOC_SECTION]");
  });

  it("system prompt instructs LLM to Read docs/extractor-reference/ for syn_div/pascal", () => {
    const { system } = buildExtractorPrompt({ questionNumber: 1 });
    expect(system).toContain("docs/extractor-reference/");
    expect(system).toContain("syn_div_pascal.md");
  });

  it("system prompt does NOT contain inline reference doc content (no host-inject text)", () => {
    const { system } = buildExtractorPrompt({ questionNumber: 1 });
    // The old injected header — must be absent now
    expect(system).not.toContain("첨부 Reference 문서 (syn_div / Pascal 셀 형식)");
    expect(system).not.toContain("reference 문서 미첨부");
  });
});

describe("runExtractorStage — supportsTools guard (Phase 2)", () => {
  it("returns extractor_provider_unsupported_tools error when provider.supportsTools=false", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Simulate a non-agentic provider (claude-sdk, openai-sdk, deepseek-v4)
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT), 0, undefined, false);

    const result = await runExtractorStage({
      questionNumber: 1,
      imagePath: "/some/q01.png",
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("extractor_provider_unsupported_tools");
    expect(result.error?.retryable).toBe(false);
  });

  it("succeeds when provider.supportsTools=true (tool-capable provider)", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // supportsTools=true (default in makeMockProvider)
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT));

    const result = await runExtractorStage({
      questionNumber: 1,
      imagePath: "/some/q01.png",
      cache,
      provider,
    });

    expect(result.status).toBe("completed");
  });
});

describe("runExtractorStage — agentic options (Phase 2)", () => {
  it("passes maxTurns=5 and read-only allowedTools (Read/Grep/Glob) to provider.run", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    const spy = vi.fn();
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT), 0, spy);

    await runExtractorStage({
      questionNumber: 1,
      imagePath: "/some/q01.png",
      cache,
      provider,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, options] = spy.mock.calls[0] as [string, ProviderRunOptions];
    expect(options.maxTurns).toBe(5);
    expect(options.allowedTools).toEqual(["Read", "Grep", "Glob"]);
  });
});

// ─── Phase 4: 4-provider parametric cross-provider e2e ───────────────────────

/**
 * Helper factories that return a mock AIProviderAdapter mimicking each of the
 * 4 real providers. CLI providers (claude-cli, codex-cli) cannot be invoked in
 * a unit-test environment, so we use the same mock pattern as the existing tests
 * but label them with the correct provider id.
 */
function makeMockClaudeCliProvider(): AIProviderAdapter {
  return { ...makeMockProvider(JSON.stringify(VALID_OUTPUT)), id: "claude-cli" as const, label: "Claude CLI" };
}

function makeMockCodexCliProvider(): AIProviderAdapter {
  return { ...makeMockProvider(JSON.stringify(VALID_OUTPUT)), id: "codex-cli" as const, label: "Codex CLI" };
}

function makeMockClaudeSdkProvider(): AIProviderAdapter {
  return { ...makeMockProvider(JSON.stringify(VALID_OUTPUT)), label: "Claude SDK" };
}

function makeMockOpenaiSdkProvider(): AIProviderAdapter {
  return { ...makeMockProvider(JSON.stringify(VALID_OUTPUT)), id: "openai-sdk" as const, label: "OpenAI SDK" };
}

describe.each([
  ["claude-cli", makeMockClaudeCliProvider],
  ["codex-cli", makeMockCodexCliProvider],
  ["claude-sdk", makeMockClaudeSdkProvider],
  ["openai-sdk", makeMockOpenaiSdkProvider],
] as const)(
  "extractor with provider %s (Phase 4 cross-provider)",
  (_label, providerFactory) => {
    it("completes Read(ref doc) → JSON output flow", async () => {
      const base = await makeTempDir();
      const cache = await makeCache(base);
      const provider = providerFactory();

      const result = await runExtractorStage({
        questionNumber: 1,
        imagePath: "/some/q01.png",
        cache,
        provider,
      });

      expect(result.status).toBe("completed");
      expect(result.output).toBeDefined();
      expect(result.output?.has_figure).toBe(false);
    });

    it("supportsTools=true on the provider used in this test", () => {
      const provider = providerFactory();
      expect(provider.supportsTools).toBe(true);
    });
  }
);

describe("runExtractorStage — supportsTools=false rejection preserved (Phase 4)", () => {
  it("deepseek-v4 mock (supportsTools=false) is rejected with extractor_provider_unsupported_tools", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);

    // Simulate deepseek-v4: vision not supported, supportsTools=false
    const deepseekMock: AIProviderAdapter = {
      ...makeMockProvider(JSON.stringify(VALID_OUTPUT), 0, undefined, false),
      id: "deepseek-v4" as const,
      label: "DeepSeek V4",
    };

    const result = await runExtractorStage({
      questionNumber: 1,
      imagePath: "/some/q01.png",
      cache,
      provider: deepseekMock,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("extractor_provider_unsupported_tools");
    expect(result.error?.retryable).toBe(false);
  });
});

// ─── Phase 2: sanitizeExtractedChoices unit tests ─────────────────────────────

describe("sanitizeExtractedChoices", () => {
  const BASE = {
    has_figure: false,
    figure_info: null,
  };

  it("strips standalone circled-number prefix (only t element — drops it)", () => {
    const input = {
      ...BASE,
      choices: [
        [{ t: "① " }, { eq: "-20" }],
        [{ t: "② " }, { eq: "-10" }],
        [{ t: "③ " }, { eq: "0" }],
        [{ t: "④ " }, { eq: "10" }],
        [{ t: "⑤ " }, { eq: "20" }],
      ],
    };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices).toEqual([
      [{ eq: "-20" }],
      [{ eq: "-10" }],
      [{ eq: "0" }],
      [{ eq: "10" }],
      [{ eq: "20" }],
    ]);
  });

  it("strips prefix but keeps remainder text when t has trailing content", () => {
    const input = {
      ...BASE,
      choices: [
        [{ t: "① 가" }],
        [{ t: "② 나" }],
      ],
    };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices).toEqual([
      [{ t: "가" }],
      [{ t: "나" }],
    ]);
  });

  it("is a no-op for choices that have no circled-number prefix", () => {
    const choices = [[{ eq: "1 over 6" }], [{ eq: "1 over 3" }]];
    const input = { ...BASE, choices };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices).toEqual(choices);
  });

  it("is a no-op when choices is undefined", () => {
    const input = { ...BASE };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices).toBeUndefined();
  });

  it("is a no-op when choices is null", () => {
    const input = { ...BASE, choices: null as unknown as undefined };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices).toBeNull();
  });

  it("does not mutate the original input", () => {
    const choices = [
      [{ t: "① " }, { eq: "1" }],
      [{ t: "② " }, { eq: "2" }],
    ];
    const input = { ...BASE, choices };
    sanitizeExtractedChoices(input);
    // original unchanged
    expect((input.choices[0][0] as { t: string }).t).toBe("① ");
  });

  it("handles mixed choices — some with prefix, some without", () => {
    const input = {
      ...BASE,
      choices: [
        [{ t: "① " }, { eq: "1" }], // has prefix → strip
        [{ eq: "2" }],               // no t → no-op
        [{ t: "나머지" }],            // no prefix → no-op
      ],
    };
    const result = sanitizeExtractedChoices(input);
    expect(result.choices![0]).toEqual([{ eq: "1" }]);
    expect(result.choices![1]).toEqual([{ eq: "2" }]);
    expect(result.choices![2]).toEqual([{ t: "나머지" }]);
  });
});
