# TTB LabelCheck AI — Pre-Research & Architecture Decisions

> **Frozen pre-build planning document.** Captures the architecture and library-choice reasoning *before any code was written*, preserved for context. **For current state, read [`architecture.md`](architecture.md), [`requirements-checklist.md`](requirements-checklist.md), and [`final-deliverable.md`](final-deliverable.md) instead** — those reflect what actually shipped.

## 1. Product Goal

Build a standalone AI-assisted alcohol label verification prototype inspired
by TTB COLAs Online.

The app helps a compliance user:

1. Create a new verification.
2. Select the application/product context.
3. Upload alcohol label images.
4. Enter COLA-style application fields.
5. Use OCR/vision AI to extract visible label information.
6. Compare extracted label values against entered application data.
7. Produce a field-level verification report.
8. Save each verification as an audit/history record.

This prototype **assists** human reviewers. It does not auto-approve labels,
replace legal judgment, or integrate with COLAs Online.

## 2. Core Product Principle

> AI extracts what is **visible**. Deterministic TypeScript code compares
> what was extracted against the user's entered application data. Humans
> make the final call.

```
user enters application fields
  → user uploads label images
  → OCR/vision extracts structured label data
  → deterministic verification engine compares expected vs. extracted
  → app displays human-reviewable results
  → app stores the verification record
```

## 3. Deployment — Railway

Railway hosts the Next.js app and a Postgres database in the same project.
This keeps the prototype simple to ship and demo.

## 4. Database — Railway Postgres + Prisma

Lightweight audit/history log only. Each verification stores:

- application data (JSON)
- extracted label data (JSON)
- verification report (JSON)
- product type, source of product, status
- uploaded image metadata
- reviewer notes (optional)

**Out of scope for MVP:** full CRM, multi-user auth, permission model,
billing, account hierarchy.

## 5. ORM — Prisma

Typed access, clean migrations, good Railway/Postgres support. JSON
columns keep the prototype flexible.

## 6. OCR / Vision — Gemini via `@google/genai`

Gemini gives image understanding, not just OCR text dump:

- visible label text
- structured fields
- image quality estimate
- inferred product type (consistency signal only)
- evidence text + confidence

Gemini does **not** decide compliance, approval, or legal status.

## 7. Gemini SDK — server-side only

Browser calls would leak the API key. All Gemini calls live in Next.js
server code.

Required env:

```
DATABASE_URL=
GEMINI_API_KEY=
USE_MOCK_EXTRACTION=true
MAX_LABEL_IMAGES=10
GEMINI_MODEL=gemini-2.5-flash
```

## 8. Gemini Model — fast multimodal

Start with `gemini-2.5-flash` for speed/cost. Stakeholder feedback: if
results take much longer than ~5s, users will not adopt the tool.
Upgrade only if extraction quality is poor.

## 9. Structured Output — strict JSON + Zod

Gemini is instructed to return JSON. The response is validated with Zod
before any deterministic logic runs. The prompt explicitly tells the model:

- Extract only visible information.
- Do not invent missing values; return null/omit.
- Include confidence values and evidence text.
- Include raw OCR text when possible.
- Infer product type only as a soft signal.
- Do not decide approval/compliance.

Invalid AI output is rejected safely — the user sees a typed error, not
a crashed page.

## 10. No LangChain / LangGraph in MVP

The workflow is linear:

```
validate input
  → build OCR prompt
  → call extraction service
  → validate extracted JSON
  → resolve commodity routing
  → run deterministic verification
  → save record
  → return report
```

LangGraph shines for long-running, stateful, multi-step agent loops with
checkpointing and human-in-the-loop pauses. None of that applies here.

The orchestration boundary lives in
`lib/services/verification-orchestrator.ts` so a future LangGraph
adoption can replace it without touching the rest of the codebase.

## 11. Commodity Routing

> **User-selected product type is the source of truth. AI-inferred
> product type is only a consistency warning.**

- User picks `wine | domestic_sake | distilled_spirits | malt_beverage`.
- The app loads the schema and OCR targets for the **selected** type.
- Gemini may infer a product type from the label.
- If selected vs. inferred conflict, surface a `needs_review` warning.
- Routing still uses the selected product type — never silently switch.

