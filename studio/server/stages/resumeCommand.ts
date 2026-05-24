/**
 * resumeCommand.ts — Phase 2
 *
 * Codifies the 13 resume commands previously described in natural-language
 * in .claude/skills/exam-create/SKILL.md:43-63.
 *
 * Single source of truth: __tests__/fixtures/resume-commands.json
 */

export type ResumeStage =
  | "extractor"
  | "review_extract"
  | "solver"
  | "verifier"
  | "figure"
  | "confirm"
  | "builder"
  | "cleaned"
  | "image_replace";

export interface ResumeCommand {
  type: "create" | "resume";
  /** undefined = all questions, [N,...] = specified question numbers */
  questions?: number[];
  /** undefined = auto-detect from cache, explicit = start from this stage */
  fromStage?: ResumeStage;
}

export class ResumeCommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeCommandParseError";
  }
}

/**
 * Parse a user prompt string or a pre-structured object into a ResumeCommand.
 *
 * Supports all 13 resume command variants from SKILL.md:43-63,
 * plus create ("작업해줘") commands.
 *
 * @throws {ResumeCommandParseError} if input is ambiguous or invalid.
 */
export function parseResumeCommand(input: string | object): ResumeCommand {
  if (typeof input === "object" && input !== null) {
    return parseStructuredInput(input as Record<string, unknown>);
  }

  const str = (input as string).trim();

  // Create mode: "작업해줘" or any text without "resume"
  if (!str.startsWith("resume")) {
    return { type: "create" };
  }

  // Auto resume: "resume" with nothing else
  if (str === "resume") {
    return { type: "resume" };
  }

  // Parse --q=... and --from=... flags
  const questionMatch = str.match(/--q=([0-9,]+)/);
  const fromMatch = str.match(/--from=([a-z_]+)/);

  const questions = questionMatch
    ? parseQuestionNums(questionMatch[1])
    : undefined;
  const fromStage = fromMatch ? validateStage(fromMatch[1]) : undefined;

  // Must have at least one of --q or --from for a non-bare resume
  if (!questions && !fromStage) {
    throw new ResumeCommandParseError(
      `Ambiguous resume command: "${str}". Expected --q=<nums> or --from=<stage>.`
    );
  }

  return { type: "resume", questions, fromStage };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const VALID_STAGES: ResumeStage[] = [
  "extractor",
  "review_extract",
  "solver",
  "verifier",
  "figure",
  "confirm",
  "builder",
  "cleaned",
  "image_replace",
];

function validateStage(name: string): ResumeStage {
  if (VALID_STAGES.includes(name as ResumeStage)) {
    return name as ResumeStage;
  }
  throw new ResumeCommandParseError(
    `Unknown stage: "${name}". Valid stages: ${VALID_STAGES.join(", ")}`
  );
}

function parseQuestionNums(raw: string): number[] {
  const nums = raw.split(",").map((s) => {
    const n = parseInt(s.trim(), 10);
    if (isNaN(n) || n < 1) {
      throw new ResumeCommandParseError(
        `Invalid question number: "${s}". Must be a positive integer.`
      );
    }
    return n;
  });
  if (nums.length === 0) {
    throw new ResumeCommandParseError("--q= must have at least one number.");
  }
  return nums;
}

function parseStructuredInput(obj: Record<string, unknown>): ResumeCommand {
  const type = obj.type as string | undefined;
  if (type === "create") {
    return { type: "create" };
  }

  if (type !== "resume" && type !== undefined) {
    throw new ResumeCommandParseError(
      `Invalid type "${type}". Must be "create" or "resume".`
    );
  }

  const questions = obj.questions as number[] | undefined;
  const fromStage =
    obj.fromStage !== undefined ? validateStage(obj.fromStage as string) : undefined;

  return { type: "resume", questions, fromStage };
}
