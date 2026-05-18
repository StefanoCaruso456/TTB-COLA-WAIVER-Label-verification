# Architecture

## High-level

```
                 ┌─────────────────────────────────────────────┐
                 │              Next.js App (Railway)          │
                 │                                             │
   browser ──►   │   /new  ──►  POST /api/verify               │
                 │                  │                          │
                 │                  ▼                          │
                 │    verification-orchestrator.ts             │
                 │      │                                      │
                 │      ├── Zod validate application + images  │
                 │      ├── label-extraction.service           │
                 │      │     ├── mock-label-extraction        │
                 │      │     └── gemini-label-extraction ─► Gemini (server)
                 │      ├── commodity-router                   │
                 │      ├── verification.service               │
                 │      │     └── compare-* helpers            │
                 │      └── verification-record.service ─► Prisma ─► Postgres
                 │                                             │
                 │   /verification/[id]  ◄── GET /api/verifications/[id]
                 │   /                   ◄── GET /api/verifications
                 └─────────────────────────────────────────────┘
```

## Modules

| Module | Responsibility |
| --- | --- |
| `app/` | Next.js App Router pages + API route handlers |
| `components/` | Presentational React components (form steps, result cards) |
| `lib/schemas/` | Zod schemas + inferred types for application / extracted label / report |
| `lib/rules/` | OCR target maps + per-product rule descriptors |
| `lib/services/` | Stateful coordinators: extraction, orchestration, persistence, commodity router |
| `lib/verification/` | Pure deterministic comparison helpers |
| `types/` | Shared TypeScript types (re-exported from Zod schemas where possible) |
| `prisma/` | Prisma schema + migrations |
| `data/samples/` | Curated sample inputs that work with mock extraction |
| `docs/` | This documentation |

## Orchestration boundary

`lib/services/verification-orchestrator.ts` is the single entry point
the API route calls. It composes extraction, commodity routing,
verification, and persistence. Swapping it for a LangGraph state machine
later does not require touching the rest of the codebase.

## Extraction provider seam

`lib/services/label-extraction.service.ts` defines a single interface:

```ts
interface LabelExtractionService {
  extract(input: LabelExtractionInput): Promise<ExtractedLabel>;
}
```

Two implementations ship today — `GeminiLabelExtractionService` and
`MockLabelExtractionService` — selected at request time by
`resolveExtractionMode(env)`. **The orchestrator and every downstream
verification rule are provider-agnostic**: they consume `ExtractedLabel`,
not a model response.

This matters for the production-deployment path called out in
`assumptions-and-limitations.md` → "Production deployment path
(TTB-internal network)". When TTB selects a network-reachable provider
(most likely Azure OpenAI inside their FedRAMP Azure tenant), the
swap is a single new file implementing the interface plus a one-line
addition to `resolveExtractionMode`. Nothing else changes — no comparator
edits, no schema migration, no UI changes, no eval rewrites.

See `docs/research/2026-05-18-firewall-fallback.md` for the full
provider-option matrix that motivated keeping this seam clean.

## Data flow per verification

1. UI submits `application` (typed) + `images` (uploaded payload) to
   `POST /api/verify`.
2. Route handler delegates to `runVerification(input)`.
3. Orchestrator validates with Zod, fails fast on schema errors.
4. Extraction service runs (mock if `USE_MOCK_EXTRACTION=true`, else Gemini).
5. Commodity router decides routing decision based on the user-selected
   product type. AI inference is only a warning signal.
6. Verification service runs comparison helpers per product rule set and
   returns a `VerificationReport`.
7. Record service persists the application, extraction, and report as
   JSON on a `VerificationRecord` row.
8. Route handler returns `{ recordId, report }`.

## Trust boundaries

- **Browser → Server**: untrusted. All inputs are Zod-validated.
- **Gemini → Server**: untrusted. The model response is Zod-validated
  against `ExtractedLabel` before reaching deterministic code.
- **Server → Postgres**: trusted, but writes are typed via Prisma.

## Failure modes & responses

| Failure | Response |
| --- | --- |
| Application schema fails | 422, surfaced as inline field errors |
| No images provided | 400 |
| Gemini call errors | 500; orchestrator can fall back to mock if `USE_MOCK_EXTRACTION=true` was already set |
| Extraction returns invalid JSON | 500 with a typed error; not retried automatically in MVP |
| DB write fails | 500; the report is still returned to the user with an annotation |

## Deployment

- Railway service builds with `npm run build` (runs `prisma generate`).
- Railway Postgres provides `DATABASE_URL`.
- `GEMINI_API_KEY` and `USE_MOCK_EXTRACTION` are set in Railway env vars.
- Migrations applied via `npm run prisma:migrate` (release step) or
  manually before first deploy.
