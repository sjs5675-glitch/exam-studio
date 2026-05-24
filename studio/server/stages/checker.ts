import { readFile } from "fs/promises";
import { join } from "path";
import JSZip from "jszip";
import type { StageResult, StageRunner } from "./types";
import type { SchoolLevel } from "@/lib/exam/meta";

// ──────────────────────────────────────────────
// unit_classification.json types + loader
// ──────────────────────────────────────────────

interface UnitEntry {
  code: string | null;
  name: string;
  topics: string[];
}

interface SubjectEntry {
  code: string;
  name: string;
  grade: number | null;
  units: UnitEntry[];
}

export interface UnitClassification {
  subjects: SubjectEntry[];
  legacy?: { subjects: SubjectEntry[] };
}

/** Cached classification data (null = not yet attempted; false = load failed). */
let _unitClassificationCache: UnitClassification | null | false = null;

/** Path to unit_classification.json — 3 levels up from server/stages/ to repo root, then into .claude/data/. */
const UNIT_CLASSIFICATION_PATH = join(
  __dirname,
  "../../../.claude/data/unit_classification.json",
);

/** Path to unit_classification_middle.json (중학교). */
const UNIT_CLASSIFICATION_MIDDLE_PATH = join(
  __dirname,
  "../../../.claude/data/unit_classification_middle.json",
);

/**
 * Load unit_classification.json once and cache the result.
 * Returns null if the file cannot be read (rule is skipped, warning logged).
 */
async function loadUnitClassification(): Promise<UnitClassification | null> {
  if (_unitClassificationCache !== null) {
    return _unitClassificationCache === false ? null : _unitClassificationCache;
  }
  try {
    const raw = await readFile(UNIT_CLASSIFICATION_PATH, "utf8");
    _unitClassificationCache = JSON.parse(raw) as UnitClassification;
    return _unitClassificationCache;
  } catch {
    console.warn(
      `[checker] unit_classification.json not found at ${UNIT_CLASSIFICATION_PATH} — text.vocabulary rule skipped`,
    );
    _unitClassificationCache = false;
    return null;
  }
}

/** Reset cache (used in tests to inject custom classification data). */
export function _resetUnitClassificationCache(): void {
  _unitClassificationCache = null;
}

/** Inject classification data directly (used in tests). */
export function _injectUnitClassification(data: UnitClassification): void {
  _unitClassificationCache = data;
}

/** Cached middle-school classification data (false = not yet attempted; null = load failed). */
let _unitClassificationMiddleCache: UnitClassification | null | false = false;

/**
 * Load unit_classification_middle.json once and cache the result.
 * Returns null if the file cannot be read (rule is skipped, warning logged).
 */
async function loadUnitClassificationMiddle(): Promise<UnitClassification | null> {
  if (_unitClassificationMiddleCache !== false) {
    return _unitClassificationMiddleCache === null ? null : _unitClassificationMiddleCache;
  }
  try {
    const raw = await readFile(UNIT_CLASSIFICATION_MIDDLE_PATH, "utf8");
    _unitClassificationMiddleCache = JSON.parse(raw) as UnitClassification;
    return _unitClassificationMiddleCache;
  } catch {
    console.warn(
      `[checker] unit_classification_middle.json not found at ${UNIT_CLASSIFICATION_MIDDLE_PATH} — middle vocabulary skipped`,
    );
    _unitClassificationMiddleCache = null;
    return null;
  }
}

/** Reset middle cache (used in tests). */
export function _resetUnitClassificationMiddleCache(): void {
  _unitClassificationMiddleCache = false;
}

/** Inject middle classification data directly (used in tests). */
export function _injectUnitClassificationMiddle(data: UnitClassification): void {
  _unitClassificationMiddleCache = data;
}

export type CheckerIssueSeverity = "error" | "warning" | "info";