## 12. COLA Workflow

Mirrors a simplified version of COLAs Online:

1. Application Type
2. COLA Information
3. Upload Labels

Fields per step are documented in `requirements-map.md`.

## 13. No Kaggle / COLA Cloud runtime dependency

The take-home asks for a working verification prototype, not a historical
COLA data product. Kaggle is fine as inspiration; it is **not** a runtime
dependency.

## 14. Image storage — MVP-simple

Store image metadata (filename, mime, size, label image type) in
Postgres. Accept images in the verification request and process them
immediately. Object storage (S3, R2, Railway volumes) is a deferred
upgrade and must not block the core workflow.

## 15. Verification History

Lightweight audit log, not a CRM. Columns: date, client/applicant/product,
brand, product type, source (domestic/imported), status, view action.

## 16. Verification Status Model

Per-check fields: `fieldKey, label, expectedValue, extractedValue, status,
severity, confidence, source, automationLevel, reason, evidenceText,
recommendation`.

- **status**: `match | likely_match | mismatch | missing | not_applicable | needs_review`
- **severity**: `info | warning | error`
- **automationLevel**: `automated | partially_automated | human_review_required`

**Overall status:**

- any `error`-level missing/mismatch on a critical required field → **fail**
- any warning, `likely_match`, image-quality issue, or human-review-required check → **needs_review**
- everything required is `match` → **pass**

## 17. Core Verification Rules (shared)

Brand match, DBA/trade name (if entered), fanciful name (if entered),
class/type present, net contents match, alcohol content match (if
entered/required), name & address present/match, country of origin (if
imported), government warning present, government warning prefix
uppercase, required wording present, image quality warning.

### Matching mechanics

- **Brand**: normalize case, whitespace, punctuation, apostrophes/smart
  quotes; ignore ™/®. Exact normalized → match. High similarity → likely_match.
- **ABV/Proof**: parse numerics. For distilled spirits, proof = ABV × 2.
  `45% ABV` and `90 proof` are equivalent (tolerance ~0.1).
- **Volume**: normalize mL/ml, L/liter/litre; convert L → mL. `0.75 L`
  ≡ `750 mL`.
- **Government warning**: required prefix `GOVERNMENT WARNING` in
  uppercase; required phrases present. Bold/font/layout is
  `human_review_required` — OCR cannot reliably validate type style.
- **Image quality**: poor readability → `needs_review`.

## 18. Product-specific rules

Detailed in `requirements-map.md`. Sake reuses shared checks; wine-like
fields are evaluated only if the user entered them, with a documented
MVP limitation.

## 19. UI

Pages: `/` (dashboard/history), `/new` (verification flow),
`/verification/[id]` (saved report). No charts, no navigation drawers.
Form sections match the COLA workflow.

## 20. API

- `POST /api/verify` — run extraction + verification, save record, return report.
- `GET /api/verifications` — list history.
- `GET /api/verifications/[id]` — fetch saved record.
- `PATCH /api/verifications/[id]` — optional reviewer notes update.

## 21. Testing

Unit tests on deterministic logic first: `normalizeText`, `compareBrand`,
`compareAbv`, `compareVolume`, `compareGovernmentWarning`,
`resolveCommodityIntent`, `verifyApplication`, and Zod cross-field
validation. Vitest is the runner.

## 22. Build Order

```
0. Docs
1. Types + Zod schemas
2. Commodity router + OCR target maps
3. Mock + Gemini extraction services
4. Deterministic verification engine
5. Orchestrator
6. Prisma persistence
7. API routes
8. UI
9. Sample data
10. Tests
11. README
12. Railway deployment prep
```

## 23. Tradeoffs

| Chose | Over | Why |
| --- | --- | --- |
| Railway | Vercel | one-place deploy + Postgres |
| Gemini | plain OCR | label verification needs visual/semantic field extraction |
| Prisma | raw SQL | typed persistence accelerates safe iteration |
| Plain TS orchestration | LangGraph | workflow is linear; LangGraph is overkill |
| Mock-first extraction | Gemini-only | demo reliability without an API key |

## 24. Deferred (not in MVP)

LangGraph, batch processing, full CRM, authentication, durable object
storage, PDF export, COLAs integration, custom model training, full
legal/rules engine.
