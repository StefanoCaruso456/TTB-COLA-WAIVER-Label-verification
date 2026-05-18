import { describe, expect, it } from "vitest";

import {
  previewValidateManifest,
  splitCsvRow,
} from "@/lib/manifest/preview-validation";

describe("splitCsvRow", () => {
  it("splits a plain CSV row", () => {
    expect(splitCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves commas inside quoted cells", () => {
    expect(splitCsvRow(`a,"b,c",d`)).toEqual(["a", "b,c", "d"]);
  });

  it("supports escaped double-quotes inside quoted cells", () => {
    expect(splitCsvRow(`a,"b""c",d`)).toEqual(["a", `b"c`, "d"]);
  });
});

describe("previewValidateManifest", () => {
  it("returns ok when columns + filenames reconcile", () => {
    const csv =
      "file_name,product_type,brand_name\nwine-01.jpg,wine,Cypress Hills";
    const result = previewValidateManifest(csv, ["wine-01.jpg"]);
    expect(result.ok).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.orphanRows).toEqual([]);
    expect(result.orphanFiles).toEqual([]);
  });

  it("flags missing required columns", () => {
    const csv = "file_name,brand_name\nwine-01.jpg,Cypress Hills";
    const result = previewValidateManifest(csv, ["wine-01.jpg"]);
    expect(result.ok).toBe(false);
    expect(result.requiredColumnsMissing).toContain("product_type");
  });

  it("accepts aliases (Type, Brand, File)", () => {
    const csv = "File,Type,Brand\nwine-01.jpg,wine,Cypress Hills";
    const result = previewValidateManifest(csv, ["wine-01.jpg"]);
    expect(result.ok).toBe(true);
    expect(result.requiredColumnsMissing).toEqual([]);
  });

  it("flags orphan manifest rows when no matching file uploaded", () => {
    const csv =
      "file_name,product_type,brand_name\nwine-01.jpg,wine,A\nwine-02.jpg,wine,B";
    const result = previewValidateManifest(csv, ["wine-01.jpg"]);
    expect(result.ok).toBe(false);
    expect(result.orphanRows).toEqual([
      { rowIndex: 3, file_name: "wine-02.jpg" },
    ]);
  });

  it("flags orphan uploaded files when manifest doesn't reference them", () => {
    const csv = "file_name,product_type,brand_name\nwine-01.jpg,wine,A";
    const result = previewValidateManifest(csv, [
      "wine-01.jpg",
      "extra.jpg",
    ]);
    expect(result.ok).toBe(false);
    expect(result.orphanFiles).toEqual([{ fileName: "extra.jpg" }]);
  });

  it("matches file names case-insensitively", () => {
    const csv = "file_name,product_type,brand_name\nWine-01.jpg,wine,A";
    const result = previewValidateManifest(csv, ["wine-01.JPG"]);
    expect(result.ok).toBe(true);
  });

  it("handles empty manifest text gracefully", () => {
    const result = previewValidateManifest("", ["wine-01.jpg"]);
    expect(result.ok).toBe(false);
    expect(result.totalRows).toBe(0);
    expect(result.requiredColumnsMissing).toEqual([
      "file_name",
      "product_type",
      "brand_name",
    ]);
  });

  it("punts on JSON manifests (defers to server)", () => {
    const result = previewValidateManifest(
      `{"submissions": []}`,
      ["wine-01.jpg"],
    );
    expect(result.ok).toBe(true);
    expect(result.totalRows).toBe(0);
  });

  it("handles a brand name with a comma via proper quoting", () => {
    const csv =
      'file_name,product_type,brand_name\nwine-01.jpg,wine,"JAUME, SPAIN"';
    const result = previewValidateManifest(csv, ["wine-01.jpg"]);
    expect(result.ok).toBe(true);
  });
});
