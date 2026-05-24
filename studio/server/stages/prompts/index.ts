/**
 * server/stages/prompts/index.ts
 *
 * Re-exports all stage prompt builders.
 * Used by Phase 3+ stage runners and the model harness.
 */

export type { ExamMeta, ExtractorPromptInput } from "./extractorPrompt";
export { buildExtractorPrompt } from "./extractorPrompt";

export type { SolverPromptInput } from "./solverPrompt";
export { buildSolverPrompt } from "./solverPrompt";

export type { VerifierPromptInput } from "./verifierPrompt";
export { buildVerifierPrompt } from "./verifierPrompt";
