# Feature Spec — Phase 4: Manifest support

**Status:** Draft
**Owner:** Stefano
**Last updated:** 2026-05-17

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label/blob/main/docs/specs/_template.md) with attribution. The structure (Status / Goal / Scope / Approach / Acceptance / Evals / Open questions / Notes) is reused as-is; content is original.

## Goal

A reviewer with 50 labels should upload a CSV (or JSON) manifest plus the corresponding image files in a single request, instead of filling 50 forms. The endpoint must validate the manifest pre-flight — orphan files, orphan rows, header typos, and bad enums must fail with a clear report **before** any Gemini call is billed.

## Scope

**In scope:**
- CSV manifest parser with header normalization (4+ aliases per field, sourced from the roadmap §Phase 4 example map).
- JSON manifest parser validated by Zod.
- Pre-flight matching: every manifest row must pair with exactly one image file (by `file_name`), and vice-versa.
- New request shape on `POST /api/batches` that accepts `manifest` + `files`, alongside the existing inline `applications` array (backwards-compatible).
- A `validationReport` returned on 400 listing orphan rows, orphan files, and per-row Zod errors.
- Phase 3's synchronous execution path (≤5 files) is reused unchanged once validation passes.
- Evals shipped in the same PR (`manifest-csv.test.ts`, `manifest-json.test.ts`, `manifest-validator.test.ts`).

**Out of scope:**
- UI for manifest upload (Phase 6).
- Async / queue execution for batches > 5 files (Phase 5).
- Manifest editing or partial-success retries (Phase 6).
- New comparator logic — any field a manifest supplies flows through the existing `ColaApplication` shape.

## Approach

### Request shape (new, additive)

`POST /api/batches` will accept multipart/form-data with:

- `manifest` — single file part, content type `text/csv` **or** `application/json`. Required when using the manifest path. Mutually exclusive with the existing `applications` JSON array.
- `files` — zero-or-more file parts, each named the same as the `file_name` cell in the manifest.
- `batchMetadata` (JSON string field) — same as today: `{ clientName?, applicantName? }`.

Existing inline-applications path stays wired (route.ts still resolves the `applications` array branch unchanged). Detection: if the request has a part named `manifest`, use the manifest branch; else use the inline branch.

### New modules

- `lib/services/manifest-parser.ts`
  - `parseCsvManifest(csv: string): ManifestParseResult` — splits on row, normalizes headers via `HEADER_MAP`, returns `{ rows, parseErrors }`.
  - `parseJsonManifest(json: unknown): ManifestParseResult` — Zod-validated; same shape.
  - `ManifestRow` = `{ file_name: string; application: ColaApplication; rowIndex: number; }`.
  - `ManifestParseResult` = `{ rows: ManifestRow[]; parseErrors: ManifestParseError[] }`.
  - `HEADER_MAP: Record<string, ColaApplicationFieldKey>` — exported, easy to extend.
- `lib/services/manifest-validator.ts`
  - `validateManifestAgainstFiles(rows, fileNames): ValidationReport` — returns `{ matched, orphanRows, orphanFiles }`.
  - `ValidationReport` returned to the client when 400.
- `lib/schemas/manifest.schema.ts`
  - `csvHeaderAliasSchema` (the HEADER_MAP), `manifestJsonSchema` (the `batchMetadata + submissions` shape).
  - `manifestRowSchema` — refines `ColaApplication` post-header-normalization.

### Modified modules

- `app/api/batches/route.ts`
  - Add a branch: if `request.headers.get("content-type")?.startsWith("multipart/form-data")` AND a `manifest` part is present, route to `runManifestBatch()`.
  - Existing inline-JSON branch untouched.
- `lib/schemas/batch-api.schema.ts`
  - Add `ManifestValidationError` to the 400 response union; keep existing error shapes intact.

### Data flow

