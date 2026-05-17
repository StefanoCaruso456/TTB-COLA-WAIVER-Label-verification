import { describe, it, expect } from "vitest";

import { parseCsvManifest } from "@/lib/services/manifest-parser";

describe("parseCsvManifest", () => {
  it("happy path: 1:1 well-formed CSV produces N rows and zero errors", () => {
    const csv = `file_name,product_type,brand_name,abv,net_contents
wine-01.jpg,wine,Bayview Reserve,13.5%,750 mL
wine-02.jpg,wine,Cypress Hills,14.0%,750 mL`;
    const result = parseCsvManifest(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].file_name).toBe("wine-01.jpg");
    expect(result.rows[0].application.colaInformationStep.brandName).toBe(
      "Bayview Reserve",
    );
    expect(result.rows[0].application.applicationTypeStep.productType).toBe(
      "wine",
    );
    expect(result.rows[0].application.colaInformationStep.alcoholContent).toBe(
      "13.5%",
    );
    expect(result.rows[0].rowIndex).toBe(2); // header at line 1, first data row at 2
    expect(result.rows[1].rowIndex).toBe(3);
  });

  it("accepts header variants per field (decision #2: case-insensitive normalization)", () => {
    const csv = `Filename,Type,Brand Name,Alc/Vol,Bottle Size,Country of Origin
wine-01.jpg,wine,Cypress,13.5%,750 mL,USA`;
    const result = parseCsvManifest(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows[0].file_name).toBe("wine-01.jpg");
    expect(result.rows[0].application.colaInformationStep.brandName).toBe(
      "Cypress",
    );
    expect(result.rows[0].application.applicationTypeStep.productType).toBe(
      "wine",
    );
    expect(result.rows[0].application.colaInformationStep.countryOfOrigin).toBe(
      "USA",
    );
  });

  it("fails when a required column has no alias present", () => {
    const csv = `file_name,abv,net_contents
wine-01.jpg,13.5%,750 mL`;
    const result = parseCsvManifest(csv);
    expect(result.rows).toEqual([]);
    expect(result.parseErrors.some((e) => /product_type/i.test(e.reason))).toBe(
      true,
    );
    expect(result.parseErrors.some((e) => /brand_name/i.test(e.reason))).toBe(
      true,
    );
  });

  it("ignores unknown columns silently (does not contaminate the ColaApplication)", () => {
    const csv = `file_name,product_type,brand_name,internal_id,reviewer_notes
wine-01.jpg,wine,Cypress,XYZ-42,looks good`;
    const result = parseCsvManifest(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows[0].application.colaInformationStep.brandName).toBe(
      "Cypress",
    );
    // The internal_id and reviewer_notes should NOT appear anywhere.
    const serialized = JSON.stringify(result.rows[0].application);
    expect(serialized).not.toMatch(/XYZ-42/);
    expect(serialized).not.toMatch(/looks good/);
  });

  it("rejects an empty file with a line-1 parseError", () => {
    const result = parseCsvManifest("");
    expect(result.rows).toEqual([]);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].line).toBe(1);
  });

  it("rejects a header-only file (no data rows)", () => {
    const csv = `file_name,product_type,brand_name\n`;
    const result = parseCsvManifest(csv);
    expect(result.rows).toEqual([]);
    expect(
      result.parseErrors.some((e) => /no data rows/i.test(e.reason)),
    ).toBe(true);
  });

  it("strips a UTF-8 BOM at the start of the file", () => {
    const csv = `﻿file_name,product_type,brand_name\nwine-01.jpg,wine,Cypress`;
    const result = parseCsvManifest(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].application.colaInformationStep.brandName).toBe(
      "Cypress",
    );
  });

  it("preserves quoted commas inside cells", () => {
    const csv = `file_name,product_type,brand_name,country_of_origin
wine-01.jpg,wine,"Doe, Smith & Co.","United States, of America"`;
    const result = parseCsvManifest(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows[0].application.colaInformationStep.brandName).toBe(
      "Doe, Smith & Co.",
    );
    expect(result.rows[0].application.colaInformationStep.countryOfOrigin).toBe(
      "United States, of America",
    );
  });

  it("reports a row-level parseError on an invalid product_type enum value", () => {
    const csv = `file_name,product_type,brand_name
wine-01.jpg,banana_juice,Cypress`;
    const result = parseCsvManifest(csv);
    expect(result.rows).toEqual([]);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].line).toBe(2);
    expect(result.parseErrors[0].reason).toMatch(/product_type/i);
  });

  it("reports a row-level parseError when brand_name is empty", () => {
    const csv = `file_name,product_type,brand_name
wine-01.jpg,wine,`;
    const result = parseCsvManifest(csv);
    expect(result.rows).toEqual([]);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].line).toBe(2);
    expect(result.parseErrors[0].reason).toMatch(/brand_name/i);
  });

  it("skips trailing empty rows (skipEmptyLines: greedy)", () => {
    const csv = `file_name,product_type,brand_name
wine-01.jpg,wine,Cypress

,,
`;
    const result = parseCsvManifest(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.parseErrors).toEqual([]);
  });
});
