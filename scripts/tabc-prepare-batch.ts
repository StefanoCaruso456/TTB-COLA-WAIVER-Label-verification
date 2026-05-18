// scripts/tabc-prepare-batch.ts
//
// Turns a TABC-format CSV (one row per approved COLA, with a File Link
// column pointing at a Google Cloud Storage PDF) into a verifier-format
// batch bundle: a folder of PNGs + a manifest.csv ready to drag into
// /batches/new. Spec: docs/specs/tabc-prepare-batch.md.
//
// Usage:
//   npm run prep:tabc -- --limit 20
//   npm run prep:tabc -- --input some.csv --output some-dir --concurrency 8
//
// Prerequisite: `pdftoppm` (Poppler). brew install poppler / apt install
// poppler-utils. Verified at startup.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import Papa from "papaparse";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

// ────────────────────────────────────────────────────────────────────────────
// Pure transforms (covered by tests/tabc-prepare-batch.test.ts).
// ────────────────────────────────────────────────────────────────────────────

export type ProductType = "wine" | "malt_beverage" | "distilled_spirits";

const TYPE_MAP: Record<string, ProductType> = {
  WINE: "wine",
  "MALT BEVERAGE": "malt_beverage",
  SPIRIT: "distilled_spirits",
  SPIRITS: "distilled_spirits",
  "DISTILLED SPIRITS": "distilled_spirits",
};

export function mapTabcType(raw: string): ProductType | null {
  const key = raw.trim().toUpperCase();
  return TYPE_MAP[key] ?? null;
}

export function formatAbv(n: number | string): string {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "";
  // Trim trailing zeros (11.50 → 11.5) but keep "11" as "11" not "11.0".
  const trimmed = Number.isInteger(num) ? num.toString() : num.toString();
  return `${trimmed}% Alc./Vol.`;
}

export function imageFileName(tabcCertificateNumber: string): string {
  const safe = tabcCertificateNumber
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-");
  return `tabc-${safe}.png`;
}

export interface TabcCsvRow {
  "TABC Certificate Number": string;
  "Permit/License Number": string;
  "Brand Name": string;
  Type: string;
  "Approval Date": string;
  "Trade Name": string;
  "Alcohol Content by Volume": string;
  "TTB Number": string;
  "File Link": string;
}

export interface ManifestRowOut {
  file_name: string;
  product_type: ProductType;
  brand_name: string;
  abv: string;
  net_contents: string;
  country_of_origin: string;
}

export type TabcRowResult =
  | { ok: true; manifest: ManifestRowOut; pdfUrl: string; certificate: string }
  | { ok: false; certificate: string; skipReason: string };

