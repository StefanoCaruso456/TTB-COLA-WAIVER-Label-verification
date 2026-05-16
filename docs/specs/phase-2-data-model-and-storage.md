# Feature Spec — Phase 2: Data Model and Storage Abstraction

**Status:** Approved
**Owner:** Stefano
**Last updated:** 2026-05-16

> Spec format adopted from [fsyeddev/ttb-label](https://github.com/fsyeddev/ttb-label) with attribution. See `docs/specs/_template.md`.

## Goal

Define the batch entity, per-submission lifecycle, and file-storage interface that the rest of the batch feature will build on. Schema and library code only — no new API endpoints, no UI, no background worker. After this phase the database can model a batch but nothing in the running app reads or writes those new tables yet.

## Scope

**In scope:**
- New Prisma models `Batch` and `BatchSubmission` with the lifecycle fields needed by Phases 3–5.
- An optional backward-compatible FK from `VerificationRecord` to `BatchSubmission` so future verification rows can link back to their batch context.
- A `FileStorage` interface in `lib/services/file-storage.ts` with `put / get / delete / exists` semantics.
- A `LocalDiskFileStorage` implementation in `lib/services/file-storage-disk.ts` that stores bytes under any mountable directory path. Used for local dev, CI, and on Railway when pointed at a mounted Volume.
- A sha256-sharded path scheme so directories don't blow up at scale.
- A typed error taxonomy (`FileNotFoundError`, `FileStorageWriteError`) so callers can react.
- `BATCH_FILE_STORAGE_PATH` env var with a sensible default for local dev (`./.local/batch-files`).
- Prisma migration with safe defaults (additive, nullable where applicable).
- Unit tests against a temp directory — no Volume needed.

**Out of scope:**
- `POST /api/batches`, `GET /api/batches/:id`, or any other API surface (Phase 3).
- Manifest parsing (Phase 4).
- Worker process or queue (Phase 5).
- UI work (Phase 6).
- Cost tracking, structured logs, load test (Phase 7).
- S3-compatible storage implementation. The `FileStorage` interface is designed to make it possible later, but no S3 impl ships here.

## Approach

### File map (new + modified)

| Path | Status | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modified | Add `Batch` and `BatchSubmission` models; add optional FK on `VerificationRecord`. |
| `prisma/migrations/<ts>_add_batch_models/migration.sql` | New | Additive, safe-defaults migration. |
| `lib/services/file-storage.ts` | New | `FileStorage` interface, `FileNotFoundError`, `FileStorageWriteError`, `StoredFileMetadata`. |
| `lib/services/file-storage-disk.ts` | New | `LocalDiskFileStorage` implementation with sha256-sharded layout. |
| `lib/services/error-taxonomy.ts` | New | `BatchErrorCode` enum + helpers. Used by Phase 3+ but landed here so phase 2 callers don't need to invent codes ad-hoc. |
| `types/batch.ts` | New | Re-exports for Prisma-derived types and storage-related types. |
| `.env.example` | Modified | Add `BATCH_FILE_STORAGE_PATH` with default. |
| `.gitignore` | Modified | Add `/.local/` so the default dev storage dir isn't committed. |
| `tests/file-storage-disk.test.ts` | New | Round-trip, sharding, errors, missing-key behavior. |
| `tests/error-taxonomy.test.ts` | New | Enum/helpers sanity. |

### Prisma models

```prisma
model Batch {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?
  status          String   // queued | processing | completed | partially_failed | canceled
  clientName      String?
  applicantName   String?
  manifestJson    Json?    // raw manifest as uploaded, for debugging / audit
  metadata        Json?    // free-form (source, notes, cost, etc.)
  totalCount      Int      @default(0)
  completedCount  Int      @default(0)
  failedCount     Int      @default(0)
  canceledCount   Int      @default(0)
  submissions     BatchSubmission[]

  @@index([createdAt])
  @@index([status])
}

model BatchSubmission {
  id                  String   @id @default(cuid())
  batchId             String
  batch               Batch    @relation(fields: [batchId], references: [id], onDelete: Cascade)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  status              String   // queued | processing | extracted | verified | failed | canceled
  errorMessage        String?
  errorCode           String?  // taxonomy: see lib/services/error-taxonomy.ts
  attemptCount        Int      @default(0)
  fileHash            String   // sha256 of original bytes; used for in-batch dedup
  fileName            String
  fileSize            Int
  fileMimeType        String
  fileStorageKey      String   // opaque key into FileStorage
  applicationJson     Json     // per-submission application data
  verificationRecordId String? @unique
  verificationRecord  VerificationRecord? @relation(fields: [verificationRecordId], references: [id])
  startedAt           DateTime?
  completedAt         DateTime?

  @@index([batchId])
  @@index([status])
  @@index([batchId, status])
  @@index([fileHash])
}

model VerificationRecord {
  // ...existing fields unchanged...
  batchSubmissionId   String?  @unique
  batchSubmission     BatchSubmission?
}
```

**Why optional FK both ways:** existing rows have no batch, future single-label verifications still won't, batch-spawned verifications will. Nullable on both sides keeps the migration backward-compatible.

**Why `Json` for `applicationJson`:** we need to replay the full submitted application on retry; storing structured columns would duplicate the existing `VerificationRecord` design and force a schema change every time a `ColaApplication` field is added.

**Why sha256 for `fileHash`:** lets us dedup identical files inside a single batch and ignore identical retries cheaply. Index on `fileHash` makes the dedup lookup constant time.

### FileStorage interface

```ts
// lib/services/file-storage.ts
export interface StoredFileMetadata {
  storageKey: string;
  size: number;
  mimeType: string;
  hash: string; // sha256 of the raw bytes
}

export interface PutFileInput {
  buffer: Buffer;
  mimeType: string;
  metadata?: Record<string, string>;
}

export interface FileStorage {
  put(input: PutFileInput): Promise<StoredFileMetadata>;
  getBuffer(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

export class FileNotFoundError extends Error {
  constructor(public readonly storageKey: string) {
    super(`File not found in storage: ${storageKey}`);
    this.name = "FileNotFoundError";
  }
}

export class FileStorageWriteError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "FileStorageWriteError";
  }
}
```

`getStream` is **not** in the v1 interface. Phase 3 reads files as buffers (Gemini wants base64), so streams aren't worth the abstraction cost yet. Add later if a need surfaces.

### Sharded path scheme

Given a 64-char sha256 hex hash, the storage key is the hash itself (opaque to callers). On-disk path:

```
<root>/<yyyy>/<mm>/<dd>/<hash[0..2]>/<hash>
```

For example, hash `a1b2c3d4...` on 2026-05-16 lands at:

```
.local/batch-files/2026/05/16/a1/a1b2c3d4...
```

This keeps directory cardinality manageable (~256 dirs × ~366 days × ~years). The date subdirs are a side benefit: easy to expire old batches by deleting `<root>/<yyyy>/<mm>/<dd>/` recursively.

Callers never see the path; they pass `storageKey` (the hash) back to `getBuffer` / `delete` / `exists`.

### Error taxonomy

```ts
// lib/services/error-taxonomy.ts
export const BATCH_ERROR_CODES = {
  INVALID_IMAGE: "INVALID_IMAGE",
  TIMEOUT: "TIMEOUT",
  GEMINI_503: "GEMINI_503",
  GEMINI_OTHER: "GEMINI_OTHER",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  STORAGE_WRITE: "STORAGE_WRITE",
  STORAGE_READ: "STORAGE_READ",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
  UNKNOWN: "UNKNOWN",
} as const;

export type BatchErrorCode = (typeof BATCH_ERROR_CODES)[keyof typeof BATCH_ERROR_CODES];

export function classifyError(err: unknown): BatchErrorCode { /* ... */ }
```

`classifyError` inspects errors and returns the right code. Used by Phase 3+ when transitioning a submission to `failed`. Lives in `lib/services/` so Phase 2 owns the taxonomy and later phases just consume it.

## Engineering tasks

1. **Prisma**
   1. Update `prisma/schema.prisma` with the models above.
   2. `npx prisma migrate dev --name add_batch_models` to generate the migration.
   3. Verify migration applies cleanly on a fresh DB and on a DB with existing `VerificationRecord` rows.
   4. Run `npx prisma generate`.

2. **FileStorage interface + disk impl**
   1. Create `lib/services/file-storage.ts` with the interface and typed errors.
   2. Create `lib/services/file-storage-disk.ts` implementing `LocalDiskFileStorage` using `node:fs/promises`.
   3. Hash buffers with `node:crypto.createHash("sha256")`.
   4. Use the sharded layout. `mkdir -p` lazily on first put.
   5. `getBuffer` throws `FileNotFoundError` on ENOENT, `FileStorageWriteError` on EACCES/EIO.

3. **Error taxonomy**
   1. Create `lib/services/error-taxonomy.ts` with the enum + `classifyError`.
   2. `classifyError` handles `GeminiExtractionError`, `is503Error`, `FileNotFoundError`, `FileStorageWriteError`, `VerificationInputError`, and falls back to `UNKNOWN`.

4. **Types re-export**
   1. Create `types/batch.ts` re-exporting Prisma's generated `Batch`, `BatchSubmission`, and the storage types.

5. **Env + gitignore**
   1. Add `BATCH_FILE_STORAGE_PATH=./.local/batch-files` to `.env.example`.
   2. Add `/.local/` to `.gitignore`.

6. **Tests**
   1. `tests/file-storage-disk.test.ts` — see Evals.
   2. `tests/error-taxonomy.test.ts` — see Evals.

7. **Docs**
   1. Brief mention in `README.md` under "Environment variables" (`BATCH_FILE_STORAGE_PATH`) and a new "Batch storage (Phase 2)" subsection noting that the storage layer exists but isn't wired into any endpoint yet.

## Acceptance criteria

- [ ] `prisma migrate dev --name add_batch_models` runs cleanly on a fresh DB.
- [ ] The migration applies cleanly on the existing schema (no destructive change to `VerificationRecord`).
- [ ] `npx prisma generate` succeeds with no type errors.
- [ ] `LocalDiskFileStorage` round-trips a 1 MB buffer correctly.
- [ ] Stored file lives at the sharded path `<root>/<yyyy>/<mm>/<dd>/<hash[0..2]>/<hash>`.
- [ ] `getBuffer` for an unknown key throws `FileNotFoundError`.
- [ ] `delete` is idempotent (deleting a non-existent key does not throw).
- [ ] `exists` returns `false` for unknown keys, `true` after `put`.
- [ ] `classifyError` correctly maps the 6 known error types listed above.
- [ ] `npm test` continues to pass (existing 79 + new file-storage + error-taxonomy tests).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] `npm run eval:quick` still passes (existing functionality unaffected).
- [ ] No code in `app/`, `components/`, or existing services imports the new batch types or storage interface yet. (Confirms Phase 2 ships as pure foundation.)

