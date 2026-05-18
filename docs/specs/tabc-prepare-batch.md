# Feature Spec — `scripts/tabc-prepare-batch.ts`

**Status:** Approved (2026-05-18) — scope confirmed in chat; sibling to Phase 6.
**Owner:** Stefano
**Last updated:** 2026-05-18

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. Content is original.

## Goal

Bridge the gap between TABC's public CSV format (rows that reference label PDFs by URL) and the verifier's batch endpoint (multipart upload of PNG/JPG files + a manifest CSV with `file_name` matching each uploaded file). One developer-machine command turns 199 URL-rows into a folder of PNGs + a verifier-ready manifest you can drag into `/batches/new`.

## Scope

**In scope:**

- New `scripts/tabc-prepare-batch.ts` invoked via `tsx`.
- Input: a TABC-format CSV (default `data/external/tabc-labels-199.csv`).
- Output: a folder containing
  - `images/tabc-<TABC Certificate Number>.png` — one PNG per successfully converted row, page 1 of the certificate PDF at 200 dpi.
  - `manifest.csv` — verifier-format manifest (`file_name, product_type, brand_name, abv, net_contents, country_of_origin`) with one row per successfully converted image.
  - `report.json` — per-row status (`ok` / `failed`) with the failure reason for skipped rows. Audit trail.
- Concurrency (default 5), `--limit N`, `--input`, `--output` CLI flags.
- Idempotent: skip re-download if a PDF is already cached on disk; skip re-convert if the PNG already exists.
- Failure isolation: a single bad URL doesn't abort the run; the row drops out of the manifest with a log entry.
- 6 unit tests (Vitest) covering the pure transforms (`tabcRowToManifestRow`, type mapping, ABV formatting, file_name derivation, idempotency check).

**Out of scope:**

- Building a UI feature (this is a dev-machine ETL, not a product surface).
- Server-side URL fetching (explicitly ruled out — that was option 1 we declined).
- Multi-page PDF handling. We only convert page 1 — the COLA certificate's label image is on page 1. Multi-page support is a future-spec problem if we ever see TTB-certified labels with attachments.
- Running this in CI. Manual invocation only; no GitHub Action.
- Pushing the generated `images/` folder to the repo. Output goes to `data/external/tabc-prepared/` which is added to `.gitignore`.
- TABC data licensing/ToS verification. The dataset is publicly downloadable from data.texas.gov; we treat it as a public artifact for our own testing. Not redistributed.

## Approach

```
$ npm run prep:tabc -- --limit 20

Reading data/external/tabc-labels-199.csv … 198 rows.
Fetching PDFs (concurrency 5)…
  ✓ 1/20 tabc-758166.pdf (37 KB)
  ✓ 2/20 tabc-800248.pdf (62 KB)
  …
Converting to PNG with pdftoppm…
  ✓ 20/20 images
Writing manifest …
Done — data/external/tabc-prepared/
        ├─ images/    (20 PNGs)
        ├─ manifest.csv
        └─ report.json
```

Three sequential stages, each with its own retry policy:

1. **Parse** — read input CSV with `papaparse` (already a dep). Skip rows with `File Link` empty.
2. **Fetch** — `fetch()` each URL into `data/external/tabc-prepared/_pdfs/<sha256-of-URL>.pdf`. Skip if the cache file already exists. 30 s timeout per URL.
3. **Convert** — shell out to `pdftoppm -png -r 200 -f 1 -l 1 <pdf> <out-stem>` (Poppler binary). Skip if the PNG already exists. Resize to max-edge 1024 with `sharp` after, mirroring the production preprocessing budget.

Type + ABV mapping (pure functions, the unit-tested core):

- `WINE` → `wine`
- `MALT BEVERAGE` → `malt_beverage`
- `SPIRIT` → `distilled_spirits` (not in the current 199-row sample but supported for forward compat)
- Anything else → row is skipped + logged in `report.json`.
- `Alcohol Content by Volume` (e.g. `11.5`) → `"11.5% Alc./Vol."` (the format the verifier's ABV comparator expects).
- `Brand Name` → `brand_name` verbatim (preserves the embedded commas in quoted cells).
- `net_contents` and `country_of_origin` → left empty. The verifier's comparators surface those as `MISSING` rather than `MISMATCH`, which is the correct outcome (we don't have ground-truth for these from TABC).

Files touched:

- New `scripts/tabc-prepare-batch.ts`
- New `tests/tabc-prepare-batch.test.ts` (Vitest, unit-only — no real HTTP/shell calls)
- `package.json` adds `"prep:tabc": "tsx scripts/tabc-prepare-batch.ts"` (small).
- `.gitignore` adds `/data/external/tabc-prepared/`.

System prerequisite: `pdftoppm` (Poppler). The script checks for it on startup and exits with an actionable message if missing (`brew install poppler` on macOS, `apt install poppler-utils` on Linux).

## Engineering tasks

1. **Pure transforms (TDD-friendly)**
   1. Export `mapTabcType(t: string): "wine" | "malt_beverage" | "distilled_spirits" | null`.
   2. Export `formatAbv(n: number): string` (returns `"<n>% Alc./Vol."`).
   3. Export `imageFileName(tabcCertificateNumber: string): string` (returns `tabc-<n>.png`).
   4. Export `tabcRowToManifestRow(row): ManifestRowOut | { skipReason: string }`.

