import { normalizeText, similarity } from "./normalize";
import type {
  VerificationCheck,
  VerificationStatus,
  VerificationSeverity,
} from "@/types/verification";
import type { WineFields } from "@/types/cola";
import type {
  ExtractedField,
  ExtractedFieldList,
  ExtractedLabelFields,
} from "@/types/extracted-label";

interface WineComparisonInput {
  wineFields?: WineFields;
  extractedFields: ExtractedLabelFields;
}

function compareStringField(
  fieldKey: string,
  label: string,
  expected: string | null | undefined,
  extracted: ExtractedField | undefined,
): VerificationCheck | null {
  if (!expected) return null;
  const expectedNorm = normalizeText(expected);
  const extractedRaw = extracted?.value ?? null;
  const extractedNorm = normalizeText(extractedRaw);

  let status: VerificationStatus = "missing";
  let severity: VerificationSeverity = "warning";
  let reason: string | undefined;

  if (!extractedNorm) {
    status = "missing";
    severity = "warning";
    reason = `Expected ${label.toLowerCase()} "${expected}" was not detected on the label.`;
  } else if (extractedNorm === expectedNorm) {
    status = "match";
    severity = "info";
  } else if (similarity(extractedNorm, expectedNorm) >= 0.85) {
    status = "likely_match";
    severity = "warning";
    reason = `Extracted "${extractedRaw}" closely matches expected "${expected}".`;
  } else {
    status = "mismatch";
    severity = "warning";
    reason = `Expected "${expected}" but label shows "${extractedRaw}".`;
  }

  return {
    id: `wine.${fieldKey}`,
    fieldKey,
    label,
    expectedValue: expected,
    extractedValue: extractedRaw,
    status,
    severity,
    confidence: extracted?.confidence,
    source: "product_specific_rule",
    automationLevel: "automated",
    reason,
    evidenceText: extracted?.evidenceText,
  };
}

function compareListField(
  fieldKey: string,
  label: string,
  expected: string[] | undefined,
  extracted: ExtractedFieldList | undefined,
): VerificationCheck | null {
  if (!expected || expected.length === 0) return null;
  const expectedNorms = expected.map((v) => normalizeText(v));
  const extractedNorms =
    extracted?.values
      ?.map((v) => normalizeText(v.value))
      .filter(Boolean) ?? [];

  if (extractedNorms.length === 0) {
    return {
      id: `wine.${fieldKey}`,
      fieldKey,
      label,
      expectedValue: expected.join(", "),
      extractedValue: null,
      status: "missing",
      severity: "warning",
      source: "product_specific_rule",
      automationLevel: "automated",
      reason: `${label} was not detected on the label.`,
    };
  }

  const allFound = expectedNorms.every((e) => extractedNorms.includes(e));
  if (allFound) {
    return {
      id: `wine.${fieldKey}`,
      fieldKey,
      label,
      expectedValue: expected.join(", "),
      extractedValue: extracted?.values
        ?.map((v) => v.value)
        .filter(Boolean)
        .join(", "),
      status: "match",
      severity: "info",
      source: "product_specific_rule",
      automationLevel: "automated",
    };
  }

  const someFound = expectedNorms.some((e) => extractedNorms.includes(e));
  return {
    id: `wine.${fieldKey}`,
    fieldKey,
    label,
    expectedValue: expected.join(", "),
    extractedValue: extracted?.values
      ?.map((v) => v.value)
      .filter(Boolean)
      .join(", "),
    status: someFound ? "likely_match" : "mismatch",
    severity: "warning",
    source: "product_specific_rule",
    automationLevel: "automated",
    reason: someFound
      ? `Some of the expected ${label.toLowerCase()} matched; others were not detected.`
      : `Expected ${label.toLowerCase()} did not match any extracted values.`,
  };
}

export function compareWineFields(
  input: WineComparisonInput,
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const wine = input.wineFields;
  if (!wine) return checks;

  const vintageCheck = compareStringField(
    "vintageYear",
    "Vintage year",
    wine.vintageYear !== undefined ? String(wine.vintageYear) : undefined,
    input.extractedFields.vintageYear,
  );
  if (vintageCheck) checks.push(vintageCheck);

  const appellationCheck = compareStringField(
    "appellation",
    "Appellation",
    wine.appellation,
    input.extractedFields.appellation,
  );
  if (appellationCheck) checks.push(appellationCheck);

  const grapeCheck = compareListField(
    "grapeVarietals",
    "Grape varietals",
    wine.grapeVarietals,
    input.extractedFields.grapeVarietals,
  );
  if (grapeCheck) checks.push(grapeCheck);

  if (wine.sulfiteDeclarationExpected || wine.containsSulfites) {
    const sulfite = input.extractedFields.sulfiteDeclaration;
    const detected = !!normalizeText(sulfite?.value);
    checks.push({
      id: "wine.sulfiteDeclaration",
      fieldKey: "sulfiteDeclaration",
      label: "Sulfite declaration",
      expectedValue: "Contains Sulfites",
      extractedValue: sulfite?.value ?? null,
      status: detected ? "match" : "missing",
      severity: detected ? "info" : "error",
      source: "product_specific_rule",
      automationLevel: "automated",
      reason: detected
        ? undefined
        : "A sulfite declaration is expected for this wine but was not detected on the label.",
      evidenceText: sulfite?.evidenceText,
    });
  }

  return checks;
}
