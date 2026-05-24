import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data/jobs");

export async function GET(req: NextRequest) {
  try {
    if (!existsSync(DATA_DIR)) {
      return NextResponse.json({ jobs: [], total: 0 });
    }

    const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20");
    const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0");

    const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));

    const jobs = [];
    for (const file of files) {
      try {
        const content = await readFile(path.join(DATA_DIR, file), "utf-8");
        jobs.push(JSON.parse(content));
      } catch {
        // skip corrupted files
      }
    }

    // Sort by startedAt descending
    jobs.sort((a, b) => {
      const ta = new Date(a.startedAt ?? 0).getTime();
      const tb = new Date(b.startedAt ?? 0).getTime();
      return tb - ta;
    });

    return NextResponse.json({
      jobs: jobs.slice(offset, offset + limit),
      total: jobs.length,
    });
  } catch {
    return NextResponse.json({ jobs: [], total: 0 });
  }
}
