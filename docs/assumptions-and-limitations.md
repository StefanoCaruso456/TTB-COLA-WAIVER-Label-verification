# Assumptions & Limitations

The honest version of what this prototype does, doesn't do, and where it cuts corners. Read alongside `README.md` (capabilities) and `docs/roadmap.md` (phased plan).

## Scope

- **Standalone prototype.** Not integrated with COLAs Online, regulators, or any production submission system. The brief explicitly scopes integration with COLA out.
- **Assists humans.** No auto-approval. No legal determination. The app surfaces evidence and field-level comparisons for a reviewer to act on.
- **No authentication.** Single-user demo posture for MVP. Production would need OIDC + per-reviewer audit trails.
- **No PII handling guarantees.** Treat the deployed instance as a development environment — don't paste real applicant data.

## AI / OCR

- Gemini is called **server-side only** via `@google/genai` 1.52.
- Default model: `gemini-2.5-flash` with `thinkingBudget: 0`. Disabling thinking on this model cut a representative call from ~4 min and $0.16 to ~3–4 s and $0.005 with no measurable accuracy loss on structured OCR.
- `responseMimeType: "application/json"` plus a strict Zod schema (`extractedLabelSchema`). Responses that don't match the schema become typed errors with the first 500 chars + `finishReason` exposed in the API response — so operators can debug from the network panel without redeploying.
- The model is instructed to extract only **visible** information. The prompt explicitly forbids inventing missing fields and requires an entry per OCR target (value or `null` + `evidenceText`).
- AI-inferred product type is a **consistency warning**, never a routing override. The user-selected product type is the source of truth.
- Bold detection, font size, exact layout positioning, and same-field-of-vision enforcement are **out of automated scope** and surface as `human_review_required`.

## Deterministic verification

- Every compliance call (`match`, `mismatch`, `missing`, `not_applicable`, `needs_review`) comes from a typed comparator in `lib/verification/`. The model never decides whether a label complies.
- Brand matching is normalized (lowercase, whitespace, punctuation) and similarity-scored; phonetic fuzzy matching is out of scope.
- Volume normalization covers mL/L; uncommon units (fl oz, cL) are best-effort.
- ABV / proof handles the 2× relationship for distilled spirits with a ~0.1 absolute-percentage-point tolerance.
- Government-warning typography: exact wording and uppercase prefix (27 CFR 16.21) are matched literally. **Tier 1 (bold detection) and Tier 2 (relative font-size, warning vs brand reference) are now automated** via `compare-warning-typography.ts`, defaulting to `needs_review` severity. Operator flips to `error` via `GOV_WARNING_BOLD_SEVERITY` / `GOV_WARNING_SIZING_SEVERITY` env vars after running the fixture eval against real Gemini and confirming accuracy. **Tier 3 (absolute mm-size compliance per 27 CFR 16.22) remains reviewer-side by design** — it would require physical-scale calibration (DPI metadata, reference object, or homography) the current pipeline cannot do honestly. The new `shared.warningStyle.absoluteSize` check makes this responsibility explicit to the reviewer. Full plan: `docs/research/2026-05-18-gov-warning-typography-enforcement.md`; implementation spec: `docs/specs/gov-warning-typography-t1-t2.md`.

## Storage

- **Verification records** (application JSON, extraction JSON, full report) are persisted permanently in Postgres via Prisma.
- **Batch files** are stored via `LocalDiskFileStorage` (content-addressed by SHA-256). In production, point `BATCH_FILE_STORAGE_PATH` at a Railway Volume mount. S3-compatible object storage is a future upgrade for multi-instance deployments.
- Single-label `/api/verify` images are processed in-request and not persisted as durable files (only the metadata + extraction live on in `VerificationRecord`).

## Async batch worker