export interface CheckerIssue {
  ruleId: string;
  severity: CheckerIssueSeverity;
  message: string;
  file?: string;
  evidence?: string;
  fallbackRequired?: boolean;
}

export interface CheckerStageInput {
  hwpxPath?: string;
  sectionXmlPath?: string;
  sectionXml?: string;
  /** School level for vocabulary rule; drives which classification JSON is used. */
  schoolLevel?: SchoolLevel;
}

export interface CheckerStageOutput {
  ok: boolean;
  issues: CheckerIssue[];
  checkedFiles: string[];
  deterministicRuleIds: string[];
  fallbackRequired: boolean;
  fallbackReasons: string[];
  /** true when checker issued a fix and re-ran (safe net triggered) */
  autofixed?: boolean;
}

interface SectionSource {
  xml: string;
  file: string;
}

// ──────────────────────────────────────────────
// Rule handler map
// ──────────────────────────────────────────────

interface RuleHandler {
  detect: (xml: string, file: string, context?: { schoolLevel?: SchoolLevel }) => CheckerIssue[];
  /**
   * Optional deterministic XML-level fix.
   * When present, `runCheckerWithAutoFix` will apply this before triggering a
   * rebuild. Returns the mutated XML string. Must be idempotent.
   */
  fix?: (xml: string) => string;
}

const RULES: Record<string, RuleHandler> = {
  "xml.well_formed": { detect: checkXmlWellFormed },
  "xml.raw_escape": { detect: checkRawEscapes },
  "text.raw_equation_xml": { detect: checkRawEquationXml },
  "text.english_word": { detect: checkEnglishWords },
  "text.difficulty_vocabulary": { detect: checkDifficultyVocabulary },
  "text.vocabulary": { detect: checkTextVocabularySync },
  "equation.run_on": {
    detect: checkRunOnEquations,
    fix: fixRunOnEquationsInXml,
  },
  "equation.permutation_combination": { detect: checkPermutationCombination },
  "endNote.structure": { detect: checkEndNoteStructure },
  "section.style_format": { detect: checkSectionStyleFormat },
};

const ALLOWED_DIFFICULTIES = new Set(["하", "중", "상", "킬"]);
const DETERMINISTIC_RULE_IDS = Object.keys(RULES);

export const checkerStageRunner: StageRunner<CheckerStageInput, CheckerStageOutput> = {
  key: "checker",
  run: runCheckerStage,
};

export async function runCheckerStage(input: CheckerStageInput): Promise<StageResult<CheckerStageOutput>> {
  const startedAt = new Date().toISOString();

  try {
    // Pre-load unit classifications (cached after first call; no-op if already loaded).
    await loadUnitClassification();
    await loadUnitClassificationMiddle();
    const source = await loadSectionSource(input);
    const context = { schoolLevel: input.schoolLevel };
    const issues = runDeterministicCheckerRules(source.xml, source.file, context);
    const fallbackReasons = issues
      .filter((issue) => issue.fallbackRequired)
      .map((issue) => `${issue.ruleId}: ${issue.message}`);
    const output: CheckerStageOutput = {
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
      checkedFiles: [source.file],
      deterministicRuleIds: DETERMINISTIC_RULE_IDS,
      fallbackRequired: fallbackReasons.length > 0,
      fallbackReasons,
    };

    return {
      status: output.ok ? "completed" : "failed",
      output,
      validation: {
        ok: output.ok,
        message: output.ok ? "Deterministic checker passed" : `${issues.length} deterministic checker issue(s) found`,
        details: { issueCount: issues.length, fallbackRequired: output.fallbackRequired },
      },
      startedAt,
      completedAt: new Date().toISOString(),
      metadata: { deterministic: true },
    };
  } catch (error) {
    return {
      status: "failed",
      error: {
        code: "checker_failed",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        retryable: false,
      },
      startedAt,
      completedAt: new Date().toISOString(),
      metadata: { deterministic: true },
    };
  }
}

