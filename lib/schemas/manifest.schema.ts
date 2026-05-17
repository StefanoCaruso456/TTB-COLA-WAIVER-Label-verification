// Phase 4 manifest schemas. See docs/specs/phase-4-manifest-support.md.
//
// Two manifest formats are supported:
//   1. CSV — flexible headers (aliases below), one row per label
//   2. JSON — already-shaped `{ batchMetadata?, submissions: [{ file_name, application }] }`
//
// Both produce the same `ManifestRow[]` shape downstream so the synchronous
// Phase 3 executor sees a uniform input regardless of how the operator
// authored the manifest.

import { z } from "zod";
import { colaApplicationSchema } from "./cola-application.schema";

/**
 * Canonical column keys that the parser emits after header normalization.
 * Add new aliases to `HEADER_MAP` in `manifest-parser.ts`, not here.
 */
export const MANIFEST_REQUIRED_COLUMNS = [
  "file_name",
  "product_type",
  "brand_name",
] as const;

export type ManifestRequiredColumn = (typeof MANIFEST_REQUIRED_COLUMNS)[number];

/**
 * Pre-normalization CSV row: a free-shape `Record<string, string>` with
 * whatever headers the file declared. The parser canonicalizes the keys
 * before this shape is checked.
 */
export const csvRowShapeSchema = z.record(z.string(), z.string());

/**
 * The JSON manifest shape. Mirrors what a tool integrator would build by
 * hand. `application` is the full ColaApplication (the same Zod schema the
 * inline `applications` array uses), so existing comparator code requires
 * zero changes.
 */
export const manifestJsonSchema = z.object({
  batchMetadata: z
    .object({
      clientName: z.string().trim().min(1).optional(),
      applicantName: z.string().trim().min(1).optional(),
    })
    .strict()
    .optional(),
  submissions: z
    .array(
      z.object({
        file_name: z.string().trim().min(1),
        application: colaApplicationSchema,
      }),
    )
    .min(1, "At least one submission row is required."),
});

export type ManifestJson = z.infer<typeof manifestJsonSchema>;

/**
 * The normalized output of either parser. Each row carries:
 *   - `file_name` exactly as authored (used to match an uploaded file)
 *   - `application` fully-validated ColaApplication (passes downstream)
 *   - `rowIndex` 1-based so error messages reference the file the way the
 *     operator authored it (header at row 0; data starts at 1)
 */
export interface ManifestRow {
  file_name: string;
  application: z.infer<typeof colaApplicationSchema>;
  rowIndex: number;
}

/**
 * Per-row parse failure. `line` is 1-based and includes the header for CSV
 * (so `line: 1` is the header). For JSON it's the `submissions` index + 1.
 */
export interface ManifestParseError {
  line: number;
  reason: string;
  /** Zod issues when the failure is schema-level rather than syntax-level. */
  issues?: z.ZodIssue[];
}

export interface ManifestParseResult {
  rows: ManifestRow[];
  parseErrors: ManifestParseError[];
}

/**
 * Validator output. Sent on 400 when files <-> manifest don't reconcile.
 *
 * `matched` is keyed by the canonical (original-cased) file_name from the
 * manifest, mapped to the ManifestRow + the index of the matching file
 * part in the request. Callers iterate this in row order to drive the
 * existing Phase 3 executor.
 */
export interface ManifestValidationReport {
  matched: Array<{ row: ManifestRow; fileIndex: number }>;
  /** Manifest rows with no matching file part. */
  orphanRows: Array<{ rowIndex: number; file_name: string }>;
  /** Uploaded files with no matching manifest row. */
  orphanFiles: Array<{ fileIndex: number; fileName: string }>;
  /** Manifest rows whose `file_name` collides with another row's. */
  duplicateRowFileNames: string[];
  /** Uploaded files with the same name (case-insensitive). */
  duplicateUploadedFileNames: string[];
}
