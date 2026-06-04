import { writeFile } from "fs/promises";
import type { AIProviderAdapter, ProviderRunMetadata } from "@/lib/ai/types";
import { claudeSdkProvider } from "@/lib/ai/providers/claudeSdk";
import type { StageCache } from "./cache";
import {
  collectProviderText,
  parseModelJsonOutput,
  validateModelOutput,
  validationFailure,
  type ModelOutputValidation,
} from "./modelHarness";
import type { ModelStageResult } from "./model";
import type { ExamMeta } from "./prompts/extractorPrompt";
import { buildExtractorPrompt } from "./prompts/extractorPrompt";
import { convertProblemEquations } from "@/lib/equation/convertProblemEquations";
import { normalizePartTree } from "@/lib/parts/normalize";

export type { ExamMeta };

export interface ExtractorFigureInfo {
  description_en?: string;
  position?: string;
  crop_ratio?: [number, number, number, number];
}

export type ExtractorPartObject = { t: string } | { eq: string } | { br: true };
export type ExtractorChoice = ExtractorPartObject[];
export interface ExtractorPassageBox {
  parts?: ExtractorPartObject[];
  paragraphs?: ExtractorPartObject[][];
  items?: Array<{ label?: string; parts?: ExtractorPartObject[] }>;
}

export interface ExtractorStageOutput {
  question?: string;
  parts?: ExtractorPartObject[];
  choices?: ExtractorChoice[];
  answer?: string | number;
  passage_box?: ExtractorPassageBox | null;
  has_figure: boolean;
  figure_info: ExtractorFigureInfo | null;
  [key: string]: unknown;
}

export interface ExtractorStageInput {
  questionNumber: number;
  imagePath: string;
  examMeta?: ExamMeta;
  cache: StageCache;
  provider?: AIProviderAdapter;
  cwd?: string;
  signal?: AbortSignal;
}

