/**
 * Fixture-based eval runner.
 *
 * Drives the existing `/api/verify` endpoint against a directory of categorized
 * fixtures and asserts category-level expectations on the response. Designed
 * to run against any deployed URL (`--url=...`) and to be reused later as the
 * batch load-test harness.
 *
 * Pattern adopted from
 * https://github.com/fsyeddev/ttb-label/blob/main/scripts/run-fixture-evals.ts
 * with attribution. Manifest shape and judge function are this project's.
 *
 * Usage:
 *   npm run eval:quick
 *   npm run eval:full
 *   npm run eval:full -- --url=https://your-deployment.up.railway.app
 *   npm run eval:full -- --only=02-mismatch-abv-wine,03-missing-warning-spirits
 *   npm run eval:full -- --verbose
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { judge } from "@/lib/evals/judge";
import {
  fixtureFileSchema,
  manifestSchema,
  type FixtureFile,
  type ManifestEntry,
} from "@/lib/evals/expectations.schema";
import type { VerificationReport } from "@/types/verification";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FIXTURES_DIR = resolve(ROOT, "evals", "fixtures", "generated");
const MANIFEST_PATH = resolve(FIXTURES_DIR, "manifest.json");

// 1x1 transparent PNG, used when a fixture omits image base64. The mock
// extractor doesn't look at image content; this just satisfies the schema.
const STUB_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

// Keep in lockstep with mock-label-extraction.service.ts switch cases.
const KNOWN_MOCK_SCENARIOS = new Set([
  "missing-warning",
  "warning-title-case",
  "abv-mismatch",
  "brand-typo",
  "commodity-conflict",
  "image-quality-poor",
  "imported-missing-origin",
]);

interface CliArgs {
  url: string;
  only: string[] | null;
  quick: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const find = (name: string): string | undefined => {
    const flag = `--${name}`;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && i + 1 < args.length) return args[i + 1];
      if (args[i].startsWith(`${flag}=`)) return args[i].split("=")[1];
    }
    return undefined;
  };
  const url = find("url") ?? "http://localhost:3001";
  const onlyRaw = find("only");
  const only = onlyRaw
    ? onlyRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const quick = args.includes("--quick");
  const verbose = args.includes("--verbose");
  return { url, only, quick, verbose };
}

function loadManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`manifest not found at ${MANIFEST_PATH}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("manifest failed schema validation:");
    console.error(JSON.stringify(parsed.error.issues, null, 2));
    process.exit(2);
  }
  return parsed.data;
}

function loadFixture(entry: ManifestEntry): FixtureFile {
  const path = resolve(FIXTURES_DIR, entry.fixtureFile);
  if (!existsSync(path)) {
    console.error(`fixture file missing: ${path}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const parsed = fixtureFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`fixture ${entry.id} failed schema validation:`);
    console.error(JSON.stringify(parsed.error.issues, null, 2));
    process.exit(2);
  }
  const fixture = parsed.data;
  if (
    fixture.mockScenario &&
    !KNOWN_MOCK_SCENARIOS.has(fixture.mockScenario)
  ) {
    console.error(
      `fixture ${entry.id} references unknown mockScenario "${fixture.mockScenario}". Known: ${[...KNOWN_MOCK_SCENARIOS].join(", ")}`,
    );
    process.exit(2);
  }
  return fixture;
}

function selectEntries(
  manifest: ManifestEntry[],
  args: CliArgs,
): ManifestEntry[] {
  if (args.only) {
    const want = new Set(args.only);
    const selected = manifest.filter((e) => want.has(e.id));
    const missing = [...want].filter((id) => !manifest.some((e) => e.id === id));
    if (missing.length > 0) {
      console.error(`--only references unknown fixture ids: ${missing.join(", ")}`);
      process.exit(2);
    }
    return selected;
  }
  if (args.quick) {
    // One per category, lowest id-string per category.
    const byCategory = new Map<number, ManifestEntry>();
    for (const entry of [...manifest].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!byCategory.has(entry.category)) byCategory.set(entry.category, entry);
    }
    return [...byCategory.values()].sort((a, b) => a.category - b.category);
  }
  return manifest;
}

interface RunResult {
  entry: ManifestEntry;
  ok: boolean;
  reasons: string[];
  overallStatus?: VerificationReport["overallStatus"];
  durationMs: number;
  failingChecks?: Array<{ fieldKey: string; status: string; reason?: string }>;
  serverError?: string;
}

async function runOne(
  entry: ManifestEntry,
  fixture: FixtureFile,
  baseUrl: string,
): Promise<RunResult> {
  const images =
    fixture.images && fixture.images.length > 0
      ? fixture.images.map((img) => ({
          ...img,
          base64: img.base64 ?? STUB_PNG_BASE64,
        }))
      : [
          {
            id: "img-1",
            fileName: "stub.png",
            mimeType: "image/png",
            size: 70,
            labelImageType: "brand" as const,
            base64: STUB_PNG_BASE64,
          },
        ];

  const body = {
    clientName: fixture.clientName,
    applicantName: fixture.applicantName,
    productName: fixture.productName,
    application: fixture.application,
    images,
    mockScenario: fixture.mockScenario,
  };

  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const durationMs = Date.now() - start;
    const json = (await res.json()) as
      | { report?: VerificationReport; error?: string }
      | undefined;
    if (!res.ok || !json || !json.report) {
      return {
        entry,
        ok: false,
        reasons: [`server returned ${res.status}: ${json?.error ?? "no report in response"}`],
        durationMs,
        serverError: json?.error ?? `${res.status}`,
      };
    }
    const verdict = judge(json.report, entry.expectations);
    const failingChecks = json.report.checks
      .filter((c) => c.status === "mismatch" || c.status === "missing")
      .map((c) => ({ fieldKey: c.fieldKey, status: c.status, reason: c.reason }));
    return {
      entry,
      ok: verdict.ok,
      reasons: verdict.reasons,
      overallStatus: json.report.overallStatus,
      durationMs,
      failingChecks,
    };
  } catch (err) {
    return {
      entry,
      ok: false,
      reasons: [`fetch error: ${err instanceof Error ? err.message : String(err)}`],
      durationMs: Date.now() - start,
      serverError: err instanceof Error ? err.message : String(err),
    };
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const manifest = loadManifest();
  const entries = selectEntries(manifest, args);

  console.log(
    `Running ${entries.length} fixture${entries.length === 1 ? "" : "s"} against ${args.url}`,
  );
  console.log("─".repeat(78));

  const results: RunResult[] = [];
  const startedAt = Date.now();

  for (const entry of entries) {
    const fixture = loadFixture(entry);
    process.stdout.write(
      `[${pad(entry.id, 36)}] ${pad(entry.description, 30)} … `,
    );
    const r = await runOne(entry, fixture, args.url);
    results.push(r);
    if (r.ok) {
      console.log(`✓ ${pad(r.overallStatus ?? "-", 12)} ${r.durationMs}ms`);
    } else {
      console.log(`✗ ${r.reasons.join("; ")}`);
    }
    if (args.verbose && r.failingChecks && r.failingChecks.length > 0) {
      for (const c of r.failingChecks) {
        console.log(`    ↳ ${c.fieldKey}: ${c.status}${c.reason ? ` — ${c.reason}` : ""}`);
      }
    }
  }

  console.log("─".repeat(78));
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(
    `Done in ${elapsedSec}s — ${passed}/${results.length} matched expectations${
      failed > 0 ? ` (${failed} fail${failed === 1 ? "" : "s"})` : ""
    }`,
  );

  if (failed > 0) {
    console.log("\nMismatches by category:");
    const byCategory = new Map<number, string[]>();
    for (const r of results.filter((r) => !r.ok)) {
      const list = byCategory.get(r.entry.category) ?? [];
      list.push(`${r.entry.id}: ${r.reasons.join("; ")}`);
      byCategory.set(r.entry.category, list);
    }
    for (const [cat, items] of [...byCategory.entries()].sort()) {
      console.log(`\n  Category ${cat}:`);
      for (const item of items) console.log(`    ${item}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