1. Multipart parse → extract `manifest` part + `files` map + `batchMetadata`.
2. `parseCsvManifest` or `parseJsonManifest` (dispatched on `manifest` content type) → `ManifestParseResult`.
3. If `parseErrors.length > 0` → 400 with `{ error: "manifest_parse_failed", parseErrors }`.
4. `validateManifestAgainstFiles(rows, fileNames)`:
   - If `orphanRows.length > 0` or `orphanFiles.length > 0` → 400 with `{ error: "manifest_files_mismatch", validationReport }`.
5. Build `LabelImagePayload[]` per matched row, hand off to the **existing** Phase 3 sync executor (`createBatch`, `createBatchSubmissions`, loop of `runVerification`).
6. Response is identical to today's Phase 3 response (`CreateBatchResponse`).

### Header normalization (`HEADER_MAP`)

Sourced verbatim from the roadmap §Phase 4 example, lowercased + collapsed-whitespace keys:

```ts
const HEADER_MAP: Record<string, ColaApplicationFieldKey> = {
  "file_name": "file_name",
  "filename": "file_name",
  "file name": "file_name",
  "image": "file_name",

  "brand_name": "brand_name",
  "brand": "brand_name",
  "brand name": "brand_name",

  "abv": "abv",
  "alcohol": "abv",
  "alcohol by volume": "abv",
  "alc/vol": "abv",
  "% alc": "abv",

  "net_contents": "net_contents",
  "volume": "net_contents",
  "size": "net_contents",
  "net contents": "net_contents",
  "bottle size": "net_contents",

  "product_type": "product_type",
  "type": "product_type",
  "commodity": "product_type",
  // ...others added as fixtures demand
};
```

Required after normalization: `file_name`, `product_type`, `brand_name`. All others optional.

## Engineering tasks

1. **Schemas + parser primitives**
   1. Create `lib/schemas/manifest.schema.ts` with `manifestJsonSchema`, `manifestRowSchema`, `csvHeaderAliasSchema`.
   2. Create `lib/services/manifest-parser.ts` with `HEADER_MAP`, `parseCsvManifest`, `parseJsonManifest`. CSV parsing uses `papaparse` (already in tree if available, else add).
   3. Unit tests in `tests/manifest-csv.test.ts` and `tests/manifest-json.test.ts` (8+ and 6+ cases respectively per the roadmap acceptance criteria).

2. **Pre-flight validator**
   1. Create `lib/services/manifest-validator.ts` with `validateManifestAgainstFiles`. Pure function over `(rows, fileNames)`. No I/O.
   2. Unit tests in `tests/manifest-validator.test.ts` covering: 1:1 match, orphan row, orphan file, duplicate `file_name`, case-insensitive match policy (decide in Open Questions below).

3. **Endpoint integration**
   1. In `app/api/batches/route.ts`, add multipart parsing for the `manifest` + `files` branch. Reuse existing `MAX_BATCH_FILES`, `BATCH_MAX_REQUEST_BYTES`, and Phase 3 sync executor.
   2. Add the `ManifestValidationError` shape to `lib/schemas/batch-api.schema.ts` response union.
   3. Integration test `tests-e2e/manifest-batch.spec.ts`: posts a CSV + 5 image fixtures, asserts 5 submissions created and Phase 3 acceptance criteria still pass.

4. **Docs and bug-doc cleanup**
   1. Move spec from Draft → Approved (manual step by Stefano).
   2. Update `docs/roadmap.md` Phase 4 entry from `[ ]` to `[x]` as each acceptance criterion lands.
   3. Add manifest examples (`samples/manifest-5.csv`, `samples/manifest-5.json`) to `data/samples/`.

## Acceptance criteria

(Lifted verbatim from `docs/roadmap.md:571-576`.)

- [ ] CSV with 5 rows + 5 matching image files creates 5 submissions.
- [ ] Manifest row without matching file → 400 with `validationReport` showing the orphan row.
- [ ] Image file without matching manifest row → 400 with the orphan file listed.
- [ ] CSV accepts 4+ header variants per field.
- [ ] JSON manifest validated by Zod with clear error messages.
- [ ] Old (inline `applications` array) path still works (backward compatible) — proven by re-running the Phase 3 E2E suite unchanged.

