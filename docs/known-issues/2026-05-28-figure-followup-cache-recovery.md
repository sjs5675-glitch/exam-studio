# 2026-05-28 Figure Follow-up Cache Recovery

## Symptom

During a 58-question science workbook job, the UI appeared stuck around figure generation.
No `figure_processor.py` process was still running, but `/api/build-status` kept returning
`{ "pending": true }`.

## Observed State

- Job: `1d2addb3-b13b-4adb-8887-f9392a166a72`
- Main job result summary: `figure_processor.py 실패`
- `build_status.json` was never written, so the create page kept polling as if HWPX build had not started.
- Per-question follow-ups for figure retry wrote new image outputs, but some follow-up entries stayed without `finishedAt`.
- `exam_data.json` was overwritten by a targeted figure retry and ended up containing only the targeted problem.
- Missing final images observed in UI: Q11, Q16, Q51.
- Existing extractor/solver/verifier cache files were still present, so full AI rerun was unnecessary.

## Root Causes To Patch

1. Targeted figure retry must not truncate or overwrite full `exam_data.json`.
2. Figure status merge must preserve previous question statuses when retrying one question.
3. If figure generation partially fails, the UI should expose a clear "build with original crops" recovery action.
4. `/api/build-status` should distinguish "builder not started because figure failed" from normal pending.
5. Job status should not be marked `done` when `resultSummary` is a failure and no HWPX output exists.
6. Follow-up entries must always receive `finishedAt`, including failure and cancellation paths.
7. The figure review UI should not repeatedly request missing `probN_final.png` without showing the source ref fallback.
8. `/api/figure-status` currently checks `status.completed === true`, but `figure_processor.py` writes top-level `status: "done"`.
   The API should treat `status === "done"` as completed or the processor should also write `completed: true`.

## Manual Recovery Used

1. Rebuilt full `exam_data.json` from existing `q*_extracted.json` and `q*_solved.json` cache files.
2. Recreated only missing figure final images with `figure_processor.py --no-regen --grayscale --remove-blue-text --question N`.
3. Rebuilt `figure_status.json` from existing `outputs/images/probN_final.png`.
4. Planned next step: resume builder only, without rerunning extractor/solver/verifier.

## Desired Patch

Add a deterministic recovery path:

- `resume --from=builder --use-existing-cache`
- or a UI button: `누락 그림은 원본 crop으로 대체하고 HWPX 조립`

This path should:

- rebuild full `exam_data.json` from cache,
- fill missing final figure images with crop-only output,
- rewrite `figure_status.json`,
- run builder/checker only,
- never call text AI providers again.
