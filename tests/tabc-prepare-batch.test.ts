import { describe, expect, it } from "vitest";

import {
  formatAbv,
  imageFileName,
  makeOutputLayout,
  mapTabcType,
  pdfCachePath,
  tabcRowToManifestRow,
  type TabcCsvRow,
} from "@/scripts/tabc-prepare-batch";

describe("mapTabcType", () => {
  it("maps WINE → wine", () => {
    expect(mapTabcType("WINE")).toBe("wine");
  });
  it("maps MALT BEVERAGE → malt_beverage", () => {
    expect(mapTabcType("MALT BEVERAGE")).toBe("malt_beverage");
  });
  it("maps SPIRIT / SPIRITS / DISTILLED SPIRITS → distilled_spirits", () => {
    expect(mapTabcType("SPIRIT")).toBe("distilled_spirits");
    expect(mapTabcType("SPIRITS")).toBe("distilled_spirits");
    expect(mapTabcType("DISTILLED SPIRITS")).toBe("distilled_spirits");
  });
  it("normalizes whitespace + case", () => {
    expect(mapTabcType("  wine  ")).toBe("wine");
  });
  it("returns null for unknown types", () => {
    expect(mapTabcType("LIQUEUR")).toBeNull();
    expect(mapTabcType("")).toBeNull();
  });
});

describe("formatAbv", () => {
  it("formats integer ABV", () => {
    expect(formatAbv(11)).toBe("11% Alc./Vol.");
  });
  it("formats fractional ABV", () => {
    expect(formatAbv(11.5)).toBe("11.5% Alc./Vol.");
  });
  it("accepts a numeric string", () => {
    expect(formatAbv("13.5")).toBe("13.5% Alc./Vol.");
  });
  it("returns empty string on non-finite input", () => {
    expect(formatAbv(Number.NaN)).toBe("");
    expect(formatAbv("not a number")).toBe("");
  });
  it("handles 0 and 100 boundaries", () => {
    expect(formatAbv(0)).toBe("0% Alc./Vol.");
    expect(formatAbv(100)).toBe("100% Alc./Vol.");
  });
});

describe("imageFileName", () => {
  it("derives a deterministic file name", () => {
    expect(imageFileName("758166")).toBe("tabc-758166.png");
  });
  it("strips unsafe characters", () => {
    expect(imageFileName("a/b c?")).toBe("tabc-a-b-c-.png");
  });
  it("trims surrounding whitespace", () => {
    expect(imageFileName("  758166  ")).toBe("tabc-758166.png");
  });
});

describe("tabcRowToManifestRow", () => {
  function happy(overrides: Partial<TabcCsvRow> = {}): TabcCsvRow {
    return {
      "TABC Certificate Number": "758166",
      "Permit/License Number": "S246297",
      "Brand Name": "JAUME SERRA CRISTALINO ROSE BRUT",
      Type: "WINE",
      "Approval Date": "09/27/2010",
      "Trade Name": "CIV (USA)",
      "Alcohol Content by Volume": "11.5",
      "TTB Number": "10238001000382",
      "File Link":
        "https://storage.googleapis.com/tabc-public-labels/abc.pdf",
      ...overrides,
    };
  }

  it("emits a verifier-format manifest row for a happy WINE row", () => {
    const result = tabcRowToManifestRow(happy());
    if (!result.ok) throw new Error("expected ok");
    expect(result.manifest).toEqual({
      file_name: "tabc-758166.png",
      product_type: "wine",
      brand_name: "JAUME SERRA CRISTALINO ROSE BRUT",
      abv: "11.5% Alc./Vol.",
      net_contents: "",
      country_of_origin: "",
    });
    expect(result.pdfUrl).toContain("abc.pdf");
    expect(result.certificate).toBe("758166");
  });

  it("skips rows with no File Link", () => {
    const result = tabcRowToManifestRow(happy({ "File Link": "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipReason).toMatch(/URL/);
  });

  it("skips rows with a non-http URL", () => {
    const result = tabcRowToManifestRow(
      happy({ "File Link": "file:///etc/passwd" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipReason).toMatch(/URL/);
  });

  it("skips rows with an unrecognized Type", () => {
    const result = tabcRowToManifestRow(happy({ Type: "LIQUEUR" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipReason).toMatch(/unrecognized Type/);
  });

  it("skips rows with a missing brand name", () => {
    const result = tabcRowToManifestRow(happy({ "Brand Name": "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipReason).toMatch(/brand_name/);
  });

  it("skips rows with no certificate number", () => {
    const result = tabcRowToManifestRow(
      happy({ "TABC Certificate Number": "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipReason).toMatch(/certificate/);
  });

  it("is deterministic — calling twice on the same input returns the same result", () => {
    const row = happy();
    const a = tabcRowToManifestRow(row);
    const b = tabcRowToManifestRow(row);
    expect(a).toEqual(b);
  });

  it("preserves brand names with embedded commas (quoted in source CSV)", () => {
    const result = tabcRowToManifestRow(
      happy({ "Brand Name": "JAUME SERRA SPARKLING WINE CAVA, SP" }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.manifest.brand_name).toBe(
      "JAUME SERRA SPARKLING WINE CAVA, SP",
    );
  });
});

describe("makeOutputLayout + pdfCachePath", () => {
  it("derives consistent paths from a single root", () => {
    const layout = makeOutputLayout("/tmp/tabc-out");
    expect(layout.images).toBe("/tmp/tabc-out/images");
    expect(layout.pdfCache).toBe("/tmp/tabc-out/_pdfs");
    expect(layout.manifestPath).toBe("/tmp/tabc-out/manifest.csv");
    expect(layout.reportPath).toBe("/tmp/tabc-out/report.json");
  });

  it("hashes URLs to keep the cache filename deterministic and safe", () => {
    const layout = makeOutputLayout("/tmp/tabc-out");
    const a = pdfCachePath(
      layout,
      "https://storage.googleapis.com/tabc-public-labels/abc.pdf",
    );
    const b = pdfCachePath(
      layout,
      "https://storage.googleapis.com/tabc-public-labels/abc.pdf",
    );
    expect(a).toBe(b);
    expect(a.endsWith(".pdf")).toBe(true);
    // Filename is hex, no path traversal characters.
    expect(a).not.toMatch(/[\/.]{2,}/);
  });

  it("produces a different cache key for a different URL", () => {
    const layout = makeOutputLayout("/tmp/tabc-out");
    const a = pdfCachePath(layout, "https://a.example/x.pdf");
    const b = pdfCachePath(layout, "https://b.example/x.pdf");
    expect(a).not.toBe(b);
  });
});
