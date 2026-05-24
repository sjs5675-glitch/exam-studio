import { describe, it, expect } from "vitest";
import {
  buildCropPrompt,
} from "../prompts";

describe("buildCropPrompt", () => {
  it("calls exam-crop skill", () => {
    const result = buildCropPrompt("/tmp/test.pdf", "/tmp/out");
    expect(result).toContain('Skill 도구로 "exam-crop" 스킬을 호출');
  });

  it("includes source PDF and output directory", () => {
    const result = buildCropPrompt("/tmp/test.pdf", "/tmp/out");
    expect(result).toContain("- PDF 경로: /tmp/test.pdf");
    expect(result).toContain("- 출력 디렉토리: /tmp/out");
  });
});
