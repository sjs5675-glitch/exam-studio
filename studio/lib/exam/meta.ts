export type SchoolLevel = "중" | "고";
export type DocumentKind = "science_exam" | "science_workbook";
export type Curriculum = "22개정" | "15개정" | "기타";
export type WorkbookRole = "student" | "teacher";
export type WorkbookBookType = "본문" | "시험대비" | "정답과 해설" | "T-Book" | "기타";
export type ScienceSubject = "중등과학" | "통합과학" | "물리학" | "화학" | "생명과학" | "지구과학" | "기타";
export type FigureMode = "original" | "grayscale" | "chatgpt-image2" | "auto";
export type AnswerPolicy = "none" | "remove" | "blue_keep" | "answer_book_match" | "ai_generate";
export type EndnoteMode = "answer_and_explanation" | "answer_only";

/** 시험지 메타데이터 — 디스크/네트워크/메모리 단일 표준 (camelCase only). */
export interface ExamMeta {
  /** 작업 종류. 미지정이면 기존 수학 시험지 흐름과 호환한다. */
  documentKind?: DocumentKind;
  schoolLevel: SchoolLevel;
  school: string;
  grade: number;
  year: number;
  subject: string;
  semester: string;
  examType: string;
  range: string;
  curriculum?: Curriculum;
  publisher?: string;
  bookTitle?: string;
  bookType?: WorkbookBookType;
  workbookRole?: WorkbookRole;
  bookVolume?: string;
  outputVersion?: string;
  answerPolicy?: AnswerPolicy;
  figureMode?: FigureMode;
  /** 문제집 고유 번호, 출판사 태그 등 결과물에서 제거할 요소들. */
  removeProblemIds?: boolean;
  removeImportanceTags?: boolean;
  removeQrCodes?: boolean;
  removePageFooters?: boolean;
  removePublisherBadges?: boolean;
  /** HWPX 문항 아래에 [중단원], [난이도] 메타 문단을 표시할지 여부. */
  showProblemMetadata?: boolean;
  endnoteMode?: EndnoteMode;
  /** subject 코드(파일명용). 미지정 시 buildFilenameBase가 subject로 폴백. */
  subjectCode?: string;
  /** 지역 코드(파일명용). 빈 문자열 허용. */
  region?: string;
  /** 작업자 코드(파일명용). */
  code?: string;
  /** 교과서명(선택). */
  textbook?: string;
  /** 총 페이지수(선택). */
  totalPages?: number;
  /** 빌더가 생성한 파일명 prefix. buildFilenameBase의 결정적 출력. */
  filenameBase?: string;
}

/** 부분 입력 — POST body / 폼 상태 등에서 점진적으로 채워질 때 사용. */
export type ExamMetaInput = Partial<ExamMeta>;