export function runDeterministicCheckerRules(
  sectionXml: string,
  file = "Contents/section0.xml",
  context?: { schoolLevel?: SchoolLevel },
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const handler of Object.values(RULES)) {
    issues.push(...handler.detect(sectionXml, file, context));
  }
  return issues;
}

// ──────────────────────────────────────────────
// Auto-fix wrapper
// ──────────────────────────────────────────────

export interface CheckerAutoFixResult {
  result: StageResult<CheckerStageOutput>;
  /** true when the auto-fix path applied an XML patch and re-ran the checker. */
  autofixed: boolean;
}

/**
 * Run the checker with up to `maxAttempts` deterministic fix rounds.
 *
 * Strategy (rebuild trigger):
 *  1. Run the checker on the given XML.
 *  2. If ok, return immediately.
 *  3. If there are fixable issues (rules with `fix?`), apply each fix in turn
 *     (direct XML mutation) and re-run once.
 *  4. Return the final result (fixed or not).
 *
 * `input.sectionXml` must be provided for the fix loop; if only `hwpxPath` is
 * given the function falls back to a single plain check (no fix attempted).
 */
export async function runCheckerWithAutoFix(
  input: CheckerStageInput,
  maxAttempts = 2,
): Promise<CheckerAutoFixResult> {
  // Pre-load unit classifications before running any rules.
  await loadUnitClassification();
  await loadUnitClassificationMiddle();
  // Load source XML once so we can mutate it in the fix loop.
  const source = await loadSectionSource(input).catch(() => null);

  if (!source) {
    // Couldn't load — let runCheckerStage handle the error path normally.
    const result = await runCheckerStage(input);
    return { result, autofixed: false };
  }

  let xml = source.xml;
  let autofixed = false;
  const context = { schoolLevel: input.schoolLevel };

  function buildResult(issues: CheckerIssue[]): CheckerAutoFixResult {
    const ok = issues.every((i) => i.severity !== "error");
    const fallbackReasons = issues
      .filter((i) => i.fallbackRequired)
      .map((i) => `${i.ruleId}: ${i.message}`);
    const output: CheckerStageOutput = {
      ok,
      issues,
      checkedFiles: [source!.file],
      deterministicRuleIds: DETERMINISTIC_RULE_IDS,
      fallbackRequired: fallbackReasons.length > 0,
      fallbackReasons,
      autofixed,
    };
    const startedAt = new Date().toISOString();
    const validationMessage = ok
      ? autofixed
        ? "Deterministic checker passed after auto-fix"
        : "Deterministic checker passed"
      : `${issues.length} deterministic checker issue(s) found`;
    return {
      result: {
        status: ok ? "completed" : "failed",
        output,
        validation: {
          ok,
          message: validationMessage,
          details: { issueCount: issues.length, fallbackRequired: output.fallbackRequired, autofixed },
        },
        startedAt,
        completedAt: new Date().toISOString(),
        metadata: { deterministic: true },
      },
      autofixed,
    };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const issues = runDeterministicCheckerRules(xml, source.file, context);

    // Any fixable issue (error or warning with fix?) — including fallbackRequired warnings
    const fixableIssues = issues.filter((i) => RULES[i.ruleId]?.fix);

    // If no fixable issues exist, or this is the last attempt: return current result
    if (fixableIssues.length === 0 || attempt >= maxAttempts - 1) {
      return buildResult(issues);
    }

    // Apply fixes in order of the RULES map, then loop again
    const fixableRuleIds = new Set(fixableIssues.map((i) => i.ruleId));
    for (const [ruleId, handler] of Object.entries(RULES)) {
      if (fixableRuleIds.has(ruleId) && handler.fix) {
        xml = handler.fix(xml);
      }
    }
    autofixed = true;
  }

  // Fallback (shouldn't reach here with maxAttempts >= 1): plain single-run
  const result = await runCheckerStage(input);
  return { result, autofixed };
}