- The worker runs **in-process** in the same Next.js server that accepts the POST. Railway runs Node as a long-lived process, so a fire-and-forget `processBatch(batchId)` promise continues executing after the response.
- **Restart limitation.** A process restart (deploy, OOM, SIGKILL) strands rows that were in `processing`. `instrumentation.ts` runs a recovery sweep on boot: any `processing` row older than 10 min flips back to `queued` and the batch resumes. There's a ≤10 min recovery delay in the worst case.
- **Idempotency gap.** A SIGKILL between a successful Gemini verification and the `recordSubmissionVerification` write could leave a `VerificationRecord` row that isn't linked back to its `BatchSubmission`. Phase 7 (hardening) introduces a write transaction with idempotency keys. Acceptable for the prototype.
- **Backpressure race.** Two concurrent POSTs can both pass the `BATCH_QUEUE_DEPTH_LIMIT` check and push depth above the cap by O(files). A DB-side advisory lock closes the race; deferred to Phase 7.
- **Worker concurrency.** Defaults to 3 parallel Gemini calls per batch (env `BATCH_WORKER_CONCURRENCY` 1..10). Higher values increase throughput but also Gemini 503 risk. The 503-retry policy is already wired (`callWithRetryOn503`).

## Latency

- **Brief target:** results in ~5 s ("nobody's going to use it" if slower — Sarah Chen interview).
- **Where we land:** the Gemini call itself is ~3–4 s with thinking disabled. End-to-end (`verifyTotalMs`) sits at ~7–8 s on labels with many fields because vision-token processing + structured output is inherently slow at the prompt size required to cover 21 OCR targets.
- **First-row fast path (Phase 6).** For batch uploads, POST `/api/batches` now blocks just long enough to verify row 1 (~5–7 s on `gemini-2.5-flash-lite`) and returns it inline; rows 2…N continue in the background worker. The user sees row 1's full report immediately above the progress bar instead of waiting for the whole batch.
- **Documented levers** (deferred, not measured): aggressively downscale images to 800 px; trim the JSON example from the prompt; loosen the "every target must appear" rule.
- The 5 s SLO is tracked as a 1/0 Braintrust score (`verification.latencyUnder5s` and `extraction.latencyUnder5s`) so the Monitor view shows the hit rate over time without a separate metrics stack.

## Reliability

- The app **must** function with `USE_MOCK_EXTRACTION=true` even when no Gemini key is configured. Hard requirement for demo reliability; verified in CI.
- Braintrust is **lazy-initialized**. Without `BRAINTRUST_API_KEY` the tracer is a true no-op; nothing leaks.

## Production deployment path (TTB-internal network)

The current prototype is on **Railway with the public Gemini API**. That's fine for take-home review — open network, model reachable. It would **not** survive a production deployment inside TTB's network: Marcus Williams (Interview Notes 2024) flagged that "our network blocks outbound traffic to a lot of domains" and that the previous scanning-vendor pilot lost half its features to firewall blocks on cloud ML endpoints.

**Recommended production path: Azure OpenAI in a FedRAMP region, reached via Azure Private Link** ([research note](research/2026-05-18-firewall-fallback.md) for the full option matrix). TTB is already on Azure post-2019, the procurement path is paved, and the firewall exception is a single private endpoint to a Microsoft-internal IP — not "let half the internet through."

**This requires zero code changes to the verifier.** Extraction is already abstracted behind `LabelExtractionService` (interface in `lib/services/label-extraction.service.ts`); `GeminiLabelExtractionService` is one of two implementations today and would become one of three when an `AzureOpenAILabelExtractionService` is added. The orchestrator and the deterministic comparators are provider-agnostic.

Two production-only items remain out of scope until TTB selects a provider:

- The Azure OpenAI implementation itself (one file, ~150 lines mirroring the Gemini service).
- FedRAMP / authorization-to-operate paperwork. Estimated at 12–18 months per Marcus's 2019 migration anecdote — that's an organizational path, not an engineering one.

## Domestic sake

- Reuses the shared schema in MVP. Wine-like optional fields (vintage, appellation, grape varietals) are evaluated only if entered. A full sake-specific rule set is deferred.

## Out of scope for MVP

- LangGraph / agent orchestration. Plain TypeScript calls are sufficient.
- Cancellation of an in-flight batch (queued → canceled transition). Roadmap US-6.5; follow-up PR.
- Idempotency keys + DB-side advisory locks (Phase 7).
- Custom model training, RAG over CFR text, end-to-end legal rules engine.
- PDF / structured CSV export of the verification report.
- Multi-user auth + reviewer assignments + queues.
- Real same-field-of-vision detection using bounding-box geometry.
