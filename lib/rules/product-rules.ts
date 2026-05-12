import type { ProductType } from "@/types/cola";

export interface ProductRuleSet {
  productType: ProductType;
  /** Fields that must produce a positive match for the report to pass. */
  requiredChecks: ReadonlyArray<string>;
  /** Optional checks that only run if the user supplied the field. */
  optionalChecks: ReadonlyArray<string>;
  /** Notes the orchestrator can surface in the audit summary. */
  notes?: string;
}

const SHARED_REQUIRED = [
  "brandName",
  "classOrTypeDesignation",
  "netContents",
  "governmentWarning",
];

const SHARED_OPTIONAL = [
  "dbaTradeName",
  "fancifulName",
  "alcoholContent",
  "nameAndAddress",
  "countryOfOrigin",
];

export const PRODUCT_RULE_SETS: Record<ProductType, ProductRuleSet> = {
  wine: {
    productType: "wine",
    requiredChecks: [...SHARED_REQUIRED],
    optionalChecks: [
      ...SHARED_OPTIONAL,
      "vintageYear",
      "grapeVarietals",
      "appellation",
      "sulfiteDeclaration",
    ],
  },
  domestic_sake: {
    productType: "domestic_sake",
    requiredChecks: [...SHARED_REQUIRED],
    optionalChecks: [
      ...SHARED_OPTIONAL,
      "vintageYear",
      "grapeVarietals",
      "appellation",
      "sulfiteDeclaration",
    ],
    notes:
      "Domestic sake reuses the shared schema in MVP. Wine-like optional fields are evaluated only when entered.",
  },
  distilled_spirits: {
    productType: "distilled_spirits",
    requiredChecks: [...SHARED_REQUIRED, "alcoholContent"],
    optionalChecks: [
      ...SHARED_OPTIONAL.filter((k) => k !== "alcoholContent"),
      "ageStatement",
      "stateOfDistillation",
      "proof",
    ],
  },
  malt_beverage: {
    productType: "malt_beverage",
    requiredChecks: [...SHARED_REQUIRED],
    optionalChecks: [
      ...SHARED_OPTIONAL,
      "fdCYellow5Disclosure",
      "aspartameDisclosure",
      "cochinealOrCarmineDisclosure",
      "sulfiteDeclaration",
    ],
  },
};

export function getProductRuleSet(productType: ProductType): ProductRuleSet {
  return PRODUCT_RULE_SETS[productType];
}
