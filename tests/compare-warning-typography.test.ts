import { describe, expect, it } from "vitest";

import {
  compareWarningTypography,
  DEFAULT_TYPOGRAPHY_CONFIG,
  resolveTypographyConfig,
  type TypographyConfig,
} from "@/lib/verification/compare-warning-typography";

const PLAUSIBLE_BBOX = { x: 0.1, y: 0.8, width: 0.4, height: 0.04 };
const TALL_BRAND_BBOX = { x: 0.1, y: 0.2, width: 0.6, height: 0.08 };

// Helper: builds a ProcessEnv-shaped object for tests. NodeJS.ProcessEnv is
// typed as `{ [k: string]: string | undefined; NODE_ENV: string }`, so we
// can't pass a bare {} — every override must include NODE_ENV.
function testEnv(
  overrides: Partial<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

describe("compareWarningTypography — boldPrefix", () => {
  it("returns a passing check when prefixIsBold is true", () => {
    const result = compareWarningTypography(
      { prefixIsBold: true },
      undefined,
    );
    expect(result.boldPrefix).not.toBeNull();
    expect(result.boldPrefix!.status).toBe("match");
    expect(result.boldPrefix!.severity).toBe("info");
  });

  it("returns needs_review at default severity when prefixIsBold is false", () => {
    const result = compareWarningTypography(
      { prefixIsBold: false },
      undefined,
    );
    expect(result.boldPrefix!.status).toBe("needs_review");
    expect(result.boldPrefix!.severity).toBe("warning");
    expect(result.boldPrefix!.reason).toMatch(/27 CFR 16.21/);
  });

  it("returns mismatch+error when config flips boldSeverity to error", () => {
    const config: TypographyConfig = {
      ...DEFAULT_TYPOGRAPHY_CONFIG,
      boldSeverity: "error",
    };
    const result = compareWarningTypography(
      { prefixIsBold: false },
      undefined,
      config,
    );
    expect(result.boldPrefix!.status).toBe("mismatch");
    expect(result.boldPrefix!.severity).toBe("error");
  });

  it("returns null when prefixIsBold is missing (legacy / Gemini-failure path)", () => {
    const result = compareWarningTypography({}, undefined);
    expect(result.boldPrefix).toBeNull();
  });
});

describe("compareWarningTypography — relativeSizing", () => {
  it("passes when warning bbox is at least threshold × brand bbox", () => {
    const result = compareWarningTypography(
      {
        warningBbox: { height: 0.05 },
        brandReferenceBbox: { height: 0.08 },
      },
      undefined,
    );
    expect(result.relativeSizing!.status).toBe("match");
    expect(result.relativeSizing!.severity).toBe("info");
  });

  it("flags when warning bbox falls below threshold ratio", () => {
    const result = compareWarningTypography(
      {
        warningBbox: { height: 0.01 },
        brandReferenceBbox: { height: 0.08 }, // ratio = 0.125, below 0.5
      },
      undefined,
    );
    expect(result.relativeSizing!.status).toBe("needs_review");
    expect(result.relativeSizing!.reason).toMatch(/13%/);
  });

  it("falls back to brand-field bbox when typography.brandReferenceBbox is missing", () => {
    const result = compareWarningTypography(
      { warningBbox: PLAUSIBLE_BBOX },
      { value: "Acme", bbox: TALL_BRAND_BBOX },
    );
    expect(result.relativeSizing).not.toBeNull();
  });

  it("returns null when either bbox height is missing", () => {
    const noWarning = compareWarningTypography(
      { brandReferenceBbox: TALL_BRAND_BBOX },
      undefined,
    );
    const noBrand = compareWarningTypography(
      { warningBbox: PLAUSIBLE_BBOX },
      undefined,
    );
    expect(noWarning.relativeSizing).toBeNull();
    expect(noBrand.relativeSizing).toBeNull();
  });

  it("returns null when bbox heights are zero (defensive against divide-by-zero)", () => {
    const result = compareWarningTypography(
      {
        warningBbox: { height: 0 },
        brandReferenceBbox: { height: 0.08 },
      },
      undefined,
    );
    expect(result.relativeSizing).toBeNull();
  });
});

describe("compareWarningTypography — fail-safe behavior", () => {
  it("returns nulls for both checks when typography input is null", () => {
    const result = compareWarningTypography(null, undefined);
    expect(result.boldPrefix).toBeNull();
    expect(result.relativeSizing).toBeNull();
  });

  it("returns nulls for both checks when typography input is undefined", () => {
    const result = compareWarningTypography(undefined, undefined);
    expect(result.boldPrefix).toBeNull();
    expect(result.relativeSizing).toBeNull();
  });
});

describe("resolveTypographyConfig", () => {
  it("returns defaults when no env overrides are present", () => {
    const config = resolveTypographyConfig(testEnv());
    expect(config).toEqual(DEFAULT_TYPOGRAPHY_CONFIG);
  });

  it("respects GOV_WARNING_BOLD_SEVERITY=error", () => {
    const config = resolveTypographyConfig(
      testEnv({ GOV_WARNING_BOLD_SEVERITY: "error" }),
    );
    expect(config.boldSeverity).toBe("error");
  });

  it("respects GOV_WARNING_SIZING_THRESHOLD as a decimal", () => {
    const config = resolveTypographyConfig(
      testEnv({ GOV_WARNING_SIZING_THRESHOLD: "0.3" }),
    );
    expect(config.sizingThreshold).toBe(0.3);
  });

  it("ignores invalid GOV_WARNING_BOLD_SEVERITY values", () => {
    const config = resolveTypographyConfig(
      testEnv({ GOV_WARNING_BOLD_SEVERITY: "catastrophic" }),
    );
    expect(config.boldSeverity).toBe(DEFAULT_TYPOGRAPHY_CONFIG.boldSeverity);
  });

  it("clamps out-of-range thresholds back to default", () => {
    expect(
      resolveTypographyConfig(testEnv({ GOV_WARNING_SIZING_THRESHOLD: "1.5" }))
        .sizingThreshold,
    ).toBe(DEFAULT_TYPOGRAPHY_CONFIG.sizingThreshold);
    expect(
      resolveTypographyConfig(testEnv({ GOV_WARNING_SIZING_THRESHOLD: "-0.1" }))
        .sizingThreshold,
    ).toBe(DEFAULT_TYPOGRAPHY_CONFIG.sizingThreshold);
    expect(
      resolveTypographyConfig(
        testEnv({ GOV_WARNING_SIZING_THRESHOLD: "not a number" }),
      ).sizingThreshold,
    ).toBe(DEFAULT_TYPOGRAPHY_CONFIG.sizingThreshold);
  });
});
