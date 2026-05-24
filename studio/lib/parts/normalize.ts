/**
 * normalize.ts — Parts array deterministic normalizer (TS side, Phase 3)
 *
 * Implements rules R-01 through R-10 per:
 * docs/planning/create-v4-deterministic-codification/rule-taxonomy.md
 *
 * This is the 1차 defense layer. The Python normalizer in equation.py is the
 * safety net. Both implementations share the same fixture set to guarantee
 * equivalence.
 *
 * All transforms are idempotent: normalizeParts(normalizeParts(x)) == normalizeParts(x)
 */

export type Part = { t: string } | { eq: string } | { br: true };

/**
 * Apply deterministic normalization rules to a parts array.
 * Idempotent. Rules implemented per
 * docs/planning/create-v4-deterministic-codification/rule-taxonomy.md.
 */
export function normalizeParts(parts: Part[]): Part[] {
  // R-01: split equation chains first (structural transform)
  const split = splitEquationChains(parts);
  // R-02 ~ R-10: per-part transforms
  return split.map(normalizePart);
}

function normalizePart(part: Part): Part {
  if ("eq" in part) {
    let s = part.eq;
    s = fixDeg(s);                        // R-02
    s = fixBulletToCdot(s);               // R-03
    s = wrapCdots(s);                     // R-04
    s = commaTilde(s);                    // R-05
    s = leftRightSpace(s);               // R-06
    s = fixPermutationCombination(s);    // R-08 (before R-07: 2-pass)
    s = leadingUnderscoreToLsub(s);      // R-07 (2-pass: applied after R-08)
    s = enforceRmUnits(s);               // R-09 (eq-side unit enforcement)
    s = operatorSpaces(s);               // R-10
    return { eq: s };
  }
  if ("t" in part) {
    return { t: enforceRmUnits(part.t) }; // R-09 (text-side)
  }
  return part;
}

// ─── R-01: 통수식 split (top-level = 기반 분리) ───────────────────────────────

/**
 * Split equation chains: for each eq part, if there are ≥2 top-level '='
 * signs (outside {}, LEFT()/RIGHT(), backticks), split into multiple eq parts
 * separated by {t: " "} glue.
 */
function splitEquationChains(parts: Part[]): Part[] {
  const result: Part[] = [];
  for (const part of parts) {
    if ("eq" in part) {
      const segments = splitTopLevelEq(part.eq);
      if (segments.length <= 1) {
        result.push(part);
      } else {
        for (let i = 0; i < segments.length; i++) {
          result.push({ eq: segments[i] });
          if (i < segments.length - 1) {
            result.push({ t: " " });
          }
        }
      }
    } else {
      result.push(part);
    }
  }
  return result;
}

/**
 * Split a HWP equation script at top-level '=' boundaries.
 *
 * Returns an array of segments. The first segment includes everything up to
 * (and including) the first '='. Subsequent segments start with '='.
 * Split only occurs when there are ≥2 top-level '=' signs.
 *
 * Examples:
 *   "f(x) = x^2 = y"       → ["f(x) = x^2", "= y"]          (2 top-level =)
 *   "a = b = c = d"         → ["a = b", "= c", "= d"]         (3 top-level =)
 *   "f(x) = x^2"            → ["f(x) = x^2"]                  (1 top-level =, no split)
 *   "k = LEFT(a=1 RIGHT)+m" → ["k = LEFT(a=1 RIGHT)+m"]       (= inside LEFT() ignored)
 *
 * Depth tracking:
 * - '{' / '}' → depth ±1
 * - 'LEFT(' or 'LEFT (' keyword → depth +1
 * - 'RIGHT)' or 'RIGHT )' keyword → depth -1
 * - backtick '`' toggles raw mode (= inside backticks ignored)
 *
 * This algorithm is intentionally equivalent to Python _split_top_level_eq.
 */
