import { getRotatedImageSize } from "@/lib/cropper/coords";

export interface PdfMeta {
  pages: number;
  page0Width: number;
  page0Height: number;
  dpi: number;
}

// flip is accepted for API symmetry but does not affect page dimensions.
export function readPdfMetaFromBuffer(buffer: Buffer, dpi: number, rotation = 0, _flip?: boolean): PdfMeta {
  void _flip;
  const text = buffer.toString("latin1");
  const pageMatches = text.match(/\/Type\s*\/Page\b/g);
  const mediaBox = text.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);

  if (!pageMatches?.length) {
    throw new Error("PDF page count not found");
  }

  if (!mediaBox) {
    throw new Error("PDF MediaBox not found");
  }

  const [, x1Raw, y1Raw, x2Raw, y2Raw] = mediaBox;
  const x1 = Number(x1Raw);
  const y1 = Number(y1Raw);
  const x2 = Number(x2Raw);
  const y2 = Number(y2Raw);

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new Error("Invalid PDF MediaBox");
  }

  const scale = dpi / 72;
  const size = getRotatedImageSize({
    width: Math.round(Math.abs(x2 - x1) * scale),
    height: Math.round(Math.abs(y2 - y1) * scale),
    rotation,
  });
  return {
    pages: pageMatches.length,
    page0Width: size.width,
    page0Height: size.height,
    dpi,
  };
}