async function loadSectionSource(input: CheckerStageInput): Promise<SectionSource> {
  if (input.sectionXml) {
    return { xml: input.sectionXml, file: input.sectionXmlPath ?? "inline section XML" };
  }

  if (input.sectionXmlPath) {
    return { xml: await readFile(input.sectionXmlPath, "utf8"), file: input.sectionXmlPath };
  }

  if (input.hwpxPath) {
    const zip = await JSZip.loadAsync(await readFile(input.hwpxPath));
    const entry = zip.file("Contents/section0.xml");
    if (!entry) throw new Error(`Missing Contents/section0.xml in ${input.hwpxPath}`);
    return { xml: await entry.async("string"), file: `${input.hwpxPath}:Contents/section0.xml` };
  }

  throw new Error("Checker requires hwpxPath, sectionXmlPath, or sectionXml");
}

function checkXmlWellFormed(xml: string, file: string): CheckerIssue[] {
  const stack: string[] = [];
  const tagPattern = /<([^!?/\s>]+)(?:\s[^>]*)?>|<\/([^>\s]+)>/g;

  for (const match of xml.matchAll(tagPattern)) {
    const open = match[1];
    const close = match[2];
    if (open && !match[0].endsWith("/>")) {
      stack.push(open);
      continue;
    }
    if (!close) continue;

    const expected = stack.pop();
    if (expected !== close) {
      return [{
        ruleId: "xml.well_formed",
        severity: "error",
        message: `XML tag mismatch: expected </${expected ?? "none"}> but found </${close}>`,
        file,
        evidence: snippet(match[0]),
      }];
    }
  }

  if (stack.length > 0) {
    return [{
      ruleId: "xml.well_formed",
      severity: "error",
      message: `Unclosed XML tag: <${stack[stack.length - 1]}>`,
      file,
    }];
  }

  return [];
}

function checkRawEscapes(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const match of xml.matchAll(/<hp:script\b[^>]*>([\s\S]*?)<\/hp:script>/g)) {
    const content = match[1];
    if (/[<&](?!amp;|lt;|gt;|quot;|apos;)/.test(content)) {
      issues.push({
        ruleId: "xml.raw_escape",
        severity: "error",
        message: "Unescaped XML character inside hp:script",
        file,
        evidence: snippet(content),
      });
    }
  }
  return issues;
}

function checkRawEquationXml(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const text of textNodes(xml)) {
    if (/(&lt;|<)\/?hp:(equation|script)\b/.test(text)) {
      issues.push({
        ruleId: "text.raw_equation_xml",
        severity: "error",
        message: "Equation XML appears as text inside hp:t",
        file,
        evidence: snippet(text),
      });
    }
  }
  return issues;
}

function checkEnglishWords(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const text of textNodes(xml)) {
    const match = text.match(/[A-Za-z]{3,}/);
    if (match) {
      issues.push({
        ruleId: "text.english_word",
        severity: "warning",
        message: "Consecutive English letters found in visible text",
        file,
        evidence: snippet(match[0]),
      });
    }
  }
  return issues;
}

function checkDifficultyVocabulary(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const visibleText = textNodes(xml).join("\n");
  for (const match of visibleText.matchAll(/\[난이도\]\s*([^\s\[]+)/g)) {
    const value = match[1].trim();
    if (!ALLOWED_DIFFICULTIES.has(value)) {
      issues.push({
        ruleId: "text.difficulty_vocabulary",
        severity: "error",
        message: `Invalid difficulty value: ${value}`,
        file,
        evidence: snippet(match[0]),
      });
    }
  }
  return issues;
}

function checkRunOnEquations(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const script of equationScripts(xml)) {
    if ((script.match(/=/g) ?? []).length >= 2) {
      issues.push({
        ruleId: "equation.run_on",
        severity: "warning",
        message: "Equation script contains multiple equality signs and may be a run-on equation",
        file,
        evidence: snippet(script),
        fallbackRequired: true,
      });
    }
  }
  return issues;
}

