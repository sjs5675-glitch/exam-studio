# V2 Region Workflow

## Goal

Build a separate local prototype for science workbook typing where the PDF crop step understands multiple region types per problem.

The current app treats "add problem" and "draw a box" as almost the same action. That is workable for simple exam papers, but it becomes awkward for science workbooks because one problem can contain a prompt, figures, tables, shared material, answer choices, and teacher-answer marks.

V2 should let AI draft the structure and let the user correct it.

## Core Flow

1. User uploads a PDF.
2. AI detects regions on each page.
3. The cropper shows different region boxes by type.
4. User reviews and edits only incorrect boxes.
5. Confirmed regions become the source of extraction, figure processing, table handling, and HWPX layout.

## Region Types

- `problem`: full problem region, including text, choices, and related assets.
- `figure`: picture, diagram, graph, map, experimental setup, cell image, circuit, etc.
- `table`: printed table or table-like answer data.
- `shared_stimulus`: common material such as `[08~09]` that belongs to multiple following problems.
- `answer_overlay`: teacher answer marks, blue notes, model answer labels, check marks.
- `exclude`: page number, workbook problem id, importance badge, QR code, publisher footer, decorative marks.

## Ownership Model

Each region should have a stable id.

`problem` regions own child regions:

```json
{
  "id": "p-08",
  "type": "problem",
  "number": 8,
  "page": 12,
  "box": [120, 210, 900, 760],
  "children": ["fig-08-a", "tbl-08-a"],
  "sharedStimulusIds": ["stim-08-09"]
}
```

Child regions can be moved independently:

```json
{
  "id": "fig-08-a",
  "type": "figure",
  "ownerProblemId": "p-08",
  "page": 12,
  "box": [210, 260, 620, 520],
  "mode": "original",
  "instruction": "Preserve A-D labels and layer boundaries exactly."
}
```

## Review UI

The cropper should use color-coded overlays:

- Blue: problem
- Green: figure
- Purple: table
- Orange: shared stimulus
- Cyan: answer overlay
- Gray: exclude

Expected controls:

- Add region
- Delete region
- Change region type
- Assign owner problem
- Link shared stimulus to multiple problems
- Mark figure handling mode:
  - original
  - grayscale
  - remove blue text
  - regenerate
- Add common figure instruction
- Add per-region figure instruction

## AI Detection Output

Auto-crop should return regions, not only problem boxes.

```json
{
  "pages": [
    {
      "page": 1,
      "regions": [
        { "id": "p-01", "type": "problem", "number": 1, "box_2d": [80, 60, 430, 520] },
        { "id": "fig-01-a", "type": "figure", "owner": "p-01", "box_2d": [170, 180, 330, 420] },
        { "id": "ex-01-a", "type": "exclude", "reason": "importance_badge", "box_2d": [75, 45, 130, 120] }
      ]
    }
  ]
}
```

## Figure Processing Rules

Confirmed `figure` regions should be preferred over AI-inferred figure crops.

Priority:

1. User-confirmed `figure` region.
2. AI-detected `figure` region accepted by user.
3. Fallback to current automatic figure inference.

For regeneration, the prompt should include:

- global instruction
- per-figure instruction
- source problem number
- region type
- preservation checklist

Important preservation checklist:

- labels such as A, B, C, D, ㄱ, ㄴ, ㄷ
- axis names, tick marks, units, numbers
- arrows and direction markers
- table cell text and borders
- chemical formulas and subscripts
- graph curve shape and relative positions

## Progress UI

V2 should not show only a fixed percent during long image work.

Show:

- current stage
- current problem number
- current region id
- completed / total
- failed count
- last completed region
- provider
- estimated cost when using paid image APIs

## Cost Strategy

Default should avoid paid image generation.

Recommended order:

1. Use original crop.
2. Apply local preprocessing if possible.
3. Remove blue teacher overlays locally when color-based masking is enough.
4. Use AI only for selected figure regions.
5. Cache by source image hash + instruction + provider.

## Non-Goals For First V2 Prototype

- Do not push to GitHub.
- Do not migrate the current app immediately.
- Do not rewrite HWPX layout until region data is stable.
- Do not force every problem to have child regions.

