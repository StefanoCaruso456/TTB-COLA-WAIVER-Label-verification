import { describe, it, expect } from "vitest";

import {
  reportIsClean,
  validateManifestAgainstFiles,
} from "@/lib/services/manifest-validator";
import type { ManifestRow } from "@/lib/schemas/manifest.schema";
import type { ColaApplication } from "@/types/cola";

function row(file_name: string, rowIndex: number): ManifestRow {
  const application: ColaApplication = {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: { brandName: `Brand-${rowIndex}` },
    uploadLabelsStep: {
      labelImages: [
        {
          id: `p${rowIndex}`,
          fileName: file_name,
          mimeType: "image/jpeg",
          size: 0,
          labelImageType: "brand",
        },
      ],
    },
  };
  return { file_name, application, rowIndex };
}

describe("validateManifestAgainstFiles", () => {
  it("happy 1:1 match — every row pairs with one file, no orphans, no dupes", () => {
    const rows = [row("wine-01.jpg", 2), row("wine-02.jpg", 3)];
    const files = ["wine-01.jpg", "wine-02.jpg"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.matched).toHaveLength(2);
    expect(report.matched[0].fileIndex).toBe(0);
    expect(report.matched[1].fileIndex).toBe(1);
    expect(report.orphanRows).toEqual([]);
    expect(report.orphanFiles).toEqual([]);
    expect(reportIsClean(report)).toBe(true);
  });

  it("matches case-insensitively per decision #1 (.JPG vs .jpg)", () => {
    const rows = [row("Wine-01.JPG", 2)];
    const files = ["wine-01.jpg"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.matched).toHaveLength(1);
    expect(report.orphanRows).toEqual([]);
    expect(report.orphanFiles).toEqual([]);
    expect(reportIsClean(report)).toBe(true);
  });

  it("orphan row: manifest references a file that wasn't uploaded", () => {
    const rows = [row("wine-01.jpg", 2), row("wine-99.jpg", 3)];
    const files = ["wine-01.jpg"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.matched).toHaveLength(1);
    expect(report.orphanRows).toEqual([
      { rowIndex: 3, file_name: "wine-99.jpg" },
    ]);
    expect(report.orphanFiles).toEqual([]);
    expect(reportIsClean(report)).toBe(false);
  });

  it("orphan file: image was uploaded but the manifest has no row for it", () => {
    const rows = [row("wine-01.jpg", 2)];
    const files = ["wine-01.jpg", "wine-extra.jpg"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.matched).toHaveLength(1);
    expect(report.orphanFiles).toEqual([
      { fileIndex: 1, fileName: "wine-extra.jpg" },
    ]);
    expect(report.orphanRows).toEqual([]);
    expect(reportIsClean(report)).toBe(false);
  });

  it("duplicate manifest rows pointing at the same file_name", () => {
    const rows = [row("wine-01.jpg", 2), row("WINE-01.jpg", 3)];
    const files = ["wine-01.jpg"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.duplicateRowFileNames).toContain("wine-01.jpg");
    expect(reportIsClean(report)).toBe(false);
  });

  it("duplicate uploaded files (same name, case-insensitive)", () => {
    const rows = [row("wine-01.jpg", 2)];
    const files = ["wine-01.jpg", "Wine-01.JPG"];
    const report = validateManifestAgainstFiles(rows, files);
    expect(report.duplicateUploadedFileNames.length).toBeGreaterThan(0);
    expect(reportIsClean(report)).toBe(false);
  });
});