2. **Filesystem layout helpers**
   1. `ensureOutputDirs(outRoot)` — create `images/` + `_pdfs/` if absent.
   2. `pdfCachePath(url: string)` — `_pdfs/<sha256-prefix>.pdf`.
   3. `pngOutputPath(row)` — `images/tabc-<cert>.png`.

3. **Fetch stage**
   1. `fetchPdf(url, destPath)` — wraps `fetch`, streams to disk, 30 s timeout, single retry on 503/429 (1 s wait), throws otherwise.
   2. Concurrency-bounded driver (`p-limit` style, hand-rolled — no new deps).

4. **Convert stage**
   1. `convertPdfToPng(pdfPath, pngPath)` — runs `pdftoppm` via `child_process.execFile`. Captures stderr for the failure report.
   2. Sharp resize step that mirrors `lib/services/image-preprocess.ts` (max-edge 1024).

5. **Manifest emit**
   1. Build the verifier-format CSV via `papaparse.unparse`.
   2. Write `report.json` with per-row `{ tabcCertificateNumber, status: "ok" | "failed", reason? }`.

6. **CLI entry**
   1. `process.argv` parsed by hand (no new deps; ~10 lines).
   2. Default input `data/external/tabc-labels-199.csv`, default output `data/external/tabc-prepared/`, default `--limit Infinity`, default `--concurrency 5`.
   3. Exit code 0 on full success, 1 on any-row failure (operator sees CI-style signal).

7. **Tests** (Vitest, no real I/O)
   1. `mapTabcType` covers all four branches incl. the `null` skip path.
   2. `formatAbv` covers integer + fractional + boundary (e.g. 0, 100).
   3. `imageFileName` strips whitespace + special chars from cert number.
   4. `tabcRowToManifestRow` returns the right manifest shape on a happy row and `{ skipReason }` on an unknown type / missing URL / blank brand.
   5. Idempotency: invoking `tabcRowToManifestRow` twice on the same input is deterministic (no side effects in the pure path).
   6. `ensureOutputDirs` is a no-op when the dirs already exist (mocked `fs`).

8. **Docs**
   1. README append: a short "Preparing the TABC corpus" section with the one-line invocation and a heads-up about the Poppler prereq.
   2. Roadmap "Patterns adopted" table: nothing to add — this script is original.

## Acceptance criteria

- [ ] `npm run prep:tabc -- --limit 5` against the in-repo TABC CSV produces 5 PNGs + a manifest + a report.json in `data/external/tabc-prepared/`.
- [ ] The generated `manifest.csv` passes both the client-side (`previewValidateManifest`) and server-side (`validateManifestAgainstFiles`) validators without any orphan rows.
- [ ] Dragging the resulting `images/` folder + `manifest.csv` into `/batches/new` triggers a successful batch with first-row banner.
- [ ] Re-running the script with the same args is a no-op (no re-fetch, no re-convert) and exits 0.
- [ ] If `pdftoppm` is not installed, the script exits 1 with a clear OS-specific install hint, before fetching anything.
- [ ] All 6 unit tests pass; `npx tsc --noEmit` clean.

## Evals

- `tests/tabc-prepare-batch.test.ts` — pure-transform suite. No I/O, no network, no shell.
- (No new Playwright spec. Once the manifest is emitted, the existing Phase 6 E2E specs cover its consumption.)

## Open questions

- **Should we ship the generated `images/` + `manifest.csv` in the repo?** Lean: **no**. Adds ~5 MB of binary data the verifier doesn't need at runtime; we generate on demand. The TABC source CSV stays committed (small, plain text).
- **What if a TABC PDF has the label on page 2 (a back-of-label scan)?** Lean: **convert page 1 only, accept the noise**. The script logs which rows had multi-page certificates so we can sample. Multi-page support is a future spec if accuracy demands it.
- **Should we resize images further (e.g. 800 px max-edge) to shave latency?** Lean: **no — match production `IMAGE_MAX_EDGE` default**. Aggressive resize would mean the script's output behaves differently from a hand-uploaded label, which would confuse latency comparisons.

## Risks

- **Poppler portability.** The script depends on a system binary not present in CI or this Claude container. → mitigation: explicit pre-flight check + actionable error; this is a dev-machine tool, not production, so CI doesn't need it.
- **GCS bucket goes away or rate-limits.** TABC's public bucket has no published SLA. → mitigation: idempotent caching means a re-run only fetches what's not already on disk; rerunning after a bucket outage costs nothing extra.
- **Corrupt PDFs in the source.** A handful of TABC rows historically have malformed PDFs. → mitigation: per-row failure isolation — the row drops out of `manifest.csv`, the operator sees it in `report.json`.

## Manual prerequisites

| What | Why |
|---|---|
| Install Poppler locally (`brew install poppler` on macOS, `apt install poppler-utils` on Linux) | The script shells out to `pdftoppm`. Verified at script startup. |
| Confirm `data/external/tabc-labels-199.csv` is present (or pass `--input`) | The default input path. |

## Notes

- Output `data/external/tabc-prepared/` is `.gitignore`d — generated artifact, not source.
- The script is purposefully **not** wrapped in an API endpoint. That was the explicit rejection of "option 1" (server-side URL fetch) discussed in the Phase 6 review.
- Pattern reference: idempotent fetch-then-transform-then-emit-manifest mirrors a typical dbt seed loader; nothing copied, just a familiar shape.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written. See `docs/roadmap.md` → "How to read this document".