export function splitTopLevelEq(script: string): string[] {
  // Collect positions of all top-level '=' signs
  const eqPositions: number[] = [];

  let depth = 0;
  let inBacktick = false;
  let i = 0;

  while (i < script.length) {
    const c = script[i];

    if (c === "`") {
      inBacktick = !inBacktick;
      i++;
      continue;
    }

    if (!inBacktick) {
      if (c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        i++;
        continue;
      }
      // LEFT( or LEFT ( keyword — check at depth == 0
      if (depth === 0) {
        if (script.startsWith("LEFT(", i)) {
          depth++;
          i += 5;
          continue;
        }
        if (script.startsWith("LEFT (", i)) {
          depth++;
          i += 6;
          continue;
        }
      }
      // RIGHT) or RIGHT ) keyword — check at depth == 1
      if (depth === 1) {
        if (script.startsWith("RIGHT)", i)) {
          depth--;
          i += 6;
          continue;
        }
        if (script.startsWith("RIGHT )", i)) {
          depth--;
          i += 7;
          continue;
        }
      }
      // Record top-level '='
      if (depth === 0 && c === "=") {
        eqPositions.push(i);
      }
    }

    i++;
  }

  // No split if fewer than 2 top-level '=' signs
  if (eqPositions.length < 2) {
    return [script];
  }

  // Split at the SECOND and subsequent '=' signs.
  // Segment 0: script[0 .. eqPositions[1]) trimmed
  // Segment k (k>=1): script[eqPositions[k] .. eqPositions[k+1]) trimmed (both ends)
  const segments: string[] = [];

  // First segment: [0, eqPositions[1])  — trim trailing only (preserve leading content)
  segments.push(script.slice(0, eqPositions[1]).trimEnd());

  // Middle segments: [eqPositions[k], eqPositions[k+1]) for k = 1..n-2 — trim both ends
  for (let k = 1; k < eqPositions.length - 1; k++) {
    segments.push(script.slice(eqPositions[k], eqPositions[k + 1]).trim());
  }

  // Last segment: [eqPositions[last], end) — trim both ends
  segments.push(script.slice(eqPositions[eqPositions.length - 1]).trim());

  // Filter empty (shouldn't happen but be safe)
  return segments.filter((s) => s.trim().length > 0);
}

// ─── R-02: DEG 붙여쓰기 ───────────────────────────────────────────────────────

/**
 * Remove space between a number and DEG: "60 DEG" → "60DEG"
 */
function fixDeg(s: string): string {
  return s.replace(/(\d)\s+DEG/g, "$1DEG");
}

// ─── R-03: bullet 기호 → cdot 치환 ────────────────────────────────────────────

/**
 * Replace bullet characters with cdot:
 * · (U+00B7), • (U+2022), ⋅ (U+22C5) → cdot
 */
function fixBulletToCdot(s: string): string {
  return s.replace(/[·•⋅]/g, "cdot");
}

// ─── R-04: cdots 역따옴표 감싸기 ──────────────────────────────────────────────

/**
 * Wrap bare cdots with backticks: cdots → `cdots`
 * Does not double-wrap already-wrapped `cdots`.
 */
function wrapCdots(s: string): string {
  // Replace cdots not already surrounded by backticks
  // Negative lookbehind/lookahead for backtick
  return s.replace(/(?<!`)(cdots)(?!`)/g, "`$1`");
}

// ─── R-05: 쉼표 뒤 ~ 자동 삽입 ──────────────────────────────────────────────

/**
 * After a comma in a HWP equation, ensure there is a '~' spacer.
 * "," followed by nothing, or followed by a space (not ~): insert ~
 * "," already followed by ~ or ~+space: leave as-is.
 *
 * Pattern: "," not followed by "~" → ",~"
 * We preserve existing ",~ " as-is (idempotent).
 */
function commaTilde(s: string): string {
  // Replace "," not followed by "~" with ",~"
  // Use negative lookahead: ,(?!~)
  return s.replace(/,(?!~)(\s*)/g, ",~ ");
}

// ─── R-06: LEFT/RIGHT 공백 보강 ────────────────────────────────────────────────

/**
 * Ensure space between LEFT and ( and between RIGHT and ):
 * LEFT( → LEFT (, RIGHT) → RIGHT )
 * Case-insensitive for left/right variants.
 * Idempotent: already-spaced is unchanged.
 */
function leftRightSpace(s: string): string {
  // LEFT( → LEFT ( (only when no space between)
  s = s.replace(/LEFT\(/g, "LEFT (");
  // RIGHT) → RIGHT ) (only when no space between)
  s = s.replace(/RIGHT\)/g, "RIGHT )");
  return s;
}

