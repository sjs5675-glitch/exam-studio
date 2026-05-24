import { describe, expect, it } from "vitest";
import { createProviderTelemetryEntry } from "../ai";

describe("provider telemetry", () => {
  it("keeps optional cost fields optional", () => {
    const entry = createProviderTelemetryEntry({
      requestedProvider: "auto",
      resolvedProvider: "claude-cli",
      attempt: 1,
      status: "success",
      elapsedMs: 0,
      retry: false,
    });

    expect(entry).toEqual({
      requestedProvider: "auto",
      resolvedProvider: "claude-cli",
      attempt: 1,
      status: "success",
      elapsedMs: 0,
      retry: false,
    });
  });
});
