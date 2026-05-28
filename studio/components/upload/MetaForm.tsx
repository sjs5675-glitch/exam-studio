"use client";

import type {
  Curriculum,
  DocumentKind,
  ExamMeta,
  FigureMode,
  SchoolLevel,
  WorkbookBookType,
  WorkbookRole,
} from "@/lib/exam/meta";

export type { Curriculum, DocumentKind, FigureMode, SchoolLevel, WorkbookBookType, WorkbookRole };

/** MetaValue = ExamMeta (UI and job metadata share one camelCase shape). */
export type MetaValue = ExamMeta;

export const SCIENCE_SUBJECTS = ["중등과학", "통합과학", "물리학", "화학", "생명과학", "지구과학", "기타"] as const;
export const CURRICULUM_OPTIONS = ["22개정", "15개정", "기타"] as const;
export const WORKBOOK_TYPES = ["본문", "시험대비", "정답과 해설", "T-Book", "기타"] as const;
export const WORKBOOK_ROLES = [
  { value: "student", label: "학생용" },
  { value: "teacher", label: "교사용" },
] as const;
export const FIGURE_MODES = [
  { value: "original", label: "원본" },
  { value: "grayscale", label: "흑백" },
  { value: "chatgpt-image2", label: "ChatGPT 이미지2" },
  { value: "auto", label: "설정값" },
] as const;

export interface MetaFormProps {
  value: MetaValue;
  onChange: (next: MetaValue) => void;
  disabled?: boolean;
}

export function MetaForm({ value, onChange, disabled }: MetaFormProps) {
  const yearOptions = Array.from({ length: 6 }, (_, i) => value.year - i);
  const fieldClass =
    "w-full mt-0.5 px-2 py-1.5 rounded-md border bg-background text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const isWorkbook = (value.documentKind ?? "science_workbook") === "science_workbook";

  const handleDocumentKindChange = (documentKind: DocumentKind) => {
    onChange({
      ...value,
      documentKind,
      examType: documentKind === "science_workbook" ? "문제집" : "중간",
      outputVersion: documentKind === "science_workbook"
        ? (value.workbookRole === "teacher" ? "교사용" : "학생용")
        : "시험지",
    });
  };

  const handleWorkbookRoleChange = (workbookRole: WorkbookRole) => {
    onChange({
      ...value,
      workbookRole,
      outputVersion: workbookRole === "teacher" ? "교사용" : "학생용",
      answerPolicy: workbookRole === "teacher" ? "blue_keep" : "none",
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">작업</label>
          <select
            value={value.documentKind ?? "science_workbook"}
            onChange={(e) => handleDocumentKindChange(e.target.value as DocumentKind)}
            disabled={disabled}
            className={fieldClass}
          >
            <option value="science_workbook">과학 문제집</option>
            <option value="science_exam">과학시험지</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">학교급</label>
          <select
            value={value.schoolLevel}
            onChange={(e) => onChange({ ...value, schoolLevel: e.target.value as SchoolLevel })}
            disabled={disabled}
            className={fieldClass}
          >
            <option value="중">중학교</option>
            <option value="고">고등학교</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">학년</label>
          <select
            value={value.grade}
            onChange={(e) => onChange({ ...value, grade: Number(e.target.value) })}
            disabled={disabled}
            className={fieldClass}
          >
            <option value={1}>1학년</option>
            <option value={2}>2학년</option>
            <option value={3}>3학년</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">과목</label>
          <select
            value={value.subject}
            onChange={(e) => onChange({ ...value, subject: e.target.value })}
            disabled={disabled}
            className={fieldClass}
          >
            {SCIENCE_SUBJECTS.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">교육과정</label>
          <select
            value={value.curriculum ?? "22개정"}
            onChange={(e) => onChange({ ...value, curriculum: e.target.value as Curriculum })}
            disabled={disabled}
            className={fieldClass}
          >
            {CURRICULUM_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{isWorkbook ? "출판사" : "학교"}</label>
          <input
            type="text"
            value={isWorkbook ? (value.publisher ?? "") : value.school}
            onChange={(e) => onChange(isWorkbook ? { ...value, publisher: e.target.value } : { ...value, school: e.target.value })}
            placeholder={isWorkbook ? "예: 미래엔, 천재교육" : "OO중학교"}
            disabled={disabled}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{isWorkbook ? "교재 종류" : "학년도"}</label>
          {isWorkbook ? (
            <select
              value={value.bookType ?? "본문"}
              onChange={(e) => onChange({ ...value, bookType: e.target.value as WorkbookBookType })}
              disabled={disabled}
              className={fieldClass}
            >
              {WORKBOOK_TYPES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : (
            <select
              value={value.year}
              onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
              disabled={disabled}
              className={fieldClass}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{isWorkbook ? "버전" : "시험"}</label>
          {isWorkbook ? (
            <select
              value={value.workbookRole ?? "student"}
              onChange={(e) => handleWorkbookRoleChange(e.target.value as WorkbookRole)}
              disabled={disabled}
              className={fieldClass}
            >
              {WORKBOOK_ROLES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <select
              value={value.examType}
              onChange={(e) => onChange({ ...value, examType: e.target.value })}
              disabled={disabled}
              className={fieldClass}
            >
              <option>중간</option>
              <option>기말</option>
              <option>모의</option>
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">{isWorkbook ? "권/학기" : "학기"}</label>
          <input
            type="text"
            value={isWorkbook ? (value.bookVolume ?? "") : value.semester}
            onChange={(e) => onChange(isWorkbook ? { ...value, bookVolume: e.target.value, semester: e.target.value } : { ...value, semester: e.target.value })}
            placeholder={isWorkbook ? "예: 1학기, 2-1" : "1학기"}
            disabled={disabled}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">교재명</label>
          <input
            type="text"
            value={value.bookTitle ?? ""}
            onChange={(e) => onChange({ ...value, bookTitle: e.target.value })}
            placeholder="예: 오투, 체크체크"
            disabled={disabled || !isWorkbook}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">그림</label>
          <select
            value={value.figureMode ?? "original"}
            onChange={(e) => onChange({ ...value, figureMode: e.target.value as FigureMode })}
            disabled={disabled}
            className={fieldClass}
          >
            {FIGURE_MODES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">범위</label>
          <input
            type="text"
            value={value.range}
            onChange={(e) => onChange({ ...value, range: e.target.value })}
            placeholder="예: 물질의 구성~전기와 자기"
            disabled={disabled}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={value.showProblemMetadata ?? false}
            onChange={(e) => onChange({ ...value, showProblemMetadata: e.target.checked })}
            disabled={disabled}
            className="accent-primary"
          />
          중단원/난이도 표시
        </label>
      </div>
    </div>
  );
}