function checkPermutationCombination(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const forbidden = /\bn\s*[CP]\s*r\b|LSUB|_\s*\{?n\}?\s*\{?rm[CP]\}?|_\s*n\s*C\s*_\s*r/i;
  for (const source of [...equationScripts(xml), ...textNodes(xml)]) {
    const match = source.match(forbidden);
    if (match) {
      issues.push({
        ruleId: "equation.permutation_combination",
        severity: "error",
        message: "Forbidden permutation/combination notation pattern found",
        file,
        evidence: snippet(match[0]),
      });
    }
  }
  return issues;
}

// ──────────────────────────────────────────────
// Rule: endNote.structure
// ──────────────────────────────────────────────

/**
 * Validate HWPX endNote (각주/미주) structure:
 *   1. suffixChar attribute exists on the endNote element.
 *   2. <hp:autoNum> child element exists inside each endNote.
 *   3. number attribute exists.
 *   4. Attribute order: suffixChar → (autoNum in body) → number must appear in this sequence.
 *      Specifically: suffixChar must precede number in attrs string,
 *      and <hp:autoNum> must appear before any <hp:t> content in body.
 *   5. [정답] text is present in each endNote body.
 *   6. The <hp:p> immediately preceding the <hp:endNote> must not end with whitespace
 *      (미주-문제 띄어쓰기 없음).
 */
function checkEndNoteStructure(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  // Check for leading whitespace before endNote blocks (미주-문제 띄어쓰기 없음).
  // Find all <hp:p>...</hp:p> blocks that appear immediately before a <hp:endNote>.
  // We look for a closing </hp:p> followed (possibly with whitespace) by <hp:endNote.
  // The last hp:t text node in the preceding <hp:p> must not end with a space.
  const precedingParaPattern = /(<hp:p\b[^>]*>[\s\S]*?<\/hp:p>)\s*<hp:endNote\b/g;
  for (const paraMatch of xml.matchAll(precedingParaPattern)) {
    const paraXml = paraMatch[1];
    const tNodes = textNodes(paraXml);
    if (tNodes.length > 0) {
      const lastText = tNodes[tNodes.length - 1];
      if (/\s$/.test(lastText)) {
        issues.push({
          ruleId: "endNote.structure",
          severity: "error",
          message: "Paragraph immediately before endNote ends with whitespace (미주-문제 띄어쓰기 없음)",
          file,
          evidence: snippet(lastText),
        });
      }
    }
  }

  // Match each <hp:endNote ...>...</hp:endNote> block
  const endNotePattern = /<hp:endNote\b([^>]*)>([\s\S]*?)<\/hp:endNote>/g;

  for (const match of xml.matchAll(endNotePattern)) {
    const attrs = match[1];
    const body = match[2];

    const hasSuffixChar = /suffixChar\s*=/.test(attrs);
    const hasNumber = /\bnumber\s*=/.test(attrs) || /\bnumber\s*=/.test(body);
    const hasAutoNum = /<hp:autoNum\b/.test(body);

    // 1. suffixChar attribute
    if (!hasSuffixChar) {
      issues.push({
        ruleId: "endNote.structure",
        severity: "error",
        message: "endNote is missing suffixChar attribute",
        file,
        evidence: snippet(match[0]),
      });
    }

    // 2. autoNum child element
    if (!hasAutoNum) {
      issues.push({
        ruleId: "endNote.structure",
        severity: "error",
        message: "endNote is missing <hp:autoNum> child element",
        file,
        evidence: snippet(body),
      });
    }

    // 3. number attribute
    if (!hasNumber) {
      issues.push({
        ruleId: "endNote.structure",
        severity: "warning",
        message: "endNote is missing number attribute",
        file,
        evidence: snippet(match[0]),
      });
    }

    // 4. Order check: suffixChar must appear before number in attrs;
    //    <hp:autoNum> must appear before the first <hp:t> in body.
    if (hasSuffixChar && hasNumber) {
      const suffixCharPos = attrs.indexOf("suffixChar");
      const numberPos = attrs.indexOf("number");
      // number attr may also be in body — only check attr-level order when both are in attrs
      if (numberPos !== -1 && suffixCharPos > numberPos) {
        issues.push({
          ruleId: "endNote.structure",
          severity: "warning",
          message: "endNote attribute order violation: suffixChar should appear before number",
          file,
          evidence: snippet(attrs),
        });
      }
    }

    if (hasAutoNum && body.includes("<hp:t")) {
      const autoNumPos = body.indexOf("<hp:autoNum");
      const firstTPos = body.indexOf("<hp:t");
      if (autoNumPos > firstTPos) {
        issues.push({
          ruleId: "endNote.structure",
          severity: "warning",
          message: "endNote structure order violation: <hp:autoNum> should appear before <hp:t> content",
          file,
          evidence: snippet(body),
        });
      }
    }

    // 5. [정답] text in body
    const bodyText = textNodes(body).join(" ");
    if (!bodyText.includes("[정답]")) {
      issues.push({
        ruleId: "endNote.structure",
        severity: "error",
        message: "endNote body does not contain [정답] text",
        file,
        evidence: snippet(bodyText || body.slice(0, 120)),
      });
    }
  }

  // If no endNote found at all, nothing to validate (rule doesn't fire)
  return issues;
}

