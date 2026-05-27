import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getDataRoot } from "@/lib/server/paths";

const BASE_DIR = getDataRoot();

const modePaths: Record<string, string> = {
  create: "inputs/시험지 제작",
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const mode = formData.get("mode") as string;
    const files = formData.getAll("files") as File[];

    if (!mode || !modePaths[mode]) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files" }, { status: 400 });
    }

    const targetDir = path.join(BASE_DIR, modePaths[mode]);
    await mkdir(targetDir, { recursive: true });

    const results = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(targetDir, file.name);
      await writeFile(filePath, buffer);
      results.push({
        name: file.name,
        size: file.size,
        path: path.join(modePaths[mode], file.name),
      });
    }

    return NextResponse.json({ files: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
