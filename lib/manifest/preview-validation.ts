// Client-friendly manifest pre-flight check. Runs in the browser before the
// upload POST so a reviewer can see orphan rows / missing files / missing
// required columns before they wait for the server round-trip. Server-side
// validation in `lib/services/manifest-validator.ts` is still authoritative;
// this is a cosmetic gate that disables Submit until the manifest
// reconciles.
//
// Intentionally lightweight: parses the first few CSV rows with a regex,
// recognizes the required columns + their existing aliases, and surfaces
// the same three error shapes the server returns. Does NOT validate
// per-row ColaApplication schema — that's expensive and the server still
// catches it.

export interface PreviewValidationResult {
  ok: boolean;
  totalRows: number;
  requiredColumnsMissing: string[];
  orphanRows: Array<{ rowIndex: number; file_name: string }>;
  orphanFiles: Array<{ fileName: string }>;
  parseError?: string;
}

const REQUIRED = ["file_name", "product_type", "brand_name"] as const;
type Required = (typeof REQUIRED)[number];

const ALIASES: Record<Required, readonly string[]> = {
  file_name: ["file", "filename", "file name", "image", "image_name"],
  product_type: ["type", "producttype", "product type"],
  brand_name: ["brand", "brandname", "brand name"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function canonicalize(header: string): Required | null {
  const n = normalizeHeader(header);
  if ((REQUIRED as readonly string[]).includes(n)) return n as Required;
  for (const required of REQUIRED) {
    if (ALIASES[required].some((a) => normalizeHeader(a) === n)) return required;
  }
  return null;
}

// Minimal RFC-4180-ish row splitter — handles quoted fields with embedded
// commas. Good enough for client-side preview; the server uses a real CSV
// parser for the source of truth.
export function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

export function previewValidateManifest(
  manifestText: string,
  fileNames: string[],
): PreviewValidationResult {
  // JSON manifest: not previewed here. Reviewers using a hand-authored JSON
  // manifest skip straight to the server (Phase 4 path).
  const trimmed = manifestText.trim();
  if (!trimmed) {
    return {
      ok: false,
      totalRows: 0,
      requiredColumnsMissing: [...REQUIRED],
      orphanRows: [],
      orphanFiles: fileNames.map((fileName) => ({ fileName })),
    };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return {
      ok: true,
      totalRows: 0,
      requiredColumnsMissing: [],
      orphanRows: [],
      orphanFiles: [],
    };
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return {
      ok: false,
      totalRows: 0,
      requiredColumnsMissing: [...REQUIRED],
      orphanRows: [],
      orphanFiles: fileNames.map((fileName) => ({ fileName })),
      parseError: "Manifest is empty or has only a header row.",
    };
  }

  const headerCells = splitCsvRow(lines[0]).map(canonicalize);
  const requiredColumnsMissing: string[] = [];
  for (const required of REQUIRED) {
    if (!headerCells.includes(required)) requiredColumnsMissing.push(required);
  }
  const fileNameIdx = headerCells.indexOf("file_name");

  // If file_name itself is missing we can't reconcile rows ↔ files.
  if (fileNameIdx < 0) {
    return {
      ok: false,
      totalRows: lines.length - 1,
      requiredColumnsMissing,
      orphanRows: [],
      orphanFiles: fileNames.map((fileName) => ({ fileName })),
    };
  }

  const manifestFileNames = new Set<string>();
  const orphanRows: Array<{ rowIndex: number; file_name: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    const fn = (cells[fileNameIdx] ?? "").trim();
    if (!fn) continue;
    manifestFileNames.add(fn.toLowerCase());
    if (!fileNames.some((u) => u.toLowerCase() === fn.toLowerCase())) {
      orphanRows.push({ rowIndex: i + 1, file_name: fn });
    }
  }

  const orphanFiles = fileNames
    .filter((u) => !manifestFileNames.has(u.toLowerCase()))
    .map((fileName) => ({ fileName }));

  const ok =
    requiredColumnsMissing.length === 0 &&
    orphanRows.length === 0 &&
    orphanFiles.length === 0;

  return {
    ok,
    totalRows: lines.length - 1,
    requiredColumnsMissing,
    orphanRows,
    orphanFiles,
  };
}