function isFilled(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

/** 작업 시작은 메타 입력 없이도 가능하다. 비어 있는 값은 normalizeExamMeta에서 기본값으로 채운다. */
export function isExamMetaComplete(m: ExamMetaInput): m is ExamMeta {
  return Boolean(m);
}

function cleanToken(value: unknown): string {
  return String(value ?? "").trim().replace(/\s*~\s*/g, "~");
}

function semesterCode(value: unknown): "1" | "2" {
  const token = cleanToken(value);
  if (/1\s*학기|-\s*1\b|(^|[^0-9])1\s*$/.test(token)) return "1";
  if (/2\s*학기|-\s*2\b|(^|[^0-9])2\s*$/.test(token)) return "2";
  return "1";
}

/**
 * 결정적 파일명 prefix 생성 — `[코드][학교급][년도][학년-학기-시험][지역][학교][과목][범위][코드]`.
 * 비어있는 토큰은 빈 brackets `[]` 로 둔다 (assemble.py 폴백과 동일 규칙).
 */
export function buildFilenameBase(meta: ExamMeta): string {
  const semNum = semesterCode(meta.documentKind === "science_workbook" ? (meta.bookVolume ?? meta.semester) : meta.semester);
  const examCode = meta.examType.includes("중간") ? "a" : meta.examType.includes("기말") ? "b" : "c";
  const range = cleanToken(meta.range);
  const subjectCode = meta.subjectCode ?? meta.subject;
  const code = meta.code ?? "";
  const region = meta.region ?? "";

  if (meta.documentKind === "science_workbook") {
    const roleLabel = meta.workbookRole === "teacher" ? "교사용" : "학생용";
    return [
      "과학문제집",
      cleanToken(meta.schoolLevel),
      cleanToken(meta.curriculum),
      `${cleanToken(meta.grade)}-${semNum}`,
      cleanToken(meta.publisher),
      cleanToken(meta.bookTitle),
      cleanToken(meta.bookType),
      cleanToken(roleLabel),
      cleanToken(subjectCode),
      cleanToken(meta.bookVolume),
      range,
    ].map((token) => `[${token}]`).join("");
  }

  if (meta.documentKind === "science_exam") {
    return `[${code}][과학시험지][${meta.schoolLevel}][${meta.year}][${meta.grade}-${semNum}-${examCode}][${region}][${meta.school}][${subjectCode}][${range}][${code}]`;
  }

  return `[${code}][${meta.schoolLevel}][${meta.year}][${meta.grade}-${semNum}-${examCode}][${region}][${meta.school}][${subjectCode}][${range}][${code}]`;
}

/** 비어 있는 메타 입력을 작업 가능한 완전한 메타로 보정한다. */
export function normalizeExamMeta(meta: ExamMetaInput = {}): ExamMeta {
  const complete: ExamMeta = {
    ...DEFAULT_EXAM_META,
    ...meta,
    documentKind: meta.documentKind ?? DEFAULT_EXAM_META.documentKind,
    schoolLevel: meta.schoolLevel ?? DEFAULT_EXAM_META.schoolLevel,
    school: meta.school ?? DEFAULT_EXAM_META.school,
    grade: meta.grade ?? DEFAULT_EXAM_META.grade,
    year: meta.year ?? DEFAULT_EXAM_META.year,
    subject: isFilled(meta.subject) ? meta.subject! : DEFAULT_EXAM_META.subject,
    semester: isFilled(meta.semester) ? meta.semester! : DEFAULT_EXAM_META.semester,
    examType: isFilled(meta.examType) ? meta.examType! : DEFAULT_EXAM_META.examType,
    range: meta.range ?? DEFAULT_EXAM_META.range,
    curriculum: meta.curriculum ?? DEFAULT_EXAM_META.curriculum,
    publisher: meta.publisher ?? DEFAULT_EXAM_META.publisher,
    bookTitle: meta.bookTitle ?? DEFAULT_EXAM_META.bookTitle,
    bookType: meta.bookType ?? DEFAULT_EXAM_META.bookType,
    workbookRole: meta.workbookRole ?? DEFAULT_EXAM_META.workbookRole,
    bookVolume: meta.bookVolume ?? DEFAULT_EXAM_META.bookVolume,
    outputVersion: meta.outputVersion ?? DEFAULT_EXAM_META.outputVersion,
    answerPolicy: meta.answerPolicy ?? DEFAULT_EXAM_META.answerPolicy,
    figureMode: meta.figureMode ?? DEFAULT_EXAM_META.figureMode,
    removeProblemIds: meta.removeProblemIds ?? DEFAULT_EXAM_META.removeProblemIds,
    removeImportanceTags: meta.removeImportanceTags ?? DEFAULT_EXAM_META.removeImportanceTags,
    removeQrCodes: meta.removeQrCodes ?? DEFAULT_EXAM_META.removeQrCodes,
    removePageFooters: meta.removePageFooters ?? DEFAULT_EXAM_META.removePageFooters,
    removePublisherBadges: meta.removePublisherBadges ?? DEFAULT_EXAM_META.removePublisherBadges,
    showProblemMetadata: meta.showProblemMetadata ?? DEFAULT_EXAM_META.showProblemMetadata,
    endnoteMode: meta.endnoteMode ?? DEFAULT_EXAM_META.endnoteMode,
  };
  complete.filenameBase = meta.filenameBase ?? buildFilenameBase(complete);
  return complete;
}

/** 기본 메타 — UI 폼 초기값으로 재사용. */
export const DEFAULT_EXAM_META: ExamMeta = {
  documentKind: "science_workbook",
  schoolLevel: "중",
  school: "",
  grade: 2,
  year: new Date().getFullYear(),
  subject: "중등과학",
  semester: "1학기",
  examType: "문제집",
  range: "",
  curriculum: "22개정",
  publisher: "",
  bookTitle: "",
  bookType: "본문",
  workbookRole: "student",
  bookVolume: "1학기",
  outputVersion: "학생용",
  answerPolicy: "none",
  figureMode: "auto",
  removeProblemIds: true,
  removeImportanceTags: true,
  removeQrCodes: true,
  removePageFooters: true,
  removePublisherBadges: true,
  showProblemMetadata: false,
  endnoteMode: "answer_and_explanation",
};
