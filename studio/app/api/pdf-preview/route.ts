import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, mkdir, access } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { normalizePdfRotation } from "@/lib/cropper/coords";

const execFileAsync = promisify(execFile);
const BASE_DIR = path.resolve(process.cwd(), "..");
const CACHE_DIR = path.join(BASE_DIR, "outputs", ".pdf-preview-cache");

export async function POST(req: NextRequest) {
  try {
    const { pdfPath, page = 0, dpi = 150, rotation: rawRotation = 0, flip: rawFlip = false } = await req.json();

    if (!pdfPath || typeof pdfPath !== "string") {
      return NextResponse.json({ error: "pdfPath is required" }, { status: 400 });
    }

    const rotationValue = Number(rawRotation);
    if (!Number.isFinite(rotationValue)) {
      return NextResponse.json({ error: "rotation must be a number" }, { status: 400 });
    }
    if (typeof rawFlip !== "boolean") {
      return NextResponse.json({ error: "flip must be a boolean" }, { status: 400 });
    }
    const rotation = normalizePdfRotation(rotationValue);
    const fullPath = path.join(BASE_DIR, pdfPath);

    // Cache key based on file path, page, dpi, physical image rotation, and flip.
    const hash = crypto
      .createHash("md5")
      .update(`${pdfPath}:${page}:${dpi}:${rotation}:${rawFlip}`)
      .digest("hex");
    const cachePath = path.join(CACHE_DIR, `${hash}.png`);

    await mkdir(CACHE_DIR, { recursive: true });

    // Check cache
    try {
      await access(cachePath);
      const cached = await readFile(cachePath);
      return new NextResponse(cached, {
        headers: { "Content-Type": "image/png", "X-Cache": "hit" },
      });
    } catch {
      // Cache miss, render
    }

    // Use Python + PyMuPDF to render page
    const script = `
import fitz, sys, json
args = json.loads(sys.argv[1])
doc = fitz.open(args["path"])
if args["page"] >= len(doc):
    sys.exit(1)
scale = args["dpi"] / 72.0
matrix = fitz.Matrix(scale, scale).prerotate(args["rotation"])
pix = doc[args["page"]].get_pixmap(matrix=matrix)
if args.get("flip"):
    # Horizontal mirror: negate x-scale and translate by width
    mirror = fitz.Matrix(-1, 1).pretranslate(-pix.width, 0)
    pix = doc[args["page"]].get_pixmap(matrix=matrix * mirror)
pix.save(args["out"])
print(json.dumps({"width": pix.width, "height": pix.height, "pages": len(doc)}))
`;

    const args = JSON.stringify({
      path: fullPath,
      page,
      dpi,
      rotation,
      flip: rawFlip,
      out: cachePath,
    });

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    let stdout = "";
    try {
      const result = await execFileAsync(pythonCmd, ["-c", script, args], {
        timeout: 15000,
      });
      stdout = result.stdout;
    } catch (err) {
      if (process.platform !== "darwin") throw err;

      const swiftScript = `
import Foundation
import PDFKit
import AppKit

let args = CommandLine.arguments
if args.count < 5 { exit(2) }
let pdfPath = args[1]
let pageIndex = Int(args[2]) ?? 0
let dpi = Double(args[3]) ?? 150.0
let outPath = args[4]
let rotation = ((Int(args.count > 5 ? args[5] : "0") ?? 0) % 360 + 360) % 360
let doFlip = args.count > 6 && args[6] == "true"
guard let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)), let page = doc.page(at: pageIndex) else { exit(1) }
let box = page.bounds(for: .mediaBox)
let scale = dpi / 72.0
let width = max(1, Int((box.width * scale).rounded()))
let height = max(1, Int((box.height * scale).rounded()))
guard let baseCtx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
let ctx = baseCtx
ctx.setFillColor(NSColor.white.cgColor)
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
ctx.saveGState()
ctx.translateBy(x: 0, y: CGFloat(height))
ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
ctx.translateBy(x: -box.minX, y: -box.minY)
page.draw(with: .mediaBox, to: ctx)
ctx.restoreGState()
guard let baseImage = ctx.makeImage() else { exit(1) }
let outWidth = (rotation == 90 || rotation == 270) ? height : width
let outHeight = (rotation == 90 || rotation == 270) ? width : height
guard let outCtx = CGContext(data: nil, width: outWidth, height: outHeight, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
outCtx.setFillColor(NSColor.white.cgColor)
outCtx.fill(CGRect(x: 0, y: 0, width: outWidth, height: outHeight))
outCtx.saveGState()
if rotation == 90 {
  outCtx.translateBy(x: CGFloat(outWidth), y: 0)
  outCtx.rotate(by: .pi / 2)
} else if rotation == 180 {
  outCtx.translateBy(x: CGFloat(outWidth), y: CGFloat(outHeight))
  outCtx.rotate(by: .pi)
} else if rotation == 270 {
  outCtx.translateBy(x: 0, y: CGFloat(outHeight))
  outCtx.rotate(by: -.pi / 2)
}
outCtx.draw(baseImage, in: CGRect(x: 0, y: 0, width: width, height: height))
outCtx.restoreGState()
if doFlip {
  // Horizontal mirror: scaleX = -1, translate by outWidth
  outCtx.saveGState()
  outCtx.translateBy(x: CGFloat(outWidth), y: 0)
  outCtx.scaleBy(x: -1, y: 1)
  guard let rotatedImage = outCtx.makeImage() else { exit(1) }
  outCtx.draw(rotatedImage, in: CGRect(x: 0, y: 0, width: outWidth, height: outHeight))
  outCtx.restoreGState()
}
guard let cgImage = outCtx.makeImage(), let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: outPath))
print("{\\"width\\":\\(outWidth),\\"height\\":\\(outHeight),\\"pages\\":\\(doc.pageCount)}")
`;

      const result = await execFileAsync(
        "swift",
        ["-e", swiftScript, fullPath, String(page), String(dpi), cachePath, String(rotation), String(rawFlip)],
        { timeout: 15000 }
      );
      stdout = result.stdout;
    }

    const meta = JSON.parse(stdout.trim());
    const imageBuffer = await readFile(cachePath);

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "X-Cache": "miss",
        "X-Pages": String(meta.pages),
        "X-Width": String(meta.width),
        "X-Height": String(meta.height),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF render failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
