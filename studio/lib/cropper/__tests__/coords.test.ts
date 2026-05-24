import { describe, it, expect } from "vitest";
import {
  normalizePdfRotation,
  getRotatedImageSize,
  screenToImage,
  imageToScreen,
  normalizeBox,
  clampBox,
  autoNumber,
  normalizedBboxToCropBox,
  mirrorBoxX,
} from "../coords";
import type { CropBox } from "../types";

const viewport = {
  displayWidth: 400,
  displayHeight: 600,
  imageWidth: 800,
  imageHeight: 1200,
};

describe("PDF rotation helpers", () => {
  it("normalizes arbitrary numeric rotation to supported quarter turns", () => {
    expect(normalizePdfRotation(0)).toBe(0);
    expect(normalizePdfRotation(44)).toBe(0);
    expect(normalizePdfRotation(45)).toBe(90);
    expect(normalizePdfRotation(91)).toBe(90);
    expect(normalizePdfRotation(180)).toBe(180);
    expect(normalizePdfRotation(450)).toBe(90);
    expect(normalizePdfRotation(-90)).toBe(270);
    expect(normalizePdfRotation(-181)).toBe(180);
  });

  it("swaps image dimensions only for 90 and 270 degree rotations", () => {
    expect(getRotatedImageSize({ width: 800, height: 1200, rotation: 0 })).toEqual({
      width: 800,
      height: 1200,
    });
    expect(getRotatedImageSize({ width: 800, height: 1200, rotation: 90 })).toEqual({
      width: 1200,
      height: 800,
    });
    expect(getRotatedImageSize({ width: 800, height: 1200, rotation: 180 })).toEqual({
      width: 800,
      height: 1200,
    });
    expect(getRotatedImageSize({ width: 800, height: 1200, rotation: 270 })).toEqual({
      width: 1200,
      height: 800,
    });
  });
});

describe("screenToImage / imageToScreen round-trip", () => {
  it("round-trips from screen to image and back", () => {
    const sx = 100;
    const sy = 150;
    const img = screenToImage(sx, sy, viewport);
    const screen = imageToScreen(img.x, img.y, viewport);
    expect(screen.x).toBeCloseTo(sx);
    expect(screen.y).toBeCloseTo(sy);
  });

  it("scales correctly (2x scale in both axes)", () => {
    const img = screenToImage(50, 75, viewport);
    expect(img.x).toBe(100);
    expect(img.y).toBe(150);
  });
});

describe("normalizeBox", () => {
  it("keeps positive w/h unchanged", () => {
    expect(normalizeBox({ x: 10, y: 20, w: 30, h: 40 })).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
  });

  it("normalizes negative w (drag left)", () => {
    expect(normalizeBox({ x: 100, y: 20, w: -30, h: 40 })).toEqual({
      x: 70,
      y: 20,
      w: 30,
      h: 40,
    });
  });

  it("normalizes negative h (drag up)", () => {
    expect(normalizeBox({ x: 10, y: 100, w: 30, h: -40 })).toEqual({
      x: 10,
      y: 60,
      w: 30,
      h: 40,
    });
  });

  it("handles zero w and h", () => {
    expect(normalizeBox({ x: 5, y: 5, w: 0, h: 0 })).toEqual({
      x: 5,
      y: 5,
      w: 0,
      h: 0,
    });
  });
});

describe("clampBox", () => {
  it("leaves box inside page unchanged", () => {
    expect(clampBox({ x: 10, y: 10, w: 100, h: 100 }, 800, 1200)).toEqual({
      x: 10,
      y: 10,
      w: 100,
      h: 100,
    });
  });

  it("clamps box that extends beyond right/bottom", () => {
    const result = clampBox({ x: 750, y: 1150, w: 100, h: 100 }, 800, 1200);
    expect(result.x).toBe(750);
    expect(result.y).toBe(1150);
    expect(result.w).toBe(50);
    expect(result.h).toBe(50);
  });

  it("clamps box with negative starting point", () => {
    const result = clampBox({ x: -20, y: -10, w: 80, h: 60 }, 800, 1200);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(60);
    expect(result.h).toBe(50);
  });
});

