"use client";

import type { SchoolLevel, ExamMeta } from "@/lib/exam/meta";

export type { SchoolLevel };

/** MetaValue = ExamMeta (the 8 required UI fields). */
export type MetaValue = ExamMeta;

export const HIGH_SCHOOL_SUBJECTS = ["수학", "수학 I", "수학 II", "확률과 통계", "미적분", "기하"] as const;
export const MIDDLE_SCHOOL_SUBJECT = "수학";

export interface MetaFormProps {
  value: MetaValue;
  onChange: (next: MetaValue) => void;
  disabled?: boolean;
}

export function MetaForm({ value, onChange, disabled }: MetaFormProps) {
  const yearOptions = Array.from({ length: 6 }, (_, i) => value.year - i);
  const fieldClass =
    "w-full mt-0.5 px-2 py-1.5 rounded-md border bg-background text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const isMiddle = value.schoolLevel === "중";
  const handleSchoolLevelChange = (next: SchoolLevel) => {
    // 중학교 선택 시 과목을 단일 옵션으로 고정 (extractor 가 schoolLevel 로 분기).
    const nextSubject = next === "중" ? MIDDLE_SCHOOL_SUBJECT : (value.subject || HIGH_SCHOOL_SUBJECTS[0]);
    onChange({ ...value, schoolLevel: next, subject: nextSubject });
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">학교급</label>
          <select
            value={value.schoolLevel}
            onChange={(e) => handleSchoolLevelChange(e.target.value as SchoolLevel)}
            disabled={disabled}
            className={fieldClass}
          >
            <option value="고">고등학교</option>
            <option value="중">중학교</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">학년도</label>
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
        </div>
        <div>
          <label className="text-xs text-muted-foreground">학교</label>
          <input
            type="text"
            value={value.school}
            onChange={(e) => onChange({ ...value, school: e.target.value })}
            placeholder={isMiddle ? "OO중학교" : "OO고등학교"}
            disabled={disabled}
            className={fieldClass}
          />
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
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">과목</label>
          <select
            value={value.subject}
            onChange={(e) => onChange({ ...value, subject: e.target.value })}
            disabled={disabled || isMiddle}
            title={isMiddle ? "중학교는 단일 과목(수학)으로 고정됩니다." : undefined}
            className={fieldClass}
          >
            {isMiddle
              ? <option value={MIDDLE_SCHOOL_SUBJECT}>{MIDDLE_SCHOOL_SUBJECT}</option>
              : HIGH_SCHOOL_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">학기</label>
          <select
            value={value.semester}
            onChange={(e) => onChange({ ...value, semester: e.target.value })}
            disabled={disabled}
            className={fieldClass}
          >
            <option>1학기</option>
            <option>2학기</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">시험</label>
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
        </div>
        <div>
          <label className="text-xs text-muted-foreground">범위</label>
          <input
            type="text"
            value={value.range}
            onChange={(e) => onChange({ ...value, range: e.target.value })}
            placeholder={isMiddle ? "정수와 유리수 ~ 일차방정식" : "지수 ~ 삼각함수그래프"}
            disabled={disabled}
            className={fieldClass}
          />
        </div>
      </div>
    </div>
  );
}
