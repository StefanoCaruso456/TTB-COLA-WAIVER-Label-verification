# Research note — TTB-internal firewall fallback for the extraction provider

**Author:** Stefano
**Date:** 2026-05-18
**Status:** Planning research — informs but does not commit to a path.
**Related:** `docs/assumptions-and-limitations.md` → "Production deployment path", `docs/architecture.md` → "Extraction provider seam".

## Why this exists

Marcus Williams (IT Systems Administrator, Interview Notes 2024):

> "Our network blocks outbound traffic to a lot of domains, so keep that in mind if you're thinking about cloud APIs. During the scanning vendor pilot, half their features didn't work because our firewall blocked connections to their ML endpoints. Classic."

The current prototype is on Railway with a direct connection to Google's public Gemini API. Inside TTB's network, that endpoint is almost certainly blocked. This note records the options for closing that gap, so the decision is grounded when it's eventually made (likely outside this prototype's scope, but we should leave breadcrumbs).

Decision deferred to TTB procurement; this note is for **engineering posture** — what abstraction do we keep so any of the five options is a small swap rather than a rewrite?

## The five candidate paths

### A — Stay on public-internet Gemini API

Today's state.

| | |
|---|---|
| Network | Outbound HTTPS to `generativelanguage.googleapis.com` |
| Auth | API key in env var |
| Cost | $0.10–0.40 per million input tokens (Flash family) |
| Realistic for TTB prod? | **No.** Public-internet ML endpoint is the exact pattern TTB's firewall blocks. |
| Effort to switch away | Zero — interface seam already in place. |

Verdict: **fine for prototype, dead-on-arrival for TTB-internal deployment.**

### B — Self-host an open-weights vision model on TTB hardware

Candidates (open weights, image-input capable, as of early 2026):

- **Llama 3.2 Vision (11B / 90B)** — Meta. 11B fits on a single A100-80G. License permits commercial use up to 700M MAU.
- **Qwen2-VL (7B / 72B)** — Alibaba. Strong OCR benchmarks; Apache 2.0.
- **PaliGemma 2 (3B / 10B / 28B)** — Google. Optimized for OCR / chart understanding. Open weights, commercial OK.
- **Pixtral 12B** — Mistral. Mid-2024 release; multilingual vision. Apache 2.0.

| | |
|---|---|
| Network | None — runs inside TTB's Azure tenant or on-prem GPU pool. |
| Cost | Hardware: ~$30k–80k per A100-80G or rental at ~$2–3 / GPU-hour. Ops staff to run it. |
| Realistic for TTB prod? | 🟡 Yes, but heavy. |
| Accuracy vs Gemini | Likely **regression** on stylized labels. Tier-1 closed models still outperform open weights on niche OCR (anecdotal: ~5–15 pp accuracy loss on stylized wine labels per public benchmarks like DocVQA and ChartQA). |
| Effort to switch | One new file implementing `LabelExtractionService`. The model server itself (vLLM or text-generation-inference) is standard. |

Verdict: **technically viable, accepts an accuracy regression and adds GPU ops burden.** Worth holding as a fallback if procurement says no cloud LLMs at all.

### C — Azure OpenAI in a FedRAMP region, via Private Link 🟢 **Recommended**

Microsoft hosts OpenAI's GPT-4o / GPT-4-Turbo / GPT-4o-mini inside Azure. Available in **Azure Government** and in commercial Azure regions with **FedRAMP High** authorization. Reachable from a customer's VNet over **Azure Private Link**, so traffic never leaves Microsoft's network — no public-internet hop.

| | |
|---|---|
| Network | Single Private Endpoint inside TTB's existing Azure VNet → Azure OpenAI service. One firewall exception. |
| Auth | Azure AD identity (managed identity / service principal). No long-lived API key. |
| Cost | ~$2.50 / M input tokens (GPT-4o), ~$0.15 / M (GPT-4o-mini). Comparable to Gemini Flash. |
| FedRAMP status | Azure Government: **FedRAMP High**. Azure Commercial: **FedRAMP High** for OpenAI. |
| Data handling | Microsoft contractually does not use customer data to train models; data stays in-region. |
| Realistic for TTB prod? | **Yes — best fit.** TTB is already on Azure post-2019. Procurement / ATO path is paved. |
| Accuracy vs Gemini | GPT-4o vision is comparable on structured label OCR. Minimal regression expected. |
| Effort to switch | One new file: `AzureOpenAILabelExtractionService` implementing the interface. ~150 lines mirroring the Gemini service. |

Verdict: **best end-state for TTB-internal deployment.** Procurement path exists; technical risk is low; accuracy is comparable.

### D — Inference proxy gateway

A single internal service inside TTB's network that holds the one approved outbound endpoint (to whichever cloud LLM gets approved); all app traffic goes through it.

