/** 박스 좌표는 PDF 페이지가 렌더된 이미지의 픽셀 좌표계 (dpi=200 기준). */
export type PdfRotation = 0 | 90 | 180 | 270;

/**
 * 렌더 이미지에 적용된 수평 반전 상태.
 * true = 좌우 반전(horizontal flip) 적용.
 * 추후 vertical flip 확장 시 { h: boolean; v: boolean } 로 변경 가능.
 */
export type PdfFlip = boolean;

export interface CropBox {
  id: string;          // uuid (crypto.randomUUID())
  page: number;        // 0-indexed
  x: number;           // image-pixel
  y: number;
  w: number;
  h: number;
  number: number;      // 문제 번호 (1, 2, 3 ...)
  kind?: "regular" | "essay";  // 문제 유형 (미지정 시 "regular"로 해석)
}

export interface PageMeta {
  index: number;       // 0-indexed
  imageWidth: number;  // 렌더 PNG 픽셀 폭
  imageHeight: number;
}

/** crop 결과 (Phase 4의 추출 단계에서 생성) */
export interface CroppedProblem {
  number: number;
  blob: Blob;          // image/png
  sourceBox: CropBox;
}
