import { describe, it, expect } from "vitest";

import { normalizeText, similarity } from "@/lib/verification/normalize";

describe("normalizeText", () => {
  it("normalizes case, whitespace, smart quotes, and trademark marks", () => {
    expect(normalizeText("Stone’s Throw™")).toBe("stones throw");
    expect(normalizeText("  Hello   WORLD   ")).toBe("hello world");
  });

  it("handles undefined/null safely", () => {
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(null)).toBe("");
  });
});

describe("similarity", () => {
  it("returns 1 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1);
  });

  it("returns close to 1 for tiny variations", () => {
    const score = similarity("stone s throw", "stones throw");
    expect(score).toBeGreaterThan(0.9);
  });

  it("returns low score for different strings", () => {
    expect(similarity("hello", "world")).toBeLessThan(0.5);
  });
});