// ─── R-07: leading _ → LSUB (2-pass: applied after R-08) ─────────────────────

/**
 * R-07: leading '_' → '{} LSUB {token}' transform.
 *
 * 2-pass algorithm: called AFTER R-08 (fixPermutationCombination), so any
 * _nC_r / _nP_r / _nH_r patterns are already converted. Only residual
 * leading '_' patterns remain for LSUB transformation.
 *
 * Idempotent: '{} LSUB {n}' starts with '{' (not '_') so it won't re-match.
 *
 * Examples:
 *   "_n"       → "{} LSUB {n}"
 *   "_{n+1}"   → "{} LSUB {n+1}"
 *   "x^2_n"    → "x^2_n"     (not leading)
 *   "_5C_3"    → already handled by R-08 → "{it`_5`}{rm C}_{it 3}"  (no leading _ left)
 */
function leadingUnderscoreToLsub(s: string): string {
  // Match leading _ followed by a braced group or a simple alphanumeric token
  const m = s.match(/^(\s*)_(\{[^}]+\}|[A-Za-z0-9]+)([\s\S]*)$/);
  if (!m) return s;
  const [, prefix, token, rest] = m;
  // Preserve existing braces, or wrap bare token in braces
  const tokenBraced = token.startsWith("{") ? token : `{${token}}`;
  return `${prefix}{} LSUB ${tokenBraced}${rest}`;
}

// ─── R-08: 순열/조합 패턴 정규화 ──────────────────────────────────────────────

/**
 * Normalize permutation/combination/repetition patterns:
 * _nC_r / _{n}C_{r}  → {it`_n`}{rm C}_{it r}
 * _nP_r / _{n}P_{r}  → {it`_n`}{rm P}_{it r}
 * _nH_r / _{n}H_{r}  → {it`_n`}{rm H}_{it r}
 *
 * Already-normalized patterns (containing {rm C}, {rm P}, {rm H}) are left unchanged.
 */
function fixPermutationCombination(s: string): string {
  // Idempotency guard: if already has {rm C}/{rm P}/{rm H} pattern, skip
  if (/\{rm [CPH]\}/.test(s)) {
    return s;
  }

  // Match: _{n}C_{r} or _nC_r (where n and r can be bare tokens or {grouped})
  // Pattern: _ followed by optional {}, a letter/number, then C/P/H, then _ followed by optional {}, a letter/number
  const pattern = /_((\{[^}]+\})|([A-Za-z0-9]+))\s*([CPH])\s*_((\{[^}]+\})|([A-Za-z0-9]+))/g;

  return s.replace(pattern, (_match, _nGroup, nBraced, nBare, op, _rGroup, rBraced, rBare) => {
    // Format: {it`_n`}{rm C}_{it r}
    // For braced n: _{10} → `_{10}` inside it
    // For bare n: _5 → `_5` inside it
    const nContent = nBraced ? `_${nBraced}` : `_${nBare}`;
    // r inside it: bare r or content of braced r
    const rContent = rBraced ? rBraced.slice(1, -1) : rBare; // strip { } from rBraced

    return `{it\`${nContent}\`}{rm ${op}}_{it ${rContent}}`;
  });
}

// ─── R-09: rm체 단위 enforcement ─────────────────────────────────────────────

/**
 * Enforce rm (roman) font for physical units in equations.
 *
 * This is a PARTIAL rule (codifiable only in unambiguous contexts).
 * Only applies when a unit word directly follows a number (with optional space).
 * Single-letter units like m, s, g are extremely ambiguous as variable names,
 * so they are ONLY converted when immediately preceded by a digit.
 *
 * Idempotent: "rm kg" stays "rm kg".
 *
 * Patterns matched:
 *   (\d) (kg|g|m|cm|km|mm|s|A|N|J|W|V|Hz|Pa|K|mol|cd|rad)  → "$1 rm unit"
 *   (\d) rm unit → unchanged (idempotent guard)
 *
 * Units NOT already preceded by "rm " and following a digit get "rm " added.
 */
