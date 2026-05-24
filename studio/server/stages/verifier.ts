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
import { buildVerifierPrompt } from "./prompts/verifierPrompt";
import type { ExamMeta } from "./prompts/extractorPrompt";

export type VerifierIssueCategory =
  | "math_accuracy"
  | "math_completeness"
  | "curriculum_scope"
  | "curriculum_term"
  | "format_rule"
  | "equation_syntax"
  | "extraction_mismatch";

export interface VerifierIssue {
  category: VerifierIssueCategory;
  description: string;
  location?: string;
}

export interface VerifierStageInput {
  questionNumber: number;
  extracted: unknown;
  solved?: unknown;
  guidelineContext?: string;
  examMeta?: ExamMeta;
  cache: StageCache;
  provider?: AIProviderAdapter;
  signal?: AbortSignal;
}

export interface VerifierStageOutput {
  number?: number;
  status: "pass" | "fail";
  issues: VerifierIssue[];
  feedback: string | null;
}

export const verifierStageRunner: ModelStageRunner<VerifierStageInput, VerifierStageOutput> = {
  key: "create.verifier",
  run: runVerifierStage,
};

export async function runVerifierStage(input: VerifierStageInput): Promise<ModelStageResult<VerifierStageOutput>> {
  const startedAt = new Date().toISOString();
  const provider = input.provider ?? deepseekV4Provider;
  const { system, user } = buildVerifierPrompt({
    extracted: input.extracted,
    solved: input.solved,
    guidelineContext: input.guidelineContext,
    examMeta: input.examMeta,
  });
  const prompt = system + "\n\n" + user;
  const providerResult = provider.run(prompt, { stageKey: "create.verifier", signal: input.signal });
  const { text, exitCode } = await collectProviderText(providerResult);

  if (exitCode !== 0) {
    return {
      status: "failed",
      error: {
        code: "verifier_provider_failed",
        message: `Verifier provider failed with exit code ${exitCode}`,
        retryable: true,
      },
      provider: {
        requestedProvider: providerResult.metadata.requestedProvider,
        provider: providerResult.metadata.provider,
        modelStageKey: "create.verifier",
        label: providerResult.metadata.label,
        externalCostUsd: providerResult.metadata.externalCostUsd,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const parsed = parseModelJsonOutput(text);
  if (!parsed.ok) {
    return toValidationFailure(parsed, providerResult.metadata, startedAt);
  }

  const validation = validateModelOutput(parsed.value, validateVerifierOutput);
  if (!validation.ok) {
    return toValidationFailure(validationFailure("verifier_validation_failed", validation.message, validation.details), providerResult.metadata, startedAt);
  }

  await input.cache.ensureCacheDir();
  const outputPath = input.cache.verifierResultPath(input.questionNumber);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(validation.output, null, 2)}\n`, "utf8");

  return {
    status: "completed",
    output: validation.output,
    files: [{ path: outputPath, kind: "cache", label: "Verifier result", mimeType: "application/json" }],
    validation: { ok: true, output: validation.output },
    provider: {
      requestedProvider: providerResult.metadata.requestedProvider,
      provider: providerResult.metadata.provider,
      modelStageKey: "create.verifier",
      label: providerResult.metadata.label,
      externalCostUsd: providerResult.metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

const VALID_ISSUE_CATEGORIES: ReadonlySet<string> = new Set<VerifierIssueCategory>([
  "math_accuracy",
  "math_completeness",
  "curriculum_scope",
  "curriculum_term",
  "format_rule",
  "equation_syntax",
  "extraction_mismatch",
]);

export function validateVerifierOutput(value: unknown): ModelOutputValidation<VerifierStageOutput> {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "verifier output must be an object" };
  }

  const candidate = value as { number?: unknown; status?: unknown; issues?: unknown; feedback?: unknown };
  if (candidate.status !== "pass" && candidate.status !== "fail") {
    return { ok: false, message: "verifier status must be pass or fail" };
  }
  if (!Array.isArray(candidate.issues)) {
    return { ok: false, message: "verifier issues must be an array" };
  }
  if (candidate.status === "fail" && candidate.issues.length === 0) {
    return { ok: false, message: "verifier issues must have at least one entry when status is fail" };
  }

  const issues: VerifierIssue[] = [];
  for (const issue of candidate.issues) {
    if (!issue || typeof issue !== "object") {
      return { ok: false, message: "verifier issue must be an object" };
    }
    const { category, description, location } = issue as { category?: unknown; description?: unknown; location?: unknown };

    if (typeof category !== "string" || !VALID_ISSUE_CATEGORIES.has(category)) {
      return { ok: false, message: `verifier issue category is invalid: ${String(category)}` };
    }
    if (typeof description !== "string" || !description.trim()) {
      return { ok: false, message: "verifier issue description is required" };
    }
    issues.push({
      category: category as VerifierIssueCategory,
      description,
      location: typeof location === "string" ? location : undefined,
    });
  }

  const number = typeof candidate.number === "number" ? candidate.number : undefined;
  const feedback = typeof candidate.feedback === "string" ? candidate.feedback : null;

  return {
    ok: true,
    output: {
      ...(number !== undefined ? { number } : {}),
      status: candidate.status,
      issues,
      feedback,
    },
  };
}

function toValidationFailure(
  failure: ReturnType<typeof validationFailure>,
  metadata: ReturnType<AIProviderAdapter["run"]>["metadata"],
  startedAt: string
): ModelStageResult<VerifierStageOutput> {
  return {
    status: "failed",
    validation: failure.validation,
    error: failure.error,
    provider: {
      requestedProvider: metadata.requestedProvider,
      provider: metadata.provider,
      modelStageKey: "create.verifier",
      label: metadata.label,
      externalCostUsd: metadata.externalCostUsd,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
