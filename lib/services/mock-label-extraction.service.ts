import type { ColaApplication } from "@/types/cola";
import type {
  ExtractedField,
  ExtractedLabel,
  ImageQuality,
} from "@/types/extracted-label";
import type {
  LabelExtractionInput,
  LabelExtractionService,
} from "./label-extraction.service";

const CANONICAL_GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.";

function mirror(
  value: string | undefined | null,
  opts: { imageId?: string; confidence?: number } = {},
): ExtractedField | undefined {
  if (!value) return undefined;
  return {
    value,
    normalizedValue: value,
    confidence: opts.confidence ?? 0.96,
    evidenceText: value,
    imageId: opts.imageId,
    labelImageType: "brand",
  };
}

function mirrorList(
  values: string[] | undefined,
  opts: { imageId?: string } = {},
) {
  if (!values || values.length === 0) return undefined;
  return {
    values: values.map((v) => ({
      value: v,
      normalizedValue: v,
      confidence: 0.95,
      evidenceText: v,
      imageId: opts.imageId,
      labelImageType: "brand" as const,
    })),
  };
}

function defaultImageQuality(): ImageQuality {
  return {
    blurRisk: "low",
    glareRisk: "low",
    lowLightRisk: "low",
    orientationRisk: "low",
    overallReadability: "good",
  };
}

/**
 * Deterministic mock extractor. Mirrors the user-entered application back as
 * "extracted" label data so the happy path always shows passing checks.
 * Sample-driven scenarios can override specific fields via `mockScenario`.
 */
export class MockLabelExtractionService implements LabelExtractionService {
  async extract(input: LabelExtractionInput): Promise<ExtractedLabel> {
    const { application, images, mockScenario } = input;
    const { productType, sourceOfProduct } = application.applicationTypeStep;
    const info = application.colaInformationStep;
    const firstImageId = images[0]?.id;

    const extracted: ExtractedLabel = {
      rawText: `Mock extraction for ${info.brandName ?? "(unknown brand)"}`,
      inferredProductType: productType,
      inferredProductTypeConfidence: 0.9,
      imagesAnalyzed: images.map((i) => i.id),
      imageQuality: defaultImageQuality(),
      normalizedFields: {
        brandName: mirror(info.brandName, { imageId: firstImageId }),
        dbaTradeName: mirror(info.dbaTradeName, { imageId: firstImageId }),
        fancifulName: mirror(info.fancifulName, { imageId: firstImageId }),
        classOrTypeDesignation: mirror(
          inferClassOrType(application),
          { imageId: firstImageId },
        ),
        netContents: mirrorList(info.netContents, { imageId: firstImageId }),
        alcoholContent: mirror(info.alcoholContent, { imageId: firstImageId }),
        nameAndAddress: mirror(info.nameAndAddress, { imageId: firstImageId }),
        countryOfOrigin:
          sourceOfProduct === "imported"
            ? mirror(info.countryOfOrigin, { imageId: firstImageId })
            : undefined,
        governmentWarning: mirror(CANONICAL_GOVERNMENT_WARNING, {
          imageId: firstImageId,
          confidence: 0.99,
        }),
        // Synthesize Tier-1+2 typography so the deterministic test path
        // covers compare-warning-typography.ts. Mutated below by
        // applyMockScenario for the bold-violation / sizing-violation
        // scenarios used in evals.
        governmentWarningTypography: {
          prefixIsBold: true,
          prefixIsAllCaps: true,
          prefixBbox: { x: 0.1, y: 0.85, width: 0.25, height: 0.03 },
          warningBbox: { x: 0.1, y: 0.85, width: 0.8, height: 0.05 },
          brandReferenceBbox: { x: 0.1, y: 0.2, width: 0.6, height: 0.08 },
        },
      },
    };

    if (productType === "wine" || productType === "domestic_sake") {
      const wine = info.wine;
      if (wine?.vintageYear !== undefined) {
        extracted.normalizedFields.vintageYear = mirror(
          String(wine.vintageYear),
          { imageId: firstImageId },
        );
      }
      if (wine?.appellation) {
        extracted.normalizedFields.appellation = mirror(wine.appellation, {
          imageId: firstImageId,
        });
      }
      if (wine?.grapeVarietals && wine.grapeVarietals.length > 0) {
        extracted.normalizedFields.grapeVarietals = mirrorList(
          wine.grapeVarietals,
          { imageId: firstImageId },
        );
      }
      if (wine?.sulfiteDeclarationExpected || wine?.containsSulfites) {
        extracted.normalizedFields.sulfiteDeclaration = mirror(
          "Contains Sulfites",
          { imageId: firstImageId },
        );
      }
    }

    if (productType === "distilled_spirits") {
      const ds = info.distilledSpirits;
      if (ds?.ageStatement) {
        extracted.normalizedFields.ageStatement = mirror(ds.ageStatement, {
          imageId: firstImageId,
        });
      }
      if (ds?.stateOfDistillation) {
        extracted.normalizedFields.stateOfDistillation = mirror(
          ds.stateOfDistillation,
          { imageId: firstImageId },
        );
      }
      const proof = abvToProof(info.alcoholContent);
      if (proof) {
        extracted.normalizedFields.proof = mirror(`${proof} Proof`, {
          imageId: firstImageId,
        });
      }
    }

    if (productType === "malt_beverage") {
      const mb = info.maltBeverage;
      if (mb?.containsFdCYellow5) {
        extracted.normalizedFields.fdCYellow5Disclosure = mirror(
          "CONTAINS FD&C YELLOW NO. 5",
          { imageId: firstImageId },
        );
      }
      if (mb?.containsAspartame) {
        extracted.normalizedFields.aspartameDisclosure = mirror(
          "CONTAINS ASPARTAME — PHENYLKETONURICS: CONTAINS PHENYLALANINE",
          { imageId: firstImageId },
        );
      }
      if (mb?.containsCochinealOrCarmine) {
        extracted.normalizedFields.cochinealOrCarmineDisclosure = mirror(
          "Contains Cochineal Extract",
          { imageId: firstImageId },
        );
      }
      if (mb?.containsSulfites) {
        extracted.normalizedFields.sulfiteDeclaration = mirror(
          "Contains Sulfites",
          { imageId: firstImageId },
        );
      }
    }

    return applyMockScenario(extracted, mockScenario);
  }
}

