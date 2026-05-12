import { describe, it, expect } from "vitest";

import {
  compareAlcoholContent,
  parseAbvPercent,
  parseProof,
} from "@/lib/verification/compare-abv";

describe("parseAbvPercent", () => {
  it("parses common ABV formats", () => {
    expect(parseAbvPercent("45% Alc./Vol.")).toBe(45);
    expect(parseAbvPercent("ABV 13.5%")).toBe(13.5);
    expect(parseAbvPercent("13.5")).toBe(13.5);
  });
});

describe("parseProof", () => {
  it("parses proof numbers", () => {
    expect(parseProof("90 Proof")).toBe(90);
    expect(parseProof("Proof: 100")).toBeUndefined(); // numeric must come before "proof"
  });
});

describe("compareAlcoholContent", () => {
  it("matches when ABV is equal", () => {
    const r = compareAlcoholContent({
      productType: "wine",
      expectedAlcoholContent: "13.5%",
      extractedAlcoholContent: "13.5% Alc./Vol.",
    });
    expect(r.status).toBe("match");
  });

  it("matches 45% ABV with 90 proof for distilled spirits", () => {
    const r = compareAlcoholContent({
      productType: "distilled_spirits",
      expectedAlcoholContent: "45%",
      extractedProof: "90 Proof",
    });
    expect(r.status).toBe("match");
  });

  it("mismatches when ABV differs materially", () => {
    const r = compareAlcoholContent({
      productType: "wine",
      expectedAlcoholContent: "13.5%",
      extractedAlcoholContent: "9.5% Alc./Vol.",
    });
    expect(r.status).toBe("mismatch");
  });

  it("not_applicable when no expected value provided", () => {
    const r = compareAlcoholContent({
      productType: "wine",
      expectedAlcoholContent: undefined,
      extractedAlcoholContent: "13.5%",
    });
    expect(r.status).toBe("not_applicable");
  });

  it("missing when extracted value cannot be parsed", () => {
    const r = compareAlcoholContent({
      productType: "wine",
      expectedAlcoholContent: "13.5%",
      extractedAlcoholContent: undefined,
    });
    expect(r.status).toBe("missing");
  });
});
