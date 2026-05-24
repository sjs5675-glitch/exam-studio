import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { AIProviderAdapter } from "@/lib/ai/types";
import { deepseekV4Provider } from "@/lib/ai/providers/deepseekV4";
import type { StageCache } from "./cache";
import {
  collectProviderText,
  parseModelJsonOutput,
  validateModelOutput,
  validationFailure,
  type ModelOutputValidation,
} from "./modelHarness";
import type { ModelStageResult, ModelStageRunner } from "./model";
import { buildSolverPrompt } from "./prompts/solverPrompt";
import type { ExamMeta } from "./prompts/extractorPrompt";
import { normalizeParts } from "@/lib/parts/normalize";

export type SolverExplanationPart =
  | { t: string }
  | { eq: string }
  | { br: true };

export interface SolverStageInput {
  questionNumber: number;
  extracted: unknown;
  guidelineContext?: string;
  feedback?: string;
  examMeta?: ExamMeta;
  cache: StageCache;
  provider?: AIProviderAdapter;
  validateEquation?: (content: string) => string | undefined;
  signal?: AbortSignal;
}

export interface SolverStageOutput {
  number?: number;
  answer: string;
  explanation_parts: SolverExplanationPart[];
}

export const solverStageRunner: ModelStageRunner<SolverStageInput, SolverStageOutput> = {
  key: "create.solver",
  run: runSolverStage,
};

export async function runSolverStage(input: SolverStageInput): Promise<ModelStageResult<SolverStageOutput>> {
  const startedAt = new Date().toISOString();
  const provider = input.provider ?? deepseekV4Provider;
  const { system, user } = buildSolverPrompt({
    extracted: input.extracted,
    guidelineContext: input.guidelineContext,
    feedback: input.feedback,
    examMeta: input.examMeta,
  });
  const prompt = system + "\n\n" + user;
  const providerResult = provider.run(prompt, { stageKey: "create.solver", signal: input.signal });
  const { text, exitCode } = await collectProviderText(providerResult);

  if (exitCode !== 0) {
    return {
      status: "failed",
      error: {
        code: "solver_provider_failed",
        message: `Solver provider failed with exit code ${exitCode}`,
        retryable: true,
      },
      provider: {
        requestedProvider: providerResult.metadata.requestedProvider,
        provider: providerResult.metadata.provider,
        modelStageKey: "create.solver",
        label: providerResult.metadata.label,
        externalCostUsd: providerResult.metadata.externalCostUsd,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const parsed = parseModelJsonOutput(text);
  if (!parsed.ok) {
    return toSolverValidationFailure(parsed, providerResult.metadata, startedAt);
  }

  const validation = validateModelOutput(parsed.value, (value) => validateSolverOutput(value, input.validateEquation));
  if (!validation.ok) {
    return toSolverValidationFailure(validationFailure("solver_validation_failed", validation.message, validation.details), providerResult.metadata, startedAt);
  }

  const normalized: SolverStageOutput = {
    ...validation.output,
    explanation_parts: normalizeParts(validation.output.explanation_parts) as SolverExplanationPart[],
  };

  await input.cache.ensureCacheDir();
  const outputPath = input.cache.solverResultPath(input.questionNumber);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return {
    status: "completed",
    output: normalized,
    files: [{ path: outputPath, kind: "cache", label: "Solver result", mimeType: "application/json" }],
    validation: { ok: true, output: normalized },
    provider: {
      requestedProvider: providerResult.metadata.requestedProvider,
      provider: providerResult.metadata.provider,
      modelStageKey: "create.solver",
      label: providerResult.metadata.label,
      externalCostUsd: providerResult.metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

export function validateSolverOutput(
  value: unknown,
  validateEquation?: (content: string) => string | undefined
): ModelOutputValidation<SolverStageOutput> {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "solver output must be an object" };
  }

  const candidate = value as { number?: unknown; answer?: unknown; explanation_parts?: unknown };
  if (typeof candidate.answer !== "string" || !candidate.answer.trim()) {
    return { ok: false, message: "solver answer is required" };
  }
  if (!Array.isArray(candidate.explanation_parts) || candidate.explanation_parts.length === 0) {
    return { ok: false, message: "solver explanation_parts must be a non-empty array" };
  }

  const explanation_parts: SolverExplanationPart[] = [];
  for (const part of candidate.explanation_parts) {
    if (!part || typeof part !== "object") {
      return { ok: false, message: "solver explanation_parts element must be an object" };
    }
    const p = part as { t?: unknown; eq?: unknown; br?: unknown };
    if ("t" in part) {
      if (typeof p.t !== "string") {
        return { ok: false, message: "solver explanation_parts {t} must be a string" };
      }
      explanation_parts.push({ t: p.t });
    } else if ("eq" in part) {
      if (typeof p.eq !== "string") {
        return { ok: false, message: "solver explanation_parts {eq} must be a string" };
      }
      const equationIssue = validateEquation?.(p.eq);
      if (equationIssue) {
        return { ok: false, message: equationIssue, details: { partKey: "eq" } };
      }
      explanation_parts.push({ eq: p.eq });
    } else if ("br" in part) {
      if (p.br !== true) {
        return { ok: false, message: "solver explanation_parts {br} must be true" };
      }
      explanation_parts.push({ br: true });
    } else {
      const keys = Object.keys(part);
      return { ok: false, message: `solver explanation_parts element has unknown key(s): ${keys.join(", ")}` };
    }
  }

  const number = typeof candidate.number === "number" ? candidate.number : undefined;

  return {
    ok: true,
    output: {
      ...(number !== undefined ? { number } : {}),
      answer: candidate.answer,
      explanation_parts,
    },
  };
}

function toSolverValidationFailure(
  failure: ReturnType<typeof validationFailure>,
  metadata: ReturnType<AIProviderAdapter["run"]>["metadata"],
  startedAt: string
): ModelStageResult<SolverStageOutput> {
  return {
    status: "failed",
    validation: failure.validation,
    error: failure.error,
    provider: {
      requestedProvider: metadata.requestedProvider,
      provider: metadata.provider,
      modelStageKey: "create.solver",
      label: metadata.label,
      externalCostUsd: metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