function inferClassOrType(application: ColaApplication): string {
  const { productType } = application.applicationTypeStep;
  switch (productType) {
    case "wine":
      return "Red Wine";
    case "domestic_sake":
      return "Sake";
    case "distilled_spirits":
      return application.colaInformationStep.distilledSpirits?.ageStatement
        ? "Bourbon Whiskey"
        : "Whiskey";
    case "malt_beverage":
      return "Lager";
  }
}

function abvToProof(alcoholContent?: string): number | undefined {
  if (!alcoholContent) return undefined;
  const m = alcoholContent.match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const abv = Number(m[1]);
  if (!Number.isFinite(abv)) return undefined;
  return Math.round(abv * 2 * 10) / 10;
}

function applyMockScenario(
  base: ExtractedLabel,
  scenario?: string,
): ExtractedLabel {
  if (!scenario) return base;
  const fields = { ...base.normalizedFields };

  switch (scenario) {
    case "missing-warning":
      delete fields.governmentWarning;
      return { ...base, normalizedFields: fields };

    case "warning-title-case":
      fields.governmentWarning = {
        value:
          "Government Warning: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
        confidence: 0.95,
        evidenceText: "Government Warning: According to ...",
      };
      return { ...base, normalizedFields: fields };

    case "abv-mismatch":
      fields.alcoholContent = {
        value: "40% Alc./Vol.",
        normalizedValue: "40% Alc./Vol.",
        confidence: 0.92,
        evidenceText: "40% Alc./Vol.",
      };
      return { ...base, normalizedFields: fields };

    case "brand-typo":
      if (fields.brandName?.value) {
        const original = fields.brandName.value;
        const tweaked = original.replace(/o/i, "0");
        fields.brandName = {
          ...fields.brandName,
          value: tweaked,
          normalizedValue: tweaked,
          evidenceText: tweaked,
          confidence: 0.88,
        };
      }
      return { ...base, normalizedFields: fields };

    case "commodity-conflict":
      return {
        ...base,
        inferredProductType:
          base.inferredProductType === "wine" ? "distilled_spirits" : "wine",
        inferredProductTypeConfidence: 0.86,
        normalizedFields: fields,
      };

    case "image-quality-poor":
      return {
        ...base,
        imageQuality: {
          ...base.imageQuality,
          blurRisk: "high",
          glareRisk: "medium",
          overallReadability: "poor",
          notes: "Heavy blur detected in primary label area.",
        },
      };

    case "imported-missing-origin":
      delete fields.countryOfOrigin;
      return { ...base, normalizedFields: fields };

    case "warning-not-bold":
      // Requirement #15 Tier 1: synthesize a non-bold prefix so
      // compare-warning-typography's bold check is exercised.
      if (fields.governmentWarningTypography) {
        fields.governmentWarningTypography = {
          ...fields.governmentWarningTypography,
          prefixIsBold: false,
        };
      }
      return { ...base, normalizedFields: fields };

    case "warning-too-small":
      // Requirement #15 Tier 2: warning bbox shrunk to ~10% of brand,
      // well under the 50% default threshold.
      if (fields.governmentWarningTypography) {
        fields.governmentWarningTypography = {
          ...fields.governmentWarningTypography,
          warningBbox: { x: 0.1, y: 0.95, width: 0.5, height: 0.01 },
        };
      }
      return { ...base, normalizedFields: fields };

    default:
      return base;
  }
}