function enforceRmUnits(s: string): string {
  // Multi-char units first to avoid partial match (km before m, etc.)
  const UNITS_AFTER_NUMBER = [
    "mol", "rad", "km", "cm", "mm", "kg",
    "Hz", "Pa", "cd",
    "m", "s", "g", "A", "N", "J", "W", "V", "K",
  ];

  // Pattern: digit (with optional space) then unit (not already preceded by "rm ")
  // We use a single pass per unit: (\d)\s+(unit)\b where unit is not already "rm unit"
  for (const unit of UNITS_AFTER_NUMBER) {
    // Match: digit + spaces + unit (not already "rm unit")
    // Use lookbehind to ensure not already "rm "
    const re = new RegExp(`(\\d)\\s+(?<!rm )(${unit})(?![a-zA-Z])`, "g");
    s = s.replace(re, `$1 rm $2`);

    // Also match: digit immediately followed by unit (no space): "150kg" → "150 rm kg"
    const reNoSpace = new RegExp(`(\\d)(${unit})(?![a-zA-Z])`, "g");
    s = s.replace(reNoSpace, `$1 rm $2`);
  }

  return s;
}

// ─── R-10: 수식 연산자 앞뒤 공백 ─────────────────────────────────────────────

/**
 * Ensure spaces around binary operators: +, -, =, <, >, ≤, ≥, ≠
 *
 * Protected (operators inside these are NOT spaced):
 * - {} brace blocks (exponent/subscript context: x^{n+1})
 * - () parentheses (grouping: (x+1)^2 — internal + not spaced)
 * - backtick blocks (`cdots`)
 *
 * Unary minus/plus (at start of expression or after another op) not spaced.
 * Idempotent: existing spaces are preserved (multi-space collapsed to single).
 * Result is trimmed to avoid spurious leading/trailing spaces.
 */
function operatorSpaces(s: string): string {
  // We do a single character-by-character pass.
  // Track depth for {} and () and backtick mode.
  // Only apply spacing at depth 0 (outside all brackets).

  const OPS = /[+\-=<>≤≥≠]/;

  let result = "";
  let depth = 0; // depth for {} and ()
  let inBacktick = false;

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    // Backtick toggle
    if (c === "`") {
      inBacktick = !inBacktick;
      result += c;
      i++;
      continue;
    }

    // Inside backtick or depth > 0: pass through as-is
    if (inBacktick || depth > 0) {
      if (c === "{" || c === "(") depth++;
      else if (c === "}" || c === ")") depth--;
      result += c;
      i++;
      continue;
    }

    // Depth 0, not in backtick
    if (c === "{" || c === "(") {
      depth++;
      result += c;
      i++;
      continue;
    }
    if (c === "}" || c === ")") {
      depth--;
      result += c;
      i++;
      continue;
    }

    // Operator at top-level
    if (OPS.test(c)) {
      const trimmedResult = result.trimEnd();

      // Check for unary context: nothing before, or previous non-space char is an operator.
      // NOTE: We check prevSignificant on trimmedResult (without trailing spaces).
      // This matches Python _apply_spacing which looks at the original tokens list:
      // an operator is "unary" if prev_non_space is None (start of expr) or another operator.
      const lastChar = trimmedResult.length > 0 ? trimmedResult[trimmedResult.length - 1] : "";
      const isUnary =
        lastChar === "" || OPS.test(lastChar) || lastChar === "(" || lastChar === "{";

      if (isUnary) {
        // Unary context: no extra spacing added.
        // However, if the result has a trailing space (added by a preceding binary operator),
        // preserve exactly one space so "x = -1" stays "x = -1" (Python parity).
        // Python preserves raw space tokens before unary operators.
        // We do NOT skip trailing input spaces after unary ops — Python preserves them.
        const hasTrailingSpace = result.length > 0 && result[result.length - 1] === " ";
        result = (hasTrailingSpace ? trimmedResult + " " : trimmedResult) + c;
        i++;
        continue;
      }

      // Binary operator: " op " spacing
      result = trimmedResult + " " + c + " ";
      i++;
      // Skip existing trailing spaces
      while (i < s.length && s[i] === " ") i++;
      continue;
    }

    result += c;
    i++;
  }

  // Collapse multiple spaces, then trim
  return result.replace(/  +/g, " ").trim();
}