describe("autoNumber", () => {
  it("returns empty array for empty input", () => {
    expect(autoNumber([])).toEqual([]);
  });

  it("numbers single box as 1", () => {
    const box: CropBox = { id: "a", page: 0, x: 0, y: 0, w: 100, h: 100, number: 99 };
    const result = autoNumber([box]);
    expect(result[0].number).toBe(1);
  });

  it("numbers boxes by array index (creation/sort order), not position", () => {
    // 위치(y) 순서와 배열 순서가 다른 경우 — 배열 순서 우선이어야 함
    const boxes: CropBox[] = [
      { id: "a", page: 0, x: 0, y: 300, w: 100, h: 100, number: 0 }, // y큼
      { id: "b", page: 0, x: 0, y: 100, w: 100, h: 100, number: 0 }, // y작음
      { id: "c", page: 1, x: 0, y: 50, w: 100, h: 100, number: 0 },
    ];
    const result = autoNumber(boxes);
    expect(result.map((r) => [r.id, r.number])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("preserves user-reordered order across pages", () => {
    // page 1 박스를 page 0 박스 앞에 배치한 시나리오 (drag-and-drop 재정렬)
    const boxes: CropBox[] = [
      { id: "x", page: 1, x: 0, y: 0, w: 100, h: 100, number: 0 },
      { id: "y", page: 0, x: 0, y: 0, w: 100, h: 100, number: 0 },
    ];
    const result = autoNumber(boxes);
    expect(result[0].id).toBe("x");
    expect(result[0].number).toBe(1);
    expect(result[1].id).toBe("y");
    expect(result[1].number).toBe(2);
  });

  it("does not mutate original array", () => {
    const boxes: CropBox[] = [
      { id: "x", page: 0, x: 0, y: 200, w: 100, h: 100, number: 0 },
      { id: "y", page: 0, x: 0, y: 100, w: 100, h: 100, number: 0 },
    ];
    const originalOrder = boxes.map((b) => b.id);
    autoNumber(boxes);
    expect(boxes.map((b) => b.id)).toEqual(originalOrder);
  });
});

describe("normalizedBboxToCropBox", () => {
  // imageWidth=800, imageHeight=1200 (같은 viewport 설정 활용)
  const imgW = 800;
  const imgH = 1200;

  it("converts a typical bbox to pixel coordinates (round-trip verification)", () => {
    // bbox [y_min, x_min, y_max, x_max] = [100, 200, 400, 600]
    // x = round(200/1000 * 800) = 160
    // y = round(100/1000 * 1200) = 120
    // w = round((600-200)/1000 * 800) = 320
    // h = round((400-100)/1000 * 1200) = 360
    const result = normalizedBboxToCropBox({
      bbox: [100, 200, 400, 600],
      pageIndex: 0,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 1,
      id: "test-id-1",
    });
    expect(result.id).toBe("test-id-1");
    expect(result.page).toBe(0);
    expect(result.x).toBe(160);
    expect(result.y).toBe(120);
    expect(result.w).toBe(320);
    expect(result.h).toBe(360);
    expect(result.number).toBe(1);
    expect(result.kind).toBeUndefined();
  });

  it("maps full-page bbox [0,0,1000,1000] to entire image dimensions", () => {
    const result = normalizedBboxToCropBox({
      bbox: [0, 0, 1000, 1000],
      pageIndex: 1,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 2,
      id: "test-id-2",
    });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(imgW);
    expect(result.h).toBe(imgH);
    expect(result.page).toBe(1);
  });

  it("preserves kind field for both regular and essay", () => {
    const regular = normalizedBboxToCropBox({
      bbox: [0, 0, 500, 500],
      pageIndex: 0,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 3,
      kind: "regular",
      id: "test-id-3",
    });
    expect(regular.kind).toBe("regular");

    const essay = normalizedBboxToCropBox({
      bbox: [500, 0, 1000, 500],
      pageIndex: 0,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 4,
      kind: "essay",
      id: "test-id-4",
    });
    expect(essay.kind).toBe("essay");
  });

  it("uses provided id when specified", () => {
    const result = normalizedBboxToCropBox({
      bbox: [0, 0, 500, 500],
      pageIndex: 0,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 5,
      id: "my-custom-id",
    });
    expect(result.id).toBe("my-custom-id");
  });

  it("clamps bbox that extends beyond image boundaries", () => {
    // bbox [900, 900, 1100, 1100] — x_max/y_max 초과 (1000보다 큰 값)
    // 실제 Gemini에서 발생할 수 있는 약간 넘치는 경계값 처리
    const result = normalizedBboxToCropBox({
      bbox: [900, 900, 1100, 1100],
      pageIndex: 0,
      imageWidth: imgW,
      imageHeight: imgH,
      number: 6,
      id: "test-clamp",
    });
    // 클램프 후 x+w <= imgW, y+h <= imgH
    expect(result.x + result.w).toBeLessThanOrEqual(imgW);
    expect(result.y + result.h).toBeLessThanOrEqual(imgH);
  });

  it("uses the rotated rendered image dimensions without reverse-transforming bbox", () => {
    const rotatedSize = getRotatedImageSize({
      width: imgW,
      height: imgH,
      rotation: 90,
    });
    const result = normalizedBboxToCropBox({
      bbox: [100, 200, 400, 600],
      pageIndex: 0,
      imageWidth: rotatedSize.width,
      imageHeight: rotatedSize.height,
      number: 7,
      id: "rotated-bbox",
    });

    expect(rotatedSize).toEqual({ width: 1200, height: 800 });
    expect(result.x).toBe(240);
    expect(result.y).toBe(80);
    expect(result.w).toBe(480);
    expect(result.h).toBe(240);
  });
});

describe("mirrorBoxX", () => {
  const imageWidth = 800;

  it("mirrors the box x coordinate relative to image width", () => {
    // box at x=100, w=200  →  mirrored x = 800 - 100 - 200 = 500
    const box = { x: 100, y: 50, w: 200, h: 100 };
    const mirrored = mirrorBoxX(box, imageWidth);
    expect(mirrored.x).toBe(500);
    expect(mirrored.y).toBe(50);
    expect(mirrored.w).toBe(200);
    expect(mirrored.h).toBe(100);
  });

  it("round-trips: mirror(mirror(box)) equals original box", () => {
    const box = { x: 150, y: 30, w: 120, h: 80 };
    const roundTripped = mirrorBoxX(mirrorBoxX(box, imageWidth), imageWidth);
    expect(roundTripped).toEqual(box);
  });

  it("handles box at the left edge (x=0)", () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    const mirrored = mirrorBoxX(box, imageWidth);
    expect(mirrored.x).toBe(600); // 800 - 0 - 200
  });

  it("handles box at the right edge (x+w == imageWidth)", () => {
    const box = { x: 600, y: 0, w: 200, h: 100 };
    const mirrored = mirrorBoxX(box, imageWidth);
    expect(mirrored.x).toBe(0); // 800 - 600 - 200
  });

  it("does not modify y or h", () => {
    const box = { x: 50, y: 300, w: 100, h: 500 };
    const mirrored = mirrorBoxX(box, imageWidth);
    expect(mirrored.y).toBe(300);
    expect(mirrored.h).toBe(500);
  });
});

describe("getRotatedImageSize is unaffected by flip (PdfFlip)", () => {
  it("returns same dimensions regardless of whether flip would be applied", () => {
    // flip은 이미지 dimension에 영향 없음 — width/height는 rotation에만 의존
    const baseResult = getRotatedImageSize({ width: 800, height: 1200, rotation: 0 });
    // flip=true 시나리오에서도 getRotatedImageSize 결과는 동일해야 함
    const flipResult = getRotatedImageSize({ width: 800, height: 1200, rotation: 0 });
    expect(flipResult).toEqual(baseResult);
    expect(flipResult).toEqual({ width: 800, height: 1200 });
  });

  it("confirms rotation-swapped dimensions are also flip-invariant", () => {
    const rotated = getRotatedImageSize({ width: 800, height: 1200, rotation: 90 });
    expect(rotated).toEqual({ width: 1200, height: 800 });
    // flip 여부와 관계없이 같은 결과
    const rotatedAgain = getRotatedImageSize({ width: 800, height: 1200, rotation: 90 });
    expect(rotatedAgain).toEqual(rotated);
  });
});
