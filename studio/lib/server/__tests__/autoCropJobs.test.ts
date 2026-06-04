import { describe, expect, it } from "vitest";
import { resolveAutoCropTimeoutMs } from "../autoCropJobs";

describe("auto crop job timeout", () => {
  it("keeps the legacy floor when page count is unknown", () => {
    expect(resolveAutoCropTimeoutMs({ provider: "gemini", mode: "accurate" })).toBe(30 * 60 * 1000);
  });

  it("scales accurate Gemini jobs for long PDFs", () => {
    expect(resolveAutoCropTimeoutMs({ provider: "gemini", mode: "accurate", totalPages: 85 })).toBe(
      12 * 60 * 1000 + 85 * 75 * 1000,
    );
  });

  it("uses a shorter budget for fast Gemini jobs", () => {
    expect(resolveAutoCropTimeoutMs({ provider: "gemini", mode: "fast", totalPages: 85 })).toBe(
      8 * 60 * 1000 + 85 * 30 * 1000,
    );
  });

  it("caps very large jobs so a stuck process cannot live forever", () => {
    expect(resolveAutoCropTimeoutMs({ provider: "codex-cli", mode: "accurate", totalPages: 1000 })).toBe(
      6 * 60 * 60 * 1000,
    );
  });
});