## Evals

- `tests/file-storage-disk.test.ts`:
  - `puts_and_gets_round_trip` — 1 MB buffer in, identical bytes out.
  - `path_uses_sharded_layout` — assert the absolute file path matches `<root>/yyyy/mm/dd/<hash[0..2]>/<hash>`.
  - `exists_returns_false_for_unknown_key`
  - `exists_returns_true_after_put`
  - `delete_is_idempotent` — delete on missing key resolves without throwing.
  - `delete_actually_removes_the_file`
  - `getBuffer_throws_FileNotFoundError_on_missing_key`
  - `put_returns_correct_hash` — known-input hash matches sha256 of bytes.
  - `put_records_correct_size` — `metadata.size === buffer.byteLength`.
  - `concurrent_puts_of_same_bytes_dedup_by_hash` — putting the same buffer twice returns the same `storageKey`.

- `tests/error-taxonomy.test.ts`:
  - `classifies_GeminiExtractionError_as_GEMINI_OTHER`
  - `classifies_503_in_message_as_GEMINI_503`
  - `classifies_FileNotFoundError_as_STORAGE_READ`
  - `classifies_FileStorageWriteError_as_STORAGE_WRITE`
  - `classifies_VerificationInputError_as_VALIDATION_ERROR`
  - `classifies_unknown_throwable_as_UNKNOWN`

