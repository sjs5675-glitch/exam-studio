import { describe, expect, it } from "vitest";
import { parseExamMetaFromFilename } from "../filenameMeta";

describe("parseExamMetaFromFilename", () => {
  it("parses school grade subject semester and exam from bracketed names", () => {
    expect(
      parseExamMetaFromFilename("[04039][고][2025][2-1-b][대구][강북고][수2][04039].pdf")
    ).toEqual({
      school: "강북고",
      grade: 2,
      year: 2025,
      subject: "수학 II",
      semester: "1학기",
      examType: "기말",
      schoolLevel: "고",
    });
  });

  it("uses the range segment when the filename includes one", () => {
    expect(
      parseExamMetaFromFilename("[04039][고][2025][2-1-a][경기광명시][광명고][수1][지수-삼각함수의그래프][04039].pdf")
    ).toMatchObject({
      school: "광명고",
      grade: 2,
      year: 2025,
      subject: "수학 I",
      semester: "1학기",
      examType: "중간",
      range: "지수-삼각함수의그래프",
    });
  });

  it("does not depend on fixed token positions for normalized fields", () => {
    expect(
      parseExamMetaFromFilename("[04039][2025][고][대구][2-1-b][강북고][수2][04039].pdf")
    ).toMatchObject({
      school: "강북고",
      grade: 2,
      year: 2025,
      subject: "수학 II",
      semester: "1학기",
      examType: "기말",
    });
  });

  it("skips publisher tokens between subject and range", () => {
    expect(
      parseExamMetaFromFilename("[04058][고][2025][2-1-a][경기화성시][치동고][확통][신사고][여러가지순열-확률의뜻과활용][04058].pdf")
    ).toMatchObject({
      school: "치동고",
      grade: 2,
      year: 2025,
      subject: "확률과 통계",
      semester: "1학기",
      examType: "중간",
      range: "여러가지순열-확률의뜻과활용",
    });
  });

  it("returns undefined year when filename has no year token", () => {
    const result = parseExamMetaFromFilename("[강북고][수2][지수-삼각함수].pdf");
    expect(result).toMatchObject({ school: "강북고", subject: "수학 II" });
    expect(result?.year).toBeUndefined();
  });

  it("[중] 토큰 파일명 → schoolLevel === '중'", () => {
    const result = parseExamMetaFromFilename("[OSS][중][2024][3-1-a][서울][테스트중학교][수학][정수][OSS].pdf");
    expect(result?.schoolLevel).toBe("중");
  });

  it("[고] 토큰 파일명 → schoolLevel === '고'", () => {
    const result = parseExamMetaFromFilename("[04039][고][2025][2-1-b][대구][강북고][수2][04039].pdf");
    expect(result?.schoolLevel).toBe("고");
  });

  it("학교급 토큰 없는 파일명 → schoolLevel === undefined", () => {
    const result = parseExamMetaFromFilename("[강북고][수2][지수-삼각함수].pdf");
    expect(result?.schoolLevel).toBeUndefined();
  });
});
