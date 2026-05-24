export function buildCropPrompt(pdfPath: string, outputDir: string): string {
  return [
    `PDF 시험지의 각 문제를 개별 이미지로 크롭해줘.`,
    ``,
    `- PDF 경로: ${pdfPath}`,
    `- 출력 디렉토리: ${outputDir}`,
    ``,
    `Skill 도구로 "exam-crop" 스킬을 호출해서 진행해.`,
  ].join("\n");
}
