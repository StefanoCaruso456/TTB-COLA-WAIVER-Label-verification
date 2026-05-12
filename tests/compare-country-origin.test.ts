import { describe, it, expect } from "vitest";

import { compareCountryOfOrigin } from "@/lib/verification/compare-country-origin";

describe("compareCountryOfOrigin", () => {
  it("not_applicable when product is domestic", () => {
    const r = compareCountryOfOrigin({
      sourceOfProduct: "domestic",
      expected: undefined,
      extracted: undefined,
    });
    expect(r.status).toBe("not_applicable");
  });

  it("needs_review when imported and expected is missing", () => {
    const r = compareCountryOfOrigin({
      sourceOfProduct: "imported",
      expected: undefined,
      extracted: "France",
    });
    expect(r.status).toBe("needs_review");
  });

  it("missing when imported and extracted is missing", () => {
    const r = compareCountryOfOrigin({
      sourceOfProduct: "imported",
      expected: "France",
      extracted: undefined,
    });
    expect(r.status).toBe("missing");
    expect(r.severity).toBe("error");
  });

  it("match when imported and exact normalized match", () => {
    const r = compareCountryOfOrigin({
      sourceOfProduct: "imported",
      expected: "France",
      extracted: "France",
    });
    expect(r.status).toBe("match");
  });

  it("mismatch when imported and clearly different", () => {
    const r = compareCountryOfOrigin({
      sourceOfProduct: "imported",
      expected: "France",
      extracted: "Spain",
    });
    expect(r.status).toBe("mismatch");
  });
});
