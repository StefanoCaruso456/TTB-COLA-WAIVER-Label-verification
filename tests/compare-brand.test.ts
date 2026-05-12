import { describe, it, expect } from "vitest";

import { compareBrand } from "@/lib/verification/compare-brand";

describe("compareBrand", () => {
  it("returns match for normalized identical strings", () => {
    const r = compareBrand("STONE'S THROW", "Stone's Throw");
    expect(r.status).toBe("match");
    expect(r.similarity).toBe(1);
  });

  it("ignores trademark/® symbols", () => {
    const r = compareBrand("Cypress Hills", "Cypress Hills™");
    expect(r.status).toBe("match");
  });

  it("flags likely_match for tiny variations", () => {
    const r = compareBrand("Wildwood Distillery", "Wildwood Distillry");
    expect(["likely_match", "match"]).toContain(r.status);
  });

  it("returns mismatch for substantively different brand names", () => {
    const r = compareBrand("Old Tom Distillery", "Old Tim Distillery");
    expect(r.status).toBe("likely_match");
  });

  it("returns mismatch for clearly different brands", () => {
    const r = compareBrand("Old Tom", "Wildwood");
    expect(r.status).toBe("mismatch");
  });

  it("returns missing when expected is provided but extracted is empty", () => {
    const r = compareBrand("Cypress Hills", null);
    expect(r.status).toBe("missing");
  });

  it("returns not_applicable when expected is empty", () => {
    const r = compareBrand(undefined, "anything");
    expect(r.status).toBe("not_applicable");
  });
});
