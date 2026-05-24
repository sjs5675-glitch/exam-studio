export type SchoolLevel = "중" | "고";

/** 시험지 메타데이터 — 디스크/네트워크/메모리 단일 표준 (camelCase only). */
export interface ExamMeta {
  schoolLevel: SchoolLevel;
  school: string;
  grade: number;
  year: number;
  subject: string;
  semester: string;
  examType: string;
  range: string;
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

/** 필수 필드 7개가 채워졌는지 검사. UI submit gating용. */
export function isExamMetaComplete(m: ExamMetaInput): m is ExamMeta {
  return Boolean(
    m.schoolLevel && m.school && m.grade && m.year &&
    m.subject && m.semester && m.examType && m.range != null
  );
}

/**
 * 결정적 파일명 prefix 생성 — `[코드][학교급][년도][학년-학기-시험][지역][학교][과목][범위][코드]`.
 * 비어있는 토큰은 빈 brackets `[]` 로 둔다 (assemble.py 폴백과 동일 규칙).
 */
export function buildFilenameBase(meta: ExamMeta): string {
  const semNum = meta.semester.includes("1학기") ? "1" : "2";
  const examCode = meta.examType.includes("중간") ? "a" : meta.examType.includes("기말") ? "b" : "c";
  const range = meta.range.replace(/\s*~\s*/g, "~");
  const subjectCode = meta.subjectCode ?? meta.subject;
  const code = meta.code ?? "";
  const region = meta.region ?? "";
  return `[${code}][${meta.schoolLevel}][${meta.year}][${meta.grade}-${semNum}-${examCode}][${region}][${meta.school}][${subjectCode}][${range}][${code}]`;
}

/** 기본 메타 — UI 폼 초기값으로 재사용. */
export const DEFAULT_EXAM_META: ExamMeta = {
  schoolLevel: "고",
  school: "",
  grade: 2,
  year: new Date().getFullYear(),
  subject: "수학 I",
  semester: "1학기",
  examType: "중간",
  range: "",
};
