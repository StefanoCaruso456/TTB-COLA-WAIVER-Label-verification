import { describe, it, expect } from "vitest";

import { compareGovernmentWarning } from "@/lib/verification/compare-warning";

const CANONICAL =
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.";

describe("compareGovernmentWarning", () => {
  it("matches the full canonical warning", () => {
    const r = compareGovernmentWarning(CANONICAL);
    expect(r.status).toBe("match");
    expect(r.severity).toBe("info");
    expect(r.missingFragments).toEqual([]);
    expect(r.prefixUppercase).toBe(true);
  });

  it("missing when no warning text is provided", () => {
    const r = compareGovernmentWarning(undefined);
    expect(r.status).toBe("missing");
    expect(r.severity).toBe("error");
  });

  it("mismatch when prefix is title case", () => {
    const r = compareGovernmentWarning(
      CANONICAL.replace("GOVERNMENT WARNING", "Government Warning"),
    );
    expect(r.status).toBe("mismatch");
    expect(r.prefixUppercase).toBe(false);
  });

  it("mismatch when required wording is missing", () => {
    const r = compareGovernmentWarning(
      "GOVERNMENT WARNING: drink responsibly.",
    );
    expect(r.status).toBe("mismatch");
    expect(r.missingFragments.length).toBeGreaterThan(0);
  });
});
