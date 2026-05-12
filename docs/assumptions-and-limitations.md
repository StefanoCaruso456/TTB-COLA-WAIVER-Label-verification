# Assumptions & Limitations

## Scope

- **Standalone prototype.** Not integrated with COLAs Online, regulators,
  or any production submission system.
- **Assists humans.** No auto-approval. No legal determination. The app
  surfaces evidence and field-level comparisons for a reviewer to act on.
- **No authentication.** Single-user demo posture for MVP.
- **No Kaggle / COLA Cloud runtime dependency.** Curated synthetic
  samples power the demo path.

## AI / OCR

- Gemini is used **server-side only** via `@google/genai`.
- The model returns strict JSON; responses are Zod-validated.
- The model is told to extract only **visible** information, not invent
  missing fields.
- AI-inferred product type is a **consistency warning**, never a routing
  override.
- Bold detection, font size, exact layout positioning, and "same field
  of vision" enforcement are **out of automated scope** and surfaced as
  `human_review_required` unless image position evidence is reliable.

## Deterministic verification

- All compliance decisions come from typed TypeScript comparators —
  never directly from model output.
- Brand matching is normalized but does not attempt fuzzy phonetic matching.
- Volume normalization covers mL/L; uncommon units (fl oz, cL) are best-effort.
- ABV/proof handles the 2× relationship for distilled spirits; tolerance
  ~0.1 absolute percentage points.

## Storage

- Image storage in MVP keeps **metadata only** in Postgres. Binary
  contents are processed in the request and not persisted as durable
  files. S3-compatible object storage is a deferred upgrade.
- Verification records (application + extraction + report JSON) are
  persisted permanently.

## Domestic Sake

- Reuses the shared schema in MVP. Wine-like optional fields (vintage,
  appellation, grape varietals) are evaluated only if entered. A
  full sake-specific rule set is deferred.

## Reliability

- The app must function with `USE_MOCK_EXTRACTION=true` even when no
  Gemini key is configured — this is a hard requirement for demo
  reliability.
- The 5-second latency target is the design goal for the Gemini path;
  it is not guaranteed for very large image batches.

## Out of scope for MVP

LangGraph / agent orchestration, batch processing, full CRM, multi-user
auth, durable object storage, PDF report export, real COLAs integration,
custom model training, an end-to-end legal/rules engine.
