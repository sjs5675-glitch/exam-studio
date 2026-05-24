import { describe, expect, it } from "vitest";
import { readPdfMetaFromBuffer } from "../pdfMeta";

describe("readPdfMetaFromBuffer", () => {
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Pages >> endobj\n2 0 obj << /Type /Page /MediaBox [0 0 595.2 841.68] >> endobj\n3 0 obj << /Type /Page >> endobj\n",
    "latin1"
  );

  it("extracts page count and first MediaBox dimensions", () => {
    expect(readPdfMetaFromBuffer(pdf, 200)).toEqual({
      pages: 2,
      page0Width: 1653,
      page0Height: 2338,
      dpi: 200,
    });
  });

  it("keeps dimensions for 180 degree rotation", () => {
    expect(readPdfMetaFromBuffer(pdf, 200, 180)).toMatchObject({
      page0Width: 1653,
      page0Height: 2338,
    });
  });

  it("swaps dimensions for 90 and 270 degree rotation", () => {
    expect(readPdfMetaFromBuffer(pdf, 200, 90)).toMatchObject({
      page0Width: 2338,
      page0Height: 1653,
    });
    expect(readPdfMetaFromBuffer(pdf, 200, 270)).toMatchObject({
      page0Width: 2338,
      page0Height: 1653,
    });
  });

  it("flip does not change dimensions (rotation=0)", () => {
    expect(readPdfMetaFromBuffer(pdf, 200, 0, true)).toMatchObject({
      page0Width: 1653,
      page0Height: 2338,
    });
  });

  it("flip does not change dimensions (rotation=90)", () => {
    expect(readPdfMetaFromBuffer(pdf, 200, 90, true)).toMatchObject({
      page0Width: 2338,
      page0Height: 1653,
    });
  });
});
