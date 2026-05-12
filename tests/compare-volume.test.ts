import { describe, it, expect } from "vitest";

import {
  compareVolumes,
  parseSingleVolume,
  parseVolumes,
} from "@/lib/verification/compare-volume";

describe("parseVolumes", () => {
  it("parses mL and ml interchangeably", () => {
    expect(parseSingleVolume("750 mL")?.ml).toBe(750);
    expect(parseSingleVolume("750ml")?.ml).toBe(750);
  });

  it("converts liters to milliliters", () => {
    expect(parseSingleVolume("0.75 L")?.ml).toBe(750);
    expect(parseSingleVolume("1.5 liters")?.ml).toBe(1500);
  });

  it("parses multiple volumes", () => {
    const list = parseVolumes("750 mL or 1.5 L");
    expect(list.map((v) => v.ml)).toEqual([750, 1500]);
  });
});

describe("compareVolumes", () => {
  it("matches when 0.75 L equals 750 mL", () => {
    const r = compareVolumes(["0.75 L"], ["750 mL"]);
    expect(r.status).toBe("match");
  });

  it("missing when extracted is empty", () => {
    const r = compareVolumes(["750 mL"], []);
    expect(r.status).toBe("missing");
  });

  it("mismatch when no overlap", () => {
    const r = compareVolumes(["750 mL"], ["1000 mL"]);
    expect(r.status).toBe("mismatch");
  });

  it("likely_match when some expected values overlap", () => {
    const r = compareVolumes(["750 mL", "1.5 L"], ["750 mL"]);
    expect(r.status).toBe("likely_match");
  });

  it("not_applicable when no expected volumes", () => {
    const r = compareVolumes(undefined, ["750 mL"]);
    expect(r.status).toBe("not_applicable");
  });
});
