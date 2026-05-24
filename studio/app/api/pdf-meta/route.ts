import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { readFile } from "fs/promises";
import { readPdfMetaFromBuffer } from "@/lib/pdf/pdfMeta";
import { normalizePdfRotation } from "@/lib/cropper/coords";

const execFileAsync = promisify(execFile);
const BASE_DIR = path.resolve(process.cwd(), "..");

export async function POST(req: NextRequest) {
  try {
    const { pdfPath, dpi = 200, rotation: rawRotation = 0, flip: rawFlip = false } = await req.json();

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
    // flip does not affect page dimensions (width/height are rotation-only); accepted for API symmetry.
    const fullPath = path.join(BASE_DIR, pdfPath);

    const script = `
import fitz, sys, json
args = json.loads(sys.argv[1])
doc = fitz.open(args["path"])
pages = len(doc)
if pages == 0:
    sys.exit(1)
# Get first page dimensions at the specified dpi
page0 = doc[0]
rect = page0.rect
# Scale by dpi ratio: dpi / 72 (default PDF resolution)
scale = args["dpi"] / 72.0
width = int(rect.width * scale)
height = int(rect.height * scale)
if args["rotation"] in (90, 270):
    width, height = height, width
print(json.dumps({"pages": pages, "page0Width": width, "page0Height": height, "dpi": args["dpi"]}))
`;

    const args = JSON.stringify({
      path: fullPath,
      dpi,
      rotation,
    });

    try {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const { stdout } = await execFileAsync(pythonCmd, ["-c", script, args], {
        timeout: 15000,
      });

      const meta = JSON.parse(stdout.trim());
      return NextResponse.json(meta);
    } catch {
      const buffer = await readFile(fullPath);
      return NextResponse.json(readPdfMetaFromBuffer(buffer, dpi, rotation));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF metadata extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
