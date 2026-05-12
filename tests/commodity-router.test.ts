import { describe, it, expect } from "vitest";

import { resolveCommodityIntent } from "@/lib/services/commodity-router";

describe("resolveCommodityIntent", () => {
  it("returns no conflict when nothing is inferred", () => {
    const r = resolveCommodityIntent({
      selectedProductType: "wine",
    });
    expect(r.routingDecision).toBe("wine");
    expect(r.conflictDetected).toBe(false);
  });

  it("returns no conflict when inferred confidence is too low", () => {
    const r = resolveCommodityIntent({
      selectedProductType: "wine",
      inferredProductType: "distilled_spirits",
      inferredConfidence: 0.5,
    });
    expect(r.routingDecision).toBe("wine");
    expect(r.conflictDetected).toBe(false);
  });

  it("flags conflict when selected and inferred disagree with high confidence", () => {
    const r = resolveCommodityIntent({
      selectedProductType: "wine",
      inferredProductType: "distilled_spirits",
      inferredConfidence: 0.9,
    });
    expect(r.routingDecision).toBe("wine");
    expect(r.conflictDetected).toBe(true);
  });

  it("matches when selected and inferred agree with high confidence", () => {
    const r = resolveCommodityIntent({
      selectedProductType: "distilled_spirits",
      inferredProductType: "distilled_spirits",
      inferredConfidence: 0.9,
    });
    expect(r.routingDecision).toBe("distilled_spirits");
    expect(r.conflictDetected).toBe(false);
  });
});