export function tabcRowToManifestRow(row: TabcCsvRow): TabcRowResult {
  const certificate = (row["TABC Certificate Number"] ?? "").trim();
  if (!certificate) {
    return { ok: false, certificate: "", skipReason: "missing certificate" };
  }
  const url = (row["File Link"] ?? "").trim();
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, certificate, skipReason: "missing or invalid URL" };
  }
  const productType = mapTabcType(row["Type"] ?? "");
  if (!productType) {
    return {
      ok: false,
      certificate,
      skipReason: `unrecognized Type: ${row["Type"]}`,
    };
  }
  const brand = (row["Brand Name"] ?? "").trim();
  if (!brand) {
    return { ok: false, certificate, skipReason: "missing brand_name" };
  }
  return {
    ok: true,
    certificate,
    pdfUrl: url,
    manifest: {
      file_name: imageFileName(certificate),
      product_type: productType,
      brand_name: brand,
      abv: formatAbv(row["Alcohol Content by Volume"]),
      net_contents: "",
      country_of_origin: "",
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Filesystem layout.
// ────────────────────────────────────────────────────────────────────────────

export interface OutputLayout {
  root: string;
  images: string;
  pdfCache: string;
  manifestPath: string;
  reportPath: string;
}

export function makeOutputLayout(root: string): OutputLayout {
  return {
    root,
    images: path.join(root, "images"),
    pdfCache: path.join(root, "_pdfs"),
    manifestPath: path.join(root, "manifest.csv"),
    reportPath: path.join(root, "report.json"),
  };
}

export async function ensureOutputDirs(layout: OutputLayout): Promise<void> {
  await fs.mkdir(layout.images, { recursive: true });
  await fs.mkdir(layout.pdfCache, { recursive: true });
}

export function pdfCachePath(layout: OutputLayout, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return path.join(layout.pdfCache, `${hash}.pdf`);
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-flight: pdftoppm must exist.
// ────────────────────────────────────────────────────────────────────────────

export async function checkPdftoppm(): Promise<void> {
  try {
    await execFileAsync("pdftoppm", ["-v"]);
  } catch {
    const hint =
      process.platform === "darwin"
        ? "brew install poppler"
        : process.platform === "linux"
          ? "sudo apt install poppler-utils"
          : "install Poppler for your OS";
    throw new Error(
      `\`pdftoppm\` is not on PATH. Install it with: ${hint}\n` +
        `This script depends on Poppler to convert the PDF page 1 to a PNG.`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch + convert (I/O).
// ────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

async function fetchPdf(url: string, destPath: string): Promise<void> {
  try {
    await fs.access(destPath);
    return; // cached
  } catch {
    // proceed
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    // Stream the response body to disk so a 50 MB PDF doesn't pin memory.
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(destPath),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function convertPdfToPng(
  pdfPath: string,
  pngPath: string,
): Promise<void> {
  try {
    await fs.access(pngPath);
    return; // cached
  } catch {
    // proceed
  }
  // pdftoppm writes <stem>-1.png by default; use -singlefile so the output is
  // exactly <stem>.png with no page suffix.
  const stem = pngPath.replace(/\.png$/, "");
  await execFileAsync("pdftoppm", [
    "-png",
    "-r",
    "200",
    "-f",
    "1",
    "-l",
    "1",
    "-singlefile",
    pdfPath,
    stem,
  ]);
  // Resize to max-edge 1024 to match the production preprocessing budget.
  // Sharp will read the PNG, resize, and overwrite in-place.
  const tmp = `${pngPath}.tmp.png`;
  await sharp(pngPath)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(tmp);
  await fs.rename(tmp, pngPath);
}

// ────────────────────────────────────────────────────────────────────────────
// CLI.
// ────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  output: string;
  limit: number;
  concurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: "data/external/tabc-labels-199.csv",
    output: "data/external/tabc-prepared",
    limit: Number.POSITIVE_INFINITY,
    concurrency: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]));
    else if (a === "--concurrency")
      args.concurrency = Math.max(1, Math.min(20, Number(argv[++i])));
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/tabc-prepare-batch.ts " +
          "[--input PATH] [--output DIR] [--limit N] [--concurrency N]",
      );
      process.exit(0);
    }
  }
  return args;
}

interface ReportEntry {
  certificate: string;
  status: "ok" | "failed";
  reason?: string;
}

async function run(args: CliArgs): Promise<void> {
  console.log(`Reading ${args.input} …`);
  const csvText = await fs.readFile(args.input, "utf8");
  const parsed = Papa.parse<TabcCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    console.warn(`Parse warnings: ${parsed.errors.length}`);
    for (const e of parsed.errors.slice(0, 3)) {
      console.warn(`  line ${e.row}: ${e.message}`);
    }
  }
  const rows = parsed.data.slice(
    0,
    args.limit === Number.POSITIVE_INFINITY ? undefined : args.limit,
  );
  console.log(`${rows.length} rows to process.`);

  await checkPdftoppm();

  const layout = makeOutputLayout(args.output);
  await ensureOutputDirs(layout);

  const manifest: ManifestRowOut[] = [];
  const report: ReportEntry[] = [];

  // Hand-rolled concurrency-bounded driver — no new deps. Each worker pulls
  // the next row off a shared cursor.
  let cursor = 0;
  let done = 0;
  const total = rows.length;

  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const idx = cursor++;
      const row = rows[idx];
      const transformed = tabcRowToManifestRow(row);
      if (!transformed.ok) {
        report.push({
          certificate: transformed.certificate,
          status: "failed",
          reason: transformed.skipReason,
        });
        done++;
        continue;
      }
      const pdfPath = pdfCachePath(layout, transformed.pdfUrl);
      const pngPath = path.join(
        layout.images,
        transformed.manifest.file_name,
      );
      try {
        await fetchPdf(transformed.pdfUrl, pdfPath);
        await convertPdfToPng(pdfPath, pngPath);
        manifest.push(transformed.manifest);
        report.push({ certificate: transformed.certificate, status: "ok" });
      } catch (err) {
        report.push({
          certificate: transformed.certificate,
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      done++;
      if (done % 5 === 0 || done === total) {
        console.log(
          `  ${done}/${total} processed (${manifest.length} ok, ${report.filter((r) => r.status === "failed").length} failed)`,
        );
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(args.concurrency, rows.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Manifest emit. Preserve row order from the source CSV for reviewer
  // sanity — the worker pushes out-of-order, so sort by certificate as a
  // stable surrogate.
  manifest.sort((a, b) => a.file_name.localeCompare(b.file_name));
  const manifestCsv = Papa.unparse(manifest, {
    columns: [
      "file_name",
      "product_type",
      "brand_name",
      "abv",
      "net_contents",
      "country_of_origin",
    ],
  });
  await fs.writeFile(layout.manifestPath, manifestCsv);
  await fs.writeFile(layout.reportPath, JSON.stringify(report, null, 2));

  const okCount = manifest.length;
  const failCount = report.filter((r) => r.status === "failed").length;
  console.log(`\nDone.`);
  console.log(`  ${okCount} rows in manifest.csv`);
  console.log(`  ${failCount} failures (see report.json)`);
  console.log(`  Output: ${layout.root}`);

  // Exit non-zero if anything failed so CI / scripted invocations notice.
  if (failCount > 0) process.exitCode = 1;
}

// Only run if invoked directly — keep imports test-friendly.
if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