## Evals

- `tests/manifest-csv.test.ts` — 8+ cases: 1:1 match; header variants per field (`brand`, `Brand Name`, etc.); missing required column; unknown column ignored; empty file; BOM-prefixed file; quoted commas in values; trailing empty rows.
- `tests/manifest-json.test.ts` — 6+ cases: well-formed payload; missing `submissions`; bad `product_type` enum; non-string `file_name`; nested `application` Zod failure; backwards-compat with the inline-`applications` shape returns a clear "this endpoint expects manifest+files" hint.
- `tests/manifest-validator.test.ts` — orphan row; orphan file; duplicate `file_name` in manifest; duplicate file names in upload; case mismatch (depends on Open Question resolution).
- `tests-e2e/manifest-batch.spec.ts` — happy path: POST manifest + 5 wine fixtures, all reach `verified` state, response matches `CreateBatchResponse` shape, Braintrust emits 5 `verify` traces.

## Open questions

- **Case-sensitivity for `file_name` matching** — Lean: case-insensitive on Linux deployments (Railway), case-sensitive on disk-storage round-trips. Rationale: reviewer typos (`wine-01.JPG` vs `wine-01.jpg`) shouldn't fail a batch. Match by lowercased `file_name` in the validator; store the original casing as the canonical name.
- **CSV parser dependency** — Lean: `papaparse`. Rationale: handles quoted commas, BOM, line endings; widely used; ~12 KB minified. Reject the alternative of hand-rolling because RFC 4180 is more annoying than it looks.
- **Required columns on CSV** — Lean: `file_name`, `product_type`, `brand_name` (per roadmap). Rationale: matches the minimum a downstream comparator needs to do anything useful.
- **Orphan-file policy** — Lean: hard 400. Rationale: silent ignore would let a typo in the manifest drop submissions without anyone noticing. Phase 6 UI can offer an "ignore extras" toggle later.
- **Manifest row count cap** — Lean: reuse `MAX_BATCH_FILES = 5` from Phase 3 for this synchronous phase. Bumps to ~200 in Phase 5 when the worker exists.

## Risks

- **Manifest schema drifts as commodities evolve.** → Mitigation: Zod-refine `product_type` against the `productTypeSchema` enum already in `lib/schemas/cola-application.schema.ts`. New product types added there automatically gate the manifest.
- **A malformed CSV cell injects a JSON-parseable value into a downstream field** (e.g. an `abv` cell containing `]; }`). → Mitigation: CSV cells are always strings post-parse; coerce in the Zod schema; no `JSON.parse` of CSV cell contents.
- **Multipart body limit interactions.** → Mitigation: keep the existing `BATCH_MAX_REQUEST_BYTES = 50 MB` guard from AD-012; manifest itself is small (KBs); images dominate. Reject early with 413 instead of 400 if the body exceeds the limit.
- **Header alias explosion** as users find new variants. → Mitigation: `HEADER_MAP` is a plain exported `Record`. New aliases are one-line PRs with a fixture, not a re-architecture.

## Manual prerequisites

| What | Why |
|---|---|
| Decide policy: orphan file → fail batch, or fall back to form-fill | Default in this spec: fail. UI in Phase 6 may add an "ignore extras" override. |
| Provide a sample manifest CSV from a real customer file, if available | Shapes the initial `HEADER_MAP`. Otherwise we ship the roadmap example + 4 aliases per field. |

## Notes

- The Phase 3 spec (`docs/specs/phase-3-synchronous-batch.md`) already enforces the ≤5-file synchronous budget. This spec inherits that limit without changing executor code — manifest parsing happens before the executor runs.
- Backwards-compatibility test (acceptance criterion #6) is the load-bearing one: if the inline-JSON path regresses, every existing Phase 3 user breaks silently. The integration test must cover both branches in the same PR.
- Braintrust telemetry continues to emit one `verify` trace per submission as today; no telemetry changes needed.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written. See `docs/roadmap.md` → "How to read this document".