## Open questions

- **Q1: Should `LocalDiskFileStorage` validate that `BATCH_FILE_STORAGE_PATH` exists at construction time?** Lean: **no — lazy create on first `put`.** Rationale: avoids requiring operators to manually `mkdir` and means tests can pass a temp dir without setup ceremony.
- **Q2: Hash algorithm — sha256 vs blake3?** Lean: **sha256.** Rationale: built into Node (no new dep), fast enough for our scale (~1 GB/s on a single core), industry-standard.
- **Q3: Should we keep raw bytes after a batch completes (audit), or auto-delete?** Lean: **keep for now, expire later.** Rationale: retention policy is operational, not Phase 2 scope. Add a `BATCH_FILE_RETENTION_DAYS` env var in Phase 7 if it becomes a cost or PII issue.
- **Q4: `metadata` field on `Batch` — typed schema or free-form JSON?** Lean: **free-form JSON for v1.** Rationale: we don't yet know what we'll want to put in it; Zod-typing prematurely will fight us.

## Risks

- **Migration touching a table with existing rows.** `VerificationRecord` may have data on Railway. The added column is nullable with no default → safe. → Mitigation: explicit "Apply migration on a database with existing rows" acceptance check.
- **Sharded path collisions.** sha256 collisions are cryptographically negligible; functional collisions across the date prefix are zero (same hash → same dir). → No mitigation needed; documented.
- **Disk fills up.** No retention policy in v1. → Mitigation: document in `docs/bugs.md` as a known-but-deferred risk for any deployment that uses Railway Volumes without expiry. Phase 7 adds retention.
- **`prisma generate` slow.** Each phase that adds models slows codegen. → Negligible at our scale; not mitigated.
- **The interface is half-baked because no caller consumes it yet.** → Mitigation: Phase 3 is the first consumer and will surface any gaps; we accept that some interface tweaks are likely in Phase 3.

