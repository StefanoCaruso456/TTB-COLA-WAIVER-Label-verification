// Phase 4 pre-flight validator. See docs/specs/phase-4-manifest-support.md.
//
// Pure function: takes the parsed rows + the uploaded file names and returns
// a ManifestValidationReport. No I/O. The route handler decides whether to
// 400 based on the report and uses `matched` to drive the existing Phase 3
// sync executor.

import type {
  ManifestRow,
  ManifestValidationReport,
} from "@/lib/schemas/manifest.schema";

/**
 * Match policy (decision #1 from the approved spec): case-insensitive.
 * Lowercased file_name is the join key on both sides. The original casing
 * is preserved in the output (manifest authored casing wins on each match).
 */
function key(name: string): string {
  return name.trim().toLowerCase();
}

export function validateManifestAgainstFiles(
  rows: ManifestRow[],
  fileNames: string[],
): ManifestValidationReport {
  // Index manifest rows by lowercased file_name.
  const rowByKey = new Map<string, { row: ManifestRow; rowIndex: number }[]>();
  for (const row of rows) {
    const k = key(row.file_name);
    const bucket = rowByKey.get(k) ?? [];
    bucket.push({ row, rowIndex: row.rowIndex });
    rowByKey.set(k, bucket);
  }

  // Index uploaded files by lowercased name.
  const fileByKey = new Map<string, { fileIndex: number; fileName: string }[]>();
  fileNames.forEach((fileName, fileIndex) => {
    const k = key(fileName);
    const bucket = fileByKey.get(k) ?? [];
    bucket.push({ fileIndex, fileName });
    fileByKey.set(k, bucket);
  });

  const duplicateRowFileNames: string[] = [];
  for (const [, bucket] of rowByKey) {
    if (bucket.length > 1) {
      duplicateRowFileNames.push(bucket[0].row.file_name);
    }
  }

  const duplicateUploadedFileNames: string[] = [];
  for (const [, bucket] of fileByKey) {
    if (bucket.length > 1) {
      duplicateUploadedFileNames.push(bucket[0].fileName);
    }
  }

  // Build matched pairs from unique manifest rows.
  const matched: ManifestValidationReport["matched"] = [];
  const orphanRows: ManifestValidationReport["orphanRows"] = [];
  for (const row of rows) {
    const k = key(row.file_name);
    const fileBucket = fileByKey.get(k);
    if (!fileBucket || fileBucket.length === 0) {
      orphanRows.push({ rowIndex: row.rowIndex, file_name: row.file_name });
      continue;
    }
    // Use the first matching file. Duplicates are already flagged above.
    matched.push({ row, fileIndex: fileBucket[0].fileIndex });
  }

  // Files with no manifest row.
  const orphanFiles: ManifestValidationReport["orphanFiles"] = [];
  fileNames.forEach((fileName, fileIndex) => {
    if (!rowByKey.has(key(fileName))) {
      orphanFiles.push({ fileIndex, fileName });
    }
  });

  return {
    matched,
    orphanRows,
    orphanFiles,
    duplicateRowFileNames,
    duplicateUploadedFileNames,
  };
}

export function reportIsClean(report: ManifestValidationReport): boolean {
  return (
    report.orphanRows.length === 0 &&
    report.orphanFiles.length === 0 &&
    report.duplicateRowFileNames.length === 0 &&
    report.duplicateUploadedFileNames.length === 0
  );
}
