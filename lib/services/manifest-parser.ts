// Phase 4 manifest parser. See docs/specs/phase-4-manifest-support.md.
//
// Two entry points:
//   parseCsvManifest(csv: string)
//   parseJsonManifest(json: unknown)
//
// Both return ManifestParseResult — `rows` are fully-validated ColaApplications
// ready to feed the existing Phase 3 sync executor; `parseErrors` is what to
// return in the 400 response.

import Papa from "papaparse";

import {
  manifestJsonSchema,
  MANIFEST_REQUIRED_COLUMNS,
  type ManifestParseError,
  type ManifestParseResult,
  type ManifestRow,
} from "@/lib/schemas/manifest.schema";
import {
  colaApplicationSchema,
  productTypeSchema,
} from "@/lib/schemas/cola-application.schema";
import type { ColaApplication, ProductType } from "@/types/cola";

/**
 * Maps any user-authored header to a canonical key. Lookups are done after
 * lowercasing and collapsing internal whitespace. Add new aliases here (a
 * one-line PR with a fixture) — don't fork the parser.
 *
 * Required (canonical -> aliases): file_name, product_type, brand_name.
 * Optional fields are mapped to their canonical ColaApplication paths and
 * handled by `csvRowToApplication` below.
 */
export const HEADER_MAP: Record<string, string> = {
  // file_name (4 aliases)
  file_name: "file_name",
  filename: "file_name",
  "file name": "file_name",
  image: "file_name",

  // product_type (4 aliases)
  product_type: "product_type",
  type: "product_type",
  commodity: "product_type",
  "product type": "product_type",

  // brand_name (4 aliases)
  brand_name: "brand_name",
  brand: "brand_name",
  "brand name": "brand_name",
  brandname: "brand_name",

  // alcohol_content / abv (5 aliases)
  abv: "alcohol_content",
  alcohol: "alcohol_content",
  "alcohol by volume": "alcohol_content",
  "alc/vol": "alcohol_content",
  "% alc": "alcohol_content",
  alcohol_content: "alcohol_content",
  "alcohol content": "alcohol_content",

  // net_contents (5 aliases)
  net_contents: "net_contents",
  volume: "net_contents",
  size: "net_contents",
  "net contents": "net_contents",
  "bottle size": "net_contents",

  // country_of_origin
  country_of_origin: "country_of_origin",
  "country of origin": "country_of_origin",
  country: "country_of_origin",
  origin: "country_of_origin",

  // source_of_product (domestic|imported)
  source_of_product: "source_of_product",
  "source of product": "source_of_product",
  source: "source_of_product",

  // application_type
  application_type: "application_type",
  "application type": "application_type",
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalizeRow(
  rawRow: Record<string, string>,
): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const normalized = normalizeHeader(k);
    const target = HEADER_MAP[normalized];
    if (!target) continue; // unknown columns are dropped (per spec: "unknown column ignored")
    // Last write wins if two header aliases for the same canonical key both
    // appear in a row — the CSV is malformed, but we don't blow up; the row
    // schema check later flags it if the values disagree on a required field.
    canonical[target] = v?.trim() ?? "";
  }
  return canonical;
}

