import type { ExamMetaInput } from "@/lib/exam/meta";

export type ParsedFilenameMeta = ExamMetaInput;

const SUBJECT_MAP: Record<string, string> = {
  수1: "수학 I",
  수I: "수학 I",
  "수학1": "수학 I",
  "수학I": "수학 I",
  수2: "수학 II",
  수II: "수학 II",
  "수학2": "수학 II",
  "수학II": "수학 II",
  확통: "확률과 통계",
  미적: "미적분",
  미적분: "미적분",
  기하: "기하",
};

const EXAM_MAP: Record<string, string> = {
  a: "중간",
  mid: "중간",
  middle: "중간",
  b: "기말",
  final: "기말",
};

const SCHOOL_LEVEL_PATTERN = /^(고|중|초|고등|중등|초등)$/;
const YEAR_PATTERN = /^(19|20)\d{2}$/;
const CODE_PATTERN = /^\d{4,}$/;
const GRADE_SEMESTER_EXAM_PATTERN = /^([1-3])-([12])-(a|b|mid|middle|final)$/i;
const PUBLISHER_PATTERN = /^(신사고|미래엔|비상|천재|교학사|동아|지학사|금성|개념원리|마플)$/;

export function parseExamMetaFromFilename(fileName: string): ParsedFilenameMeta | null {
  const normalized = fileName.normalize("NFC").replace(/\.[^.]+$/, "");
  const parts = Array.from(normalized.matchAll(/\[([^\]]*)\]/g), (match) => match[1].trim());

  if (parts.length === 0) return null;

  const parsed: ParsedFilenameMeta = {};
  const used = new Set<number>();

  const gradeTokenIndex = parts.findIndex((part) => GRADE_SEMESTER_EXAM_PATTERN.test(part));
  if (gradeTokenIndex >= 0) {
    const match = parts[gradeTokenIndex].match(GRADE_SEMESTER_EXAM_PATTERN);
    if (match) {
      parsed.grade = Number(match[1]);
      parsed.semester = `${match[2]}학기`;
      parsed.examType = EXAM_MAP[match[3].toLowerCase()];
      used.add(gradeTokenIndex);
    }
  }

  const yearTokenIndex = parts.findIndex((part, index) => YEAR_PATTERN.test(part) && !used.has(index));
  if (yearTokenIndex >= 0) {
    parsed.year = Number(parts[yearTokenIndex]);
    used.add(yearTokenIndex);
  }

  const subjectTokenIndex = parts.findIndex((part) => SUBJECT_MAP[part] !== undefined);
  if (subjectTokenIndex >= 0) {
    parsed.subject = SUBJECT_MAP[parts[subjectTokenIndex]];
    used.add(subjectTokenIndex);
  }

  const schoolIndex = findSchoolTokenIndex(parts, used);
  if (schoolIndex >= 0) {
    parsed.school = parts[schoolIndex];
    used.add(schoolIndex);
  }

  const rangeIndex = findRangeTokenIndex(parts, used);
  if (rangeIndex >= 0) {
    parsed.range = parts[rangeIndex];
  }

  // 학교급 토큰 파싱: "고"/"고등" → "고", "중"/"중등" → "중"
  const schoolLevelTokenIndex = parts.findIndex((part) => SCHOOL_LEVEL_PATTERN.test(part));
  if (schoolLevelTokenIndex >= 0) {
    parsed.schoolLevel = parseSchoolLevelToken(parts[schoolLevelTokenIndex]);
  }

  return Object.values(parsed).some((value) => value !== undefined) ? parsed : null;
}

function findSchoolTokenIndex(parts: string[], used: Set<number>) {
  const subjectIndex = parts.findIndex((part) => SUBJECT_MAP[part] !== undefined);
  if (subjectIndex > 0) {
    for (let index = subjectIndex - 1; index >= 0; index--) {
      if (isLikelySchoolToken(parts[index]) && !used.has(index)) return index;
    }
  }

  return parts.findIndex((part, index) => isLikelySchoolToken(part) && !used.has(index));
}

function findRangeTokenIndex(parts: string[], used: Set<number>) {
  const subjectIndex = parts.findIndex((part) => SUBJECT_MAP[part] !== undefined);
  const startIndex = subjectIndex >= 0 ? subjectIndex + 1 : 0;

  for (let index = startIndex; index < parts.length; index++) {
    const part = parts[index];
    if (used.has(index)) continue;
    if (isStructuralToken(part)) continue;
    if (PUBLISHER_PATTERN.test(part)) continue;
    if (isLikelySchoolToken(part)) continue;
    return index;
  }

  return -1;
}

function isLikelySchoolToken(part: string) {
  return /(?:고|고등학교|중|중학교|초|초등학교)$/.test(part) && !SCHOOL_LEVEL_PATTERN.test(part);
}

function isStructuralToken(part: string) {
  return (
    CODE_PATTERN.test(part) ||
    YEAR_PATTERN.test(part) ||
    SCHOOL_LEVEL_PATTERN.test(part) ||
    GRADE_SEMESTER_EXAM_PATTERN.test(part) ||
    PUBLISHER_PATTERN.test(part) ||
    SUBJECT_MAP[part] !== undefined
  );
}

/**
 * Parse school level token ("중"/"중등" → "중", "고"/"고등" → "고").
 * Returns undefined for tokens that don't match SCHOOL_LEVEL_PATTERN.
 */
export function parseSchoolLevelToken(part: string): "중" | "고" | undefined {
  if (!SCHOOL_LEVEL_PATTERN.test(part)) return undefined;
  return part === "중" || part === "중등" ? "중" : "고";
}
