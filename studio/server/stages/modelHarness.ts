import type { ProviderTelemetryEntry } from "@/lib/ai/retry";
import type { ProviderRunResult } from "@/lib/ai/types";
import type { StageError, ValidationResult } from "./types";

export type ModelOutputValidator<T> = (value: unknown) => ModelOutputValidation<T>;

export type ModelOutputValidation<T> =
  | { ok: true; output: T; message?: string; details?: Record<string, unknown> }
  | { ok: false; message: string; details?: Record<string, unknown> };

export type JsonExtractionSource = "raw" | "fenced" | "balanced";

export interface ParsedModelJson {
  ok: true;
  value: unknown;
  source: JsonExtractionSource;
}

export interface ModelJsonParseFailure {
  ok: false;
  validation: ValidationResult;
  error: StageError;
}

export type ModelJsonParseResult = ParsedModelJson | ModelJsonParseFailure;

export function parseModelJsonOutput(rawOutput: string): ModelJsonParseResult {
  const candidates = extractJsonCandidates(rawOutput);

  for (const candidate of candidates) {
    try {
      return {
        ok: true,
        value: JSON.parse(candidate.text),
        source: candidate.source,
      };
    } catch {
      // Try the next structured candidate before returning a validation error.
    }
  }

  return validationFailure("model_json_parse_failed", "Model output did not contain valid JSON");
}

export function validateModelOutput<T>(
  value: unknown,
  validator: ModelOutputValidator<T>
): ModelOutputValidation<T> {
  try {
    return validator(value);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createValidationTelemetry(
  validation: ValidationResult,
  entry: Omit<ProviderTelemetryEntry, "status" | "validationOk" | "failureKind" | "errorSummary">
): ProviderTelemetryEntry {
  return {
    ...entry,
    status: "failed",
    validationOk: false,
    failureKind: "validation",
    errorSummary: validation.message,
  };
}

export function validationFailure(code: string, message: string, details?: Record<string, unknown>): ModelJsonParseFailure {
  return {
    ok: false,
    validation: {
      ok: false,
      message,
      details,
    },
    error: {
      code,
      message,
      retryable: true,
      details,
    },
  };
}

export async function collectProviderText(result: ProviderRunResult): Promise<{ text: string; exitCode: number }> {
  const chunks: string[] = [];

  for await (const event of result.events) {
    if (event.type === "assistant" && event.message) {
      for (const content of event.message.content) {
        if (content.type === "text" && content.text) chunks.push(content.text);
      }
    }
  }

  return {
    text: chunks.join("\n").trim(),
    exitCode: await result.exitCode,
  };
}

function extractJsonCandidates(rawOutput: string): Array<{ text: string; source: JsonExtractionSource }> {
  const trimmed = rawOutput.trim();
  const candidates: Array<{ text: string; source: JsonExtractionSource }> = [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push({ text: trimmed, source: "raw" });
  }

  for (const match of rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const text = match[1]?.trim();
    if (text) candidates.push({ text, source: "fenced" });
  }

  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    candidates.push({ text: balanced, source: "balanced" });
  }

  return candidates;
}

function extractBalancedJson(value: string): string | undefined {
  const start = findJsonStart(value);
  if (start < 0) return undefined;

  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }

  return undefined;
}

function findJsonStart(value: string): number {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;
  return Math.min(objectStart, arrayStart);
}