function csvRowToApplication(
  canonical: Record<string, string>,
  lineNumber: number,
): { application?: ColaApplication; error?: ManifestParseError } {
  // Required: product_type, brand_name.
  const productTypeParse = productTypeSchema.safeParse(canonical["product_type"]);
  if (!productTypeParse.success) {
    return {
      error: {
        line: lineNumber,
        reason: `Invalid or missing product_type. Expected one of: ${productTypeSchema.options.join(", ")}.`,
        issues: productTypeParse.error.issues,
      },
    };
  }
  const productType: ProductType = productTypeParse.data;

  const brandName = canonical["brand_name"];
  if (!brandName) {
    return {
      error: {
        line: lineNumber,
        reason: "Missing required column: brand_name.",
      },
    };
  }

  // Optional fields.
  const sourceOfProduct =
    canonical["source_of_product"]?.toLowerCase() === "imported"
      ? "imported"
      : "domestic";

  const applicationType =
    canonical["application_type"]?.toLowerCase() === "certificate_of_exemption"
      ? "certificate_of_exemption"
      : "certificate_of_label_approval";

  const netContents = canonical["net_contents"]
    ? [canonical["net_contents"]]
    : undefined;

  const draft: ColaApplication = {
    applicationTypeStep: {
      productType,
      sourceOfProduct,
      applicationType,
      isResubmission: false,
    },
    colaInformationStep: {
      brandName,
      netContents,
      alcoholContent: canonical["alcohol_content"] || undefined,
      countryOfOrigin: canonical["country_of_origin"] || undefined,
    },
    uploadLabelsStep: {
      // The image binding happens in the route handler once the file has
      // been matched + buffered. A placeholder lets the Zod validator
      // accept the row in isolation; the real LabelImagePayload is built
      // from the matched file before runVerification is invoked.
      labelImages: [
        {
          id: "manifest-row-placeholder",
          fileName: canonical["file_name"] || "placeholder",
          mimeType: "application/octet-stream",
          size: 0,
          labelImageType: "brand",
        },
      ],
    },
  };

  const result = colaApplicationSchema.safeParse(draft);
  if (!result.success) {
    return {
      error: {
        line: lineNumber,
        reason: "Row failed ColaApplication schema validation.",
        issues: result.error.issues,
      },
    };
  }
  return { application: result.data };
}

export function parseCsvManifest(csv: string): ManifestParseResult {
  const parseErrors: ManifestParseError[] = [];
  const rows: ManifestRow[] = [];

  if (!csv.trim()) {
    return {
      rows,
      parseErrors: [
        { line: 1, reason: "Manifest CSV is empty." },
      ],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  // papaparse parse errors (malformed quoting, etc.).
  for (const e of parsed.errors) {
    parseErrors.push({
      // papaparse rows are 0-based after header; +2 = 1-based with header at line 1
      line: typeof e.row === "number" ? e.row + 2 : 1,
      reason: e.message,
    });
  }

  if (parsed.data.length === 0 && parseErrors.length === 0) {
    parseErrors.push({
      line: 1,
      reason: "Manifest CSV has a header but no data rows.",
    });
    return { rows, parseErrors };
  }

  // Verify the required canonical columns are reachable from the headers.
  const headersSeen = new Set(
    (parsed.meta.fields ?? []).map((f) => HEADER_MAP[normalizeHeader(f)]),
  );
  for (const required of MANIFEST_REQUIRED_COLUMNS) {
    if (!headersSeen.has(required)) {
      parseErrors.push({
        line: 1,
        reason: `Missing required column (or any of its aliases): ${required}.`,
      });
    }
  }
  if (parseErrors.length > 0) return { rows, parseErrors };

  parsed.data.forEach((rawRow, idx) => {
    // Data row N corresponds to file line N+2 (header is line 1).
    const lineNumber = idx + 2;
    const canonical = canonicalizeRow(rawRow);

    if (!canonical["file_name"]) {
      parseErrors.push({
        line: lineNumber,
        reason: "Missing required column: file_name.",
      });
      return;
    }

    const { application, error } = csvRowToApplication(canonical, lineNumber);
    if (error) {
      parseErrors.push(error);
      return;
    }
    rows.push({
      file_name: canonical["file_name"],
      application: application!,
      rowIndex: lineNumber,
    });
  });

  return { rows, parseErrors };
}

export function parseJsonManifest(json: unknown): ManifestParseResult {
  const result = manifestJsonSchema.safeParse(json);
  if (!result.success) {
    return {
      rows: [],
      parseErrors: [
        {
          line: 1,
          reason: "JSON manifest failed schema validation.",
          issues: result.error.issues,
        },
      ],
    };
  }

  const rows: ManifestRow[] = result.data.submissions.map((sub, idx) => ({
    file_name: sub.file_name,
    application: sub.application,
    rowIndex: idx + 1,
  }));

  return { rows, parseErrors: [] };
}

export function extractBatchMetadataFromJson(
  json: unknown,
): { clientName?: string; applicantName?: string } {
  const result = manifestJsonSchema.safeParse(json);
  if (!result.success) return {};
  return result.data.batchMetadata ?? {};
}