// ──────────────────────────────────────────────
// Rule: section.style_format
// ──────────────────────────────────────────────

/**
 * Validate section0.xml style and formatting constraints:
 *   1. Exactly 1 바탕글 style (F6 rule).
 *   2. <hp:lineBreak> usage is limited to answer lines (2-line answers only).
 *      Since we cannot determine context statically, we flag any lineBreak as warning.
 *   3. Bold (charPr bold="true" / bold="1") in answer context is forbidden.
 *      We flag bold inside endNote blocks (정답 bold 금지).
 */
function checkSectionStyleFormat(xml: string, file: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  // 1. Count 바탕글 style definitions (hp:style name containing "바탕글")
  const batangglMatches = [...xml.matchAll(/<hp:style\b[^>]*name\s*=\s*["'][^"']*바탕글[^"']*["'][^>]*>/g)];
  if (batangglMatches.length > 1) {
    issues.push({
      ruleId: "section.style_format",
      severity: "error",
      message: `바탕글 style defined ${batangglMatches.length} times; expected exactly 1 (F6 rule)`,
      file,
      evidence: snippet(`Found ${batangglMatches.length} occurrences`),
    });
  }

  // 2. <hp:lineBreak> outside answer context — flag as warning (conservative: any usage)
  const lineBreakMatches = [...xml.matchAll(/<hp:lineBreak\b[^>]*\/>/g)];
  if (lineBreakMatches.length > 0) {
    issues.push({
      ruleId: "section.style_format",
      severity: "warning",
      message: `<hp:lineBreak> found (${lineBreakMatches.length} occurrence(s)); allowed only for 2-line answer lines`,
      file,
      evidence: snippet(`${lineBreakMatches.length} lineBreak element(s) detected`),
      fallbackRequired: true,
    });
  }

  // 3. Bold in endNote body (정답 bold 금지)
  for (const endNoteMatch of xml.matchAll(/<hp:endNote\b[^>]*>([\s\S]*?)<\/hp:endNote>/g)) {
    const endNoteBody = endNoteMatch[1];
    if (/bold\s*=\s*["'](?:true|1)["']/.test(endNoteBody)) {
      issues.push({
        ruleId: "section.style_format",
        severity: "error",
        message: "Bold formatting found inside endNote (정답 bold 금지)",
        file,
        evidence: snippet(endNoteBody),
      });
      break; // Report once per document
    }
  }

  return issues;
}

// ──────────────────────────────────────────────
// Rule: text.vocabulary
// ──────────────────────────────────────────────

/**
 * Synchronous wrapper for text.vocabulary — uses the cached classifications.
 * Branches by schoolLevel:
 *   "중" → uses middle-school classification only
 *   "고" → uses high-school classification only
 *   undefined → union of both (관대 기본값, backward-compatible)
 * Returns empty array if no classification is loaded.
 */
function checkTextVocabularySync(xml: string, file: string, context?: { schoolLevel?: SchoolLevel }): CheckerIssue[] {
  const high = _unitClassificationCache || null;
  const middle = _unitClassificationMiddleCache || null;

  const target: UnitClassification[] = [];
  if (context?.schoolLevel === "중") {
    if (middle) target.push(middle);
  } else if (context?.schoolLevel === "고") {
    if (high) target.push(high);
  } else {
    // 미지정 → 양쪽 union fallback (관대 기본값)
    if (high) target.push(high);
    if (middle) target.push(middle);
  }

  if (target.length === 0) return [];
  return checkTextVocabulary(xml, file, target);
}

/**
 * Validate 중단원/과목/범위 text against one or more UnitClassification objects.
 *
 * Scans all hp:t nodes for:
 *  - [중단원] VALUE — must match a known topic in the classification(s)
 *  - [과목] VALUE   — must match a known subject name
 *  - [범위] VALUE   — must match a topic within the expected subject/unit combination
 *
 * When multiple classifications are provided (e.g. high + middle union), vocab from
 * all of them is unioned — a value matching ANY classification passes.
 */
export function checkTextVocabulary(
  xml: string,
  file: string,
  unitClassifications: UnitClassification | UnitClassification[],
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  // Normalise to array for uniform handling
  const classificationArray = Array.isArray(unitClassifications) ? unitClassifications : [unitClassifications];

  // Collect all subject names and all topics from all classifications (current + legacy)
  const allSubjectNames = new Set<string>();
  const allTopics = new Set<string>();
  const allUnitNames = new Set<string>();

  for (const classification of classificationArray) {
    const allSubjects = [
      ...classification.subjects,
      ...(classification.legacy?.subjects ?? []),
    ];

    for (const subject of allSubjects) {
      allSubjectNames.add(subject.name);
      for (const unit of subject.units) {
        allUnitNames.add(unit.name);
        for (const topic of unit.topics) {
          allTopics.add(topic);
        }
      }
    }
  }

  const visibleText = textNodes(xml).join("\n");

  // [중단원] check
  for (const match of visibleText.matchAll(/\[중단원\]\s*([^\s\[]+(?:\s+[^\s\[]+)*)/g)) {
    const value = match[1].trim();
    if (!allTopics.has(value) && !allUnitNames.has(value)) {
      issues.push({
        ruleId: "text.vocabulary",
        severity: "error",
        message: `Unknown 중단원 value: "${value}" — not found in unit_classification.json`,
        file,
        evidence: snippet(match[0]),
      });
    }
  }

  // [과목] check
  for (const match of visibleText.matchAll(/\[과목\]\s*([^\s\[]+(?:\s+[^\s\[]+)*)/g)) {
    const value = match[1].trim();
    if (!allSubjectNames.has(value)) {
      issues.push({
        ruleId: "text.vocabulary",
        severity: "error",
        message: `Unknown 과목 value: "${value}" — not found in unit_classification.json`,
        file,
        evidence: snippet(match[0]),
      });
    }
  }

  // [범위] check — same pool as 중단원/topics
  for (const match of visibleText.matchAll(/\[범위\]\s*([^\s\[]+(?:\s+[^\s\[]+)*)/g)) {
    const value = match[1].trim();
    if (!allTopics.has(value) && !allUnitNames.has(value)) {
      issues.push({
        ruleId: "text.vocabulary",
        severity: "error",
        message: `Unknown 범위 value: "${value}" — not found in unit_classification.json`,
        file,
        evidence: snippet(match[0]),
      });
    }
  }

  return issues;
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g)].map((match) => match[1]);
}

function equationScripts(xml: string): string[] {
  return [...xml.matchAll(/<hp:script\b[^>]*>([\s\S]*?)<\/hp:script>/g)].map((match) => match[1]);
}

function snippet(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 160);
}

// ──────────────────────────────────────────────
// XML-level fix: equation.run_on
// ──────────────────────────────────────────────

/**
 * Split run-on equations in section XML.
 *
 * For each `<hp:equation>` block whose `<hp:script>` content has ≥2 top-level
 * `=` signs, split it into multiple sibling `<hp:equation>` elements separated
 * by a `<hp:t> </hp:t>` glue node.
 *
 * The outer `<hp:equation>` tag (including all attributes) is preserved for
 * each segment. Idempotent: a script with exactly 1 top-level `=` is not touched.
 */
export function fixRunOnEquationsInXml(xml: string): string {
  // Match the entire <hp:equation ...>...<hp:script ...>CONTENT</hp:script>...</hp:equation>
  // Captures: (1) opening tag+attrs, (2) markup before script content, (3) script content, (4) close side
  const EQUATION_PATTERN = /(<hp:equation\b[^>]*>)([\s\S]*?<hp:script\b[^>]*>)([\s\S]*?)(<\/hp:script>[\s\S]*?<\/hp:equation>)/g;

  return xml.replace(EQUATION_PATTERN, (_fullMatch, openTag, beforeScript, scriptContent, afterScript) => {
    const segments = splitTopLevelEqChecker(scriptContent);
    if (segments.length <= 1) {
      return _fullMatch;
    }

    // Build replacement: one <hp:equation> per segment, glued with <hp:t> </hp:t>
    return segments
      .map((seg, i) => {
        const eq = `${openTag}${beforeScript}${seg}${afterScript}`;
        return i < segments.length - 1 ? `${eq}<hp:t> </hp:t>` : eq;
      })
      .join("");
  });
}

/**
 * Minimal top-level `=` splitter — equivalent to `splitTopLevelEq` from
 * lib/parts/normalize.ts, inlined here to avoid a cross-boundary import.
 *
 * Returns segments. If fewer than 2 top-level `=` signs → returns [script].
 */
function splitTopLevelEqChecker(script: string): string[] {
  const eqPositions: number[] = [];
  let depth = 0;
  let inBacktick = false;
  let i = 0;

  while (i < script.length) {
    const c = script[i];
    if (c === "`") { inBacktick = !inBacktick; i++; continue; }
    if (!inBacktick) {
      if (c === "{") { depth++; i++; continue; }
      if (c === "}") { depth--; i++; continue; }
      if (depth === 0) {
        if (script.startsWith("LEFT(", i)) { depth++; i += 5; continue; }
        if (script.startsWith("LEFT (", i)) { depth++; i += 6; continue; }
      }
      if (depth === 1) {
        if (script.startsWith("RIGHT)", i)) { depth--; i += 6; continue; }
        if (script.startsWith("RIGHT )", i)) { depth--; i += 7; continue; }
      }
      if (depth === 0 && c === "=") { eqPositions.push(i); }
    }
    i++;
  }

  if (eqPositions.length < 2) return [script];

  const segments: string[] = [];
  segments.push(script.slice(0, eqPositions[1]).trimEnd());
  for (let k = 1; k < eqPositions.length - 1; k++) {
    segments.push(script.slice(eqPositions[k], eqPositions[k + 1]).trim());
  }
  segments.push(script.slice(eqPositions[eqPositions.length - 1]).trim());
  return segments.filter((s) => s.trim().length > 0);
}
