import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { normalizeParts } from "../normalize";

const FIXTURE_DIR = path.resolve(__dirname, "../../../tests/fixtures/parts_normalization");
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json") && f !== "index.json");

describe("normalizeParts fixtures", () => {
  for (const file of fixtures) {
    const fx = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      id: string;
      description: string;
      input: { parts: unknown[] };
      expected: { parts: unknown[] };
    };
    it(`${fx.id}: ${fx.description}`, () => {
      const actual = normalizeParts(fx.input.parts as Parameters<typeof normalizeParts>[0]);
      expect(actual).toEqual(fx.expected.parts);
    });
  }
});

describe("idempotency", () => {
  for (const file of fixtures) {
    const fx = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      id: string;
      input: { parts: unknown[] };
    };
    it(`${fx.id}`, () => {
      const once = normalizeParts(fx.input.parts as Parameters<typeof normalizeParts>[0]);
      const twice = normalizeParts(once);
      expect(twice).toEqual(once);
    });
  }
});