| | |
|---|---|
| Network | One firewall exception, one IP, one TLS cert; everything else routes through it. |
| Pros | Centralized auditing, rate-limiting, key rotation. Concentrates the security-review surface. |
| Cons | Single point of failure; latency overhead; still needs an approved provider on the other end (combine with C or E). |
| Realistic for TTB prod? | 🟡 Yes, as a **complement** to C, not a substitute. |
| Effort | Nontrivial: build/operate an inference proxy + the corresponding client SDK in our app. Reusable across TTB apps, so the cost amortizes. |

Verdict: **useful org-wide pattern but doesn't change the provider choice.** Mention as a possible TTB-internal platform offering; don't build for this prototype.

### E — Local OCR + small local LLM

Tesseract or PaddleOCR for raw text extraction → small local LLM (Llama 3 8B on CPU) for structured parsing.

| | |
|---|---|
| Network | None. |
| Cost | Trivial — runs on existing hardware. |
| Accuracy | **Severe regression.** Tesseract on a stylized wine label produces noise. Decorative fonts, color-on-color, curved baselines — all break Tesseract. Verified informally during prototype exploration. |
| Realistic for TTB prod? | **No** — accuracy floor is below the "useful tool" threshold Sarah Chen defined. |

Verdict: **discarded.** The whole reason we chose a vision LLM (vs. classical OCR + rules) is that wine/spirits labels defeat classical OCR.

## Recommendation

**Plan around C.** Document the seam (done — see `docs/architecture.md` → "Extraction provider seam"). Hold B as a documented fallback for the procurement scenario where TTB rules out all cloud LLMs.

D is an organizational pattern more than a technical choice; if TTB stands up an internal inference proxy, our app uses it via the same `LabelExtractionService` interface — no further code change.

A is the prototype today; that's the right call for take-home review.

E is dead.

## What this means for the prototype

Three concrete things, none of which require new code:

1. **Keep the `LabelExtractionService` interface clean.** Done. The orchestrator never sees a Gemini-specific shape; it consumes `ExtractedLabel` only.
2. **Don't bake Gemini-specific assumptions into comparators or schemas.** Audited: comparators receive normalized `ExtractedField` values, not raw model output. ✅
3. **Document the production path so the manager sees we've thought through it.** This file + the assumptions-doc paragraph + the architecture-doc note.

## What we'd build if TTB chose C

Estimated half-day of work, deferrable to a Phase 7 spec when there's an Azure OpenAI key to test against:

- New `lib/services/azure-openai-label-extraction.service.ts` (~150 lines) implementing `LabelExtractionService`. Mirrors `GeminiLabelExtractionService` structure: build messages with image parts, call `client.chat.completions.create`, parse the JSON response, Zod-validate against `ExtractedLabel`, return.
- Add `"azure_openai"` to `ExtractionMode` in `label-extraction.service.ts` and a new env-var branch in `resolveExtractionMode`.
- A handful of unit tests against recorded fixtures (the same `tests/gemini-*.test.ts` pattern).
- Optional: a fixture-eval run on the existing labels to confirm parity with Gemini before flipping the env var.

No changes to: API routes, orchestrator, comparators, UI, Prisma schema, batch worker, persistence, evals harness.

## Open questions for TTB

If/when this conversation happens:

1. **Is Azure OpenAI in the commercial FedRAMP-High region acceptable, or is Azure Government required?** Materially changes available models — Azure Gov has a smaller model catalog and lags commercial by ~6 months.
2. **What's the retention policy on extracted-label JSON?** Azure OpenAI doesn't retain by default; need to confirm TTB's posture matches.
3. **Are managed identities / workload identities preferred over service principals + secrets?** Affects how the service authenticates from the verifier's Azure App Service / AKS deployment.
4. **Is there an existing TTB-wide inference proxy** (Option D) we should target, or are we direct-to-provider?

## Sources / further reading

- **Azure OpenAI Service compliance** — Microsoft Trust Center: FedRAMP High coverage as of Q4 2024. Confirm latest authorization status before proposing.
- **Azure Private Link for Azure OpenAI** — Microsoft docs: "Configure Azure Private Endpoint for Azure OpenAI."
- **Llama 3.2 Vision** — `huggingface.co/meta-llama/Llama-3.2-11B-Vision-Instruct` model card.
- **Qwen2-VL** — `huggingface.co/Qwen/Qwen2-VL-7B-Instruct`.
- **PaliGemma 2** — `huggingface.co/google/paligemma2-3b-pt-224`.
- **DocVQA / ChartQA benchmarks** for open-weights vs closed vision-LM accuracy comparison.

---

This note is research, not a spec. Promotion to a spec happens if and when TTB asks for an actual implementation of one of these paths.
