import { normalizeText } from "./normalize";
import type { MaltBeverageFields } from "@/types/cola";
import type { ExtractedLabelFields } from "@/types/extracted-label";
import type { VerificationCheck } from "@/types/verification";

export interface MaltComparisonInput {
  fields?: MaltBeverageFields;
  extractedFields: ExtractedLabelFields;
}

function presenceCheck(
  id: string,
  fieldKey: string,
  label: string,
  expectedText: string,
  extractedValue: string | null | undefined,
  evidenceText?: string,
  confidence?: number,
): VerificationCheck {
  const detected = !!normalizeText(extractedValue);
  return {
    id,
    fieldKey,
    label,
    expectedValue: expectedText,
    extractedValue: extractedValue ?? null,
    status: detected ? "match" : "missing",
    severity: detected ? "info" : "error",
    source: "product_specific_rule",
    automationLevel: "automated",
    reason: detected
      ? undefined
      : `Expected ${label.toLowerCase()} was not detected on the label.`,
    evidenceText,
    confidence,
  };
}

export function compareMaltFields(
  input: MaltComparisonInput,
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const mb = input.fields;
  if (!mb) return checks;

  if (mb.containsFdCYellow5) {
    checks.push(
      presenceCheck(
        "malt.fdCYellow5",
        "fdCYellow5Disclosure",
        "FD&C Yellow #5 disclosure",
        "Contains FD&C Yellow No. 5",
        input.extractedFields.fdCYellow5Disclosure?.value,
        input.extractedFields.fdCYellow5Disclosure?.evidenceText,
        input.extractedFields.fdCYellow5Disclosure?.confidence,
      ),
    );
  }
  if (mb.containsAspartame) {
    checks.push(
      presenceCheck(
        "malt.aspartame",
        "aspartameDisclosure",
        "Aspartame disclosure (Phenylketonurics)",
        "Contains Aspartame — Phenylketonurics: Contains Phenylalanine",
        input.extractedFields.aspartameDisclosure?.value,
        input.extractedFields.aspartameDisclosure?.evidenceText,
        input.extractedFields.aspartameDisclosure?.confidence,
      ),
    );
  }
  if (mb.containsCochinealOrCarmine) {
    checks.push(
      presenceCheck(
        "malt.cochineal",
        "cochinealOrCarmineDisclosure",
        "Cochineal / carmine disclosure",
        "Contains Cochineal Extract / Carmine",
        input.extractedFields.cochinealOrCarmineDisclosure?.value,
        input.extractedFields.cochinealOrCarmineDisclosure?.evidenceText,
        input.extractedFields.cochinealOrCarmineDisclosure?.confidence,
      ),
    );
  }
  if (mb.containsSulfites) {
    checks.push(
      presenceCheck(
        "malt.sulfites",
        "sulfiteDeclaration",
        "Sulfite declaration",
        "Contains Sulfites",
        input.extractedFields.sulfiteDeclaration?.value,
        input.extractedFields.sulfiteDeclaration?.evidenceText,
        input.extractedFields.sulfiteDeclaration?.confidence,
      ),
    );
  }

  return checks;
}
