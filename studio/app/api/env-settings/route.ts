import { NextRequest, NextResponse } from "next/server";
import {
  RUNTIME_ENV_KEYS,
  runtimeEnvStatus,
  writeRuntimeEnv,
  type RuntimeEnvMap,
} from "@/lib/server/runtimeEnv";

export async function GET() {
  return NextResponse.json({
    keys: runtimeEnvStatus(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined) as { values?: Record<string, unknown> } | undefined;
  const values = body?.values;
  if (!values || typeof values !== "object") {
    return NextResponse.json({ error: "values is required" }, { status: 400 });
  }

  const updates: RuntimeEnvMap = {};
  for (const key of RUNTIME_ENV_KEYS) {
    const value = values[key];
    if (typeof value === "string") {
      updates[key] = value.trim();
    }
  }

  writeRuntimeEnv(updates);
  return NextResponse.json({
    keys: runtimeEnvStatus(),
  });
}
