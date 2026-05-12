import { normalizeText, similarity } from "./normalize";
import type {
  DistilledSpiritsFields,
} from "@/types/cola";
import type { ExtractedLabelFields } from "@/types/extracted-label";
import type {
  VerificationCheck,
  VerificationStatus,
  VerificationSeverity,
} from "@/types/verification";

export interface DistilledSpiritsComparisonInput {
  fields?: DistilledSpiritsFields;
  extractedFields: ExtractedLabelFields;
}

function stringFieldCheck(
  id: string,
  fieldKey: string,
  label: string,
  expected: string | undefined,
  extractedValue: string | null | undefined,
  evidenceText: string | undefined,
  confidence: number | undefined,
): VerificationCheck | null {
  if (!expected) return null;
  const expectedNorm = normalizeText(expected);
  const extractedNorm = normalizeText(extractedValue);

  let status: VerificationStatus = "missing";
  let severity: VerificationSeverity = "warning";
  let reason: string | undefined;

  if (!extractedNorm) {
    reason = `Expected ${label.toLowerCase()} "${expected}" was not detected on the label.`;
  } else if (extractedNorm === expectedNorm) {
    status = "match";
    severity = "info";
  } else if (similarity(extractedNorm, expectedNorm) >= 0.85) {
    status = "likely_match";
    severity = "warning";
    reason = `Extracted "${extractedValue}" closely matches expected "${expected}".`;
  } else {
    status = "mismatch";
    severity = "warning";
    reason = `Expected "${expected}" but label shows "${extractedValue}".`;
  }

  return {
    id,
    fieldKey,
    label,
    expectedValue: expected,
    extractedValue: extractedValue ?? null,
    status,
    severity,
    confidence,
    source: "product_specific_rule",
    automationLevel: "automated",
    reason,
    evidenceText,
  };
}

export function compareDistilledSpiritsFields(
  input: DistilledSpiritsComparisonInput,
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const ds = input.fields;
  if (!ds) return checks;

  const ageStatement = stringFieldCheck(
    "distilled.ageStatement",
    "ageStatement",
    "Age statement",
    ds.ageStatement,
    input.extractedFields.ageStatement?.value,
    input.extractedFields.ageStatement?.evidenceText,
    input.extractedFields.ageStatement?.confidence,
  );
  if (ageStatement) checks.push(ageStatement);

  const state = stringFieldCheck(
    "distilled.stateOfDistillation",
    "stateOfDistillation",
    "State of distillation",
    ds.stateOfDistillation,
    input.extractedFields.stateOfDistillation?.value,
    input.extractedFields.stateOfDistillation?.evidenceText,
    input.extractedFields.stateOfDistillation?.confidence,
  );
  if (state) checks.push(state);

  // Same-field-of-vision rule — explicitly human-review-required.
  checks.push({
    id: "distilled.sameFieldOfVision",
    fieldKey: "sameFieldOfVision",
    label: "Class/type and brand same field of vision",
    expectedValue:
      "Brand and class/type designation should appear in the same field of vision.",
    extractedValue: null,
    status: "needs_review",
    severity: "warning",
    source: "human_review",
    automationLevel: "human_review_required",
    reason:
      "OCR cannot reliably validate same-field-of-vision layout. Reviewer should confirm the brand and class/type designation appear together on the principal display panel.",
  });

  return checks;
}