## Manual prerequisites

| What | When | Blocking? |
|---|---|---|
| **Approve this spec** | Before any code is written | Yes — spec-first rule. |
| **Mount a Railway Volume** at e.g. `/data/batch-files` (Railway dashboard → Service → Volumes → New volume, then attach to web service) | Before the first deploy that actually exercises batch storage | **No for this PR.** The PR ships code only. The mount is needed before Phase 3's batch endpoint runs in production. Doing it now (proactively) is fine but not required. |
| **Set `BATCH_FILE_STORAGE_PATH` env var** on Railway to the mount path | Same as above | Same as above. Local dev uses the `./.local/batch-files` default. |

## Notes

- The `LocalDiskFileStorage` name is intentional. It works against any mounted filesystem — local dev, CI temp dir, Railway Volume. Naming it after the deploy target (`RailwayVolumeFileStorage`) would be misleading; the code doesn't care where the disk comes from. The roadmap originally proposed the Railway-specific name; this spec corrects that.
- An `S3FileStorage` impl would slot in behind the same interface in a future phase. We're not building it now (per Scope), but the interface is shaped for it.
- After this spec is Approved and the implementation lands, mark Phase 2 acceptance complete in `docs/roadmap.md`.

---

**Status legend:** Draft → Approved → In progress → Done
**Approval rule:** A spec must be **Approved** before any of its code is written.
