# 2026-05-30 Teacher Answer + Multi-AI Solver Backlog

## Status

Backlog for the next patch. Do not implement during the current run unless explicitly requested.

## Context

When a science workbook is processed as a teacher edition, the source often already contains the answer in one of these forms:

- Blue teacher-answer text
- Blue check marks beside a choice
- "모범 답안" text for written-response problems

The current pipeline can extract some of this into `teacher_answer_parts`, but it treats the value as reference context for the solver. It does not yet promote the teacher-edition answer to a first-class, authoritative answer candidate.

## Next Patch Items

1. Teacher answer extraction
   - Add deterministic normalization from `teacher_answer_parts` to a dedicated field such as `teacher_answer`.
   - Detect blue check marks and map them to the selected choice number.
   - Detect written "모범 답안" blocks and preserve them separately from ordinary explanation text.
   - For teacher workbooks, prefer the source answer over newly generated answers unless there is a clear conflict.

2. Solver behavior for teacher workbooks
   - If `teacher_answer` exists, use it as the primary answer.
   - Generate or improve only the explanation when the answer is already present.
   - Add verifier checks that compare generated answer vs teacher-source answer and flag mismatches.

3. Multi-AI answer selection
   - Add an optional "multi-model solve" mode that can ask multiple providers, such as Gemini and OpenAI, for independent answers.
   - Compare candidates and select the best answer using a verifier/judge step.
   - Surface disagreement in the UI so the user can review uncertain problems.

4. UI / settings
   - Add a teacher-edition answer policy option, for example:
     - Use teacher answers first
     - Generate explanations only
     - Cross-check with AI
   - Add a solver strategy option:
     - Single AI
     - Multi-AI consensus
     - Multi-AI consensus only for uncertain problems

## Notes

This should be handled as a workflow-level patch, not only a prompt tweak. The answer source needs to survive extractor -> solver -> verifier -> `exam_data.json` -> HWPX builder.