export async function runExtractorStage(
  input: ExtractorStageInput
): Promise<ModelStageResult<ExtractorStageOutput>> {
  const startedAt = new Date().toISOString();
  const provider = input.provider ?? claudeSdkProvider;

  // Agentic extractor requires tool use (Read) to fetch reference docs.
  // Providers that don't support tools (claude-sdk, openai-sdk, deepseek-v4) cannot run this stage.
  if (!provider.supportsTools) {
    return {
      status: "failed",
      error: {
        code: "extractor_provider_unsupported_tools",
        message: `Provider "${provider.id}" does not support tool use. The extractor requires a tool-capable provider (claude-cli or codex-cli) to read reference documents via the Read tool.`,
        retryable: false,
      },
      provider: {
        requestedProvider: provider.id,
        provider: provider.id,
        modelStageKey: "create.extractor",
        label: provider.label,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const { system, user } = buildExtractorPrompt({
    questionNumber: input.questionNumber,
    imagePathHint: input.imagePath,
    examMeta: input.examMeta,
  });

  const combinedPrompt = system + "\n\n" + user;

  // maxTurns: 5 — enough for: system thinking + Read(ref doc) + JSON output
  // allowedTools: read-only set (Read/Grep/Glob). Bash/Write/Edit blocked — extractor
  // must not modify files or execute shell. Grep/Glob enable fixture discovery when
  // type tag is ambiguous (e.g., listing docs/extractor-reference/ to find matching type).
  const providerResult = provider.run(combinedPrompt, {
    stageKey: "create.extractor",
    cwd: input.cwd,
    imagePaths: [input.imagePath],
    signal: input.signal,
    maxTurns: 5,
    allowedTools: ["Read", "Grep", "Glob"],
  });

  const { text, exitCode } = await collectProviderText(providerResult);

  if (exitCode !== 0) {
    return {
      status: "failed",
      error: {
        code: "extractor_provider_failed",
        message: `Extractor provider failed with exit code ${exitCode}`,
        retryable: true,
      },
      provider: {
        requestedProvider: providerResult.metadata.requestedProvider,
        provider: providerResult.metadata.provider,
        modelStageKey: "create.extractor",
        label: providerResult.metadata.label,
        externalCostUsd: providerResult.metadata.externalCostUsd,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const parsed = parseModelJsonOutput(text);
  if (!parsed.ok) {
    return toExtractorValidationFailure(parsed, providerResult.metadata, startedAt);
  }

  const validation = validateModelOutput(parsed.value, validateExtractorOutput);
  if (!validation.ok) {
    return toExtractorValidationFailure(
      validationFailure("extractor_validation_failed", validation.message, validation.details),
      providerResult.metadata,
      startedAt
    );
  }

  await input.cache.ensureCacheDir();
  const outputPath = input.cache.extractorResultPath(input.questionNumber);
  // 프롬프트가 LaTeX 로 출력 → 캐시에 쓰기 전 HWP 수식으로 변환 (R-01~R-10 후처리는 equation.py).
  const converted = convertProblemEquations(validation.output);
  const normalized = normalizePartTree(converted);
  const sanitized = sanitizeSharedQuestionRanges(sanitizeExtractedChoices(normalized));
  await writeFile(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");

  return {
    status: "completed",
    output: sanitized,
    files: [{ path: outputPath, kind: "cache", label: "Extractor result", mimeType: "application/json" }],
    validation: { ok: true, output: sanitized },
    provider: {
      requestedProvider: providerResult.metadata.requestedProvider,
      provider: providerResult.metadata.provider,
      modelStageKey: "create.extractor",
      label: providerResult.metadata.label,
      externalCostUsd: providerResult.metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

export function validateExtractorOutput(value: unknown): ModelOutputValidation<ExtractorStageOutput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "extractor output must be a non-null object" };
  }

  const candidate = value as Record<string, unknown>;

  // answer: extractor는 정답을 추출하지 않는다 (solver 책임). 응답에 포함돼 있으면 타입만 검사.
  if (candidate.answer !== undefined && candidate.answer !== null) {
    if (typeof candidate.answer !== "string" && typeof candidate.answer !== "number") {
      return { ok: false, message: "extractor answer must be a string or number" };
    }
  }

  // has_figure: boolean
  if (typeof candidate.has_figure !== "boolean") {
    return { ok: false, message: "extractor has_figure must be a boolean" };
  }

  // figure_info validation
  if (candidate.has_figure) {
    if (!candidate.figure_info || typeof candidate.figure_info !== "object" || Array.isArray(candidate.figure_info)) {
      return { ok: false, message: "extractor figure_info must be an object when has_figure is true" };
    }
    const fi = candidate.figure_info as Record<string, unknown>;

    // description_en is preferred in English for figure regeneration, but language
    // drift should not invalidate the whole question extraction.
    if (fi.description_en !== undefined) {
      if (typeof fi.description_en !== "string") {
        return { ok: false, message: "extractor figure_info.description_en must be a string" };
      }
    }

    // crop_ratio: if present, must be [n, n, n, n] with values in [0, 1]
    if (fi.crop_ratio !== undefined) {
      if (!Array.isArray(fi.crop_ratio) || fi.crop_ratio.length !== 4) {
        return { ok: false, message: "extractor figure_info.crop_ratio must be an array of 4 numbers" };
      }
      for (const v of fi.crop_ratio) {
        if (typeof v !== "number" || v < 0 || v > 1) {
          return {
            ok: false,
            message: "extractor figure_info.crop_ratio values must be floats in [0, 1]",
            details: { crop_ratio: fi.crop_ratio },
          };
        }
      }
    }
  }

  // parts: if present, must be a non-empty array
  if (candidate.parts !== undefined) {
    if (!Array.isArray(candidate.parts)) {
      return { ok: false, message: "extractor parts must be an array when present" };
    }
  }

  // passage_box: optional long passage/stimulus material rendered by builder as a one-cell table.
  if (candidate.passage_box !== undefined && candidate.passage_box !== null) {
    if (typeof candidate.passage_box !== "object" || Array.isArray(candidate.passage_box)) {
      return { ok: false, message: "extractor passage_box must be an object or null" };
    }
    const passageBox = candidate.passage_box as Record<string, unknown>;
    const hasParts = Array.isArray(passageBox.parts);
    const hasParagraphs = Array.isArray(passageBox.paragraphs);
    const hasItems = Array.isArray(passageBox.items);
    if (!hasParts && !hasParagraphs && !hasItems) {
      return {
        ok: false,
        message: "extractor passage_box must include parts, paragraphs, or items",
      };
    }
  }

  // choices: if present, must have 3-5 items (array of arrays)
  if (candidate.choices !== undefined && candidate.choices !== null) {
    if (!Array.isArray(candidate.choices) || candidate.choices.length < 3 || candidate.choices.length > 5) {
      return {
        ok: false,
        message: "extractor choices must be an array with 3 to 5 items",
        details: { choicesLength: Array.isArray(candidate.choices) ? candidate.choices.length : undefined },
      };
    }
  }

  // question: 프롬프트 스키마는 parts 배열만 정의하므로 question은 optional. 응답에 있으면 비어있지 않은 문자열인지만 검사.
  if (candidate.question !== undefined && candidate.question !== null) {
    if (typeof candidate.question !== "string" || candidate.question.trim() === "") {
      return { ok: false, message: "extractor question must be a non-empty string when present" };
    }
  }

  const figureInfo = candidate.has_figure
    ? (candidate.figure_info as ExtractorFigureInfo)
    : null;

  const output: ExtractorStageOutput = {
    ...candidate,
    has_figure: candidate.has_figure,
    figure_info: figureInfo,
  };

  return { ok: true, output };
}

/**
 * Strip leading circled-number prefix (①②③④⑤) from choice entries.
 *
 * Contract: assemble.py's make_choices_xml prepends CHOICE_SYMBOLS[i] itself,
 * so choices coming into the builder must NOT carry their own prefix. The
 * extractor sometimes emits `[{"t": "① "}, {"eq": "-20"}]` despite the
 * contract; if left as-is, two failures cascade:
 *   1) is_short_choice() returns False (presence of any `t` part), forcing
 *      eq-only choices into the 5-row layout instead of 3+2;
 *   2) builder prepends "①" and then emits the extractor's "① " — duplicate
 *      circled number ("① ①" before the value).
 * Both symptoms vanish once the leading prefix is stripped here.
 *
 * This function is exported for unit testing.
 */
const CHOICE_PREFIX_RE = /^[①②③④⑤]\s*/;
const SHARED_RANGE_RE = /\[(\d{1,3})\s*[~\-–]\s*(\d{1,3})\]/g;

export function sanitizeExtractedChoices(extracted: ExtractorStageOutput): ExtractorStageOutput {
  if (!Array.isArray(extracted.choices)) return extracted;
  const normalized = extracted.choices.map((choice): ExtractorChoice => {
    if (!Array.isArray(choice) || choice.length === 0) return choice;
    const first = choice[0];
    if (!first || typeof first !== "object" || !("t" in first)) return choice;
    const t = (first as { t: unknown }).t;
    if (typeof t !== "string" || !CHOICE_PREFIX_RE.test(t)) return choice;
    const stripped = t.replace(CHOICE_PREFIX_RE, "");
    if (stripped.length === 0) return choice.slice(1) as ExtractorChoice;
    return [{ ...(first as Record<string, unknown>), t: stripped } as ExtractorPartObject, ...choice.slice(1)];
  });
  return { ...extracted, choices: normalized };
}

export function sanitizeSharedQuestionRanges(extracted: ExtractorStageOutput): ExtractorStageOutput {
  return replaceSharedRangesDeep(extracted) as ExtractorStageOutput;
}

function replaceSharedRangesDeep(value: unknown): unknown {
  if (typeof value === "string") return replaceSharedRangeLabels(value);
  if (Array.isArray(value)) return value.map(replaceSharedRangesDeep);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = replaceSharedRangesDeep(child);
  }
  return out;
}

function replaceSharedRangeLabels(text: string): string {
  return text.replace(SHARED_RANGE_RE, (match, startRaw: string, endRaw: string) => {
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    const count = end - start + 1;
    if (!Number.isFinite(count) || count < 2 || count > 20) return match;
    return `[다음 문제 ${count}개]`;
  });
}

function toExtractorValidationFailure(
  failure: ReturnType<typeof validationFailure>,
  metadata: ProviderRunMetadata,
  startedAt: string
): ModelStageResult<ExtractorStageOutput> {
  return {
    status: "failed",
    validation: failure.validation,
    error: failure.error,
    provider: {
      requestedProvider: metadata.requestedProvider,
      provider: metadata.provider,
      modelStageKey: "create.extractor",
      label: metadata.label,
      externalCostUsd: metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
