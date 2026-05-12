import type { ProductType } from "@/types/cola";

export type OcrTargetKey =
  | "brandName"
  | "dbaTradeName"
  | "fancifulName"
  | "classOrTypeDesignation"
  | "netContents"
  | "alcoholContent"
  | "proof"
  | "nameAndAddress"
  | "countryOfOrigin"
  | "governmentWarning"
  | "foreignLanguageText"
  | "specialWordingOrDesigns"
  | "vintageYear"
  | "grapeVarietals"
  | "appellation"
  | "sulfiteDeclaration"
  | "ageStatement"
  | "stateOfDistillation"
  | "neutralSpiritsStatement"
  | "coloringOrWoodTreatmentStatement"
  | "fdCYellow5Disclosure"
  | "aspartameDisclosure"
  | "cochinealOrCarmineDisclosure";

export interface OcrTargetDescriptor {
  key: OcrTargetKey;
  label: string;
  description: string;
}

const SHARED_TARGETS: OcrTargetDescriptor[] = [
  {
    key: "brandName",
    label: "Brand name",
    description: "The principal brand name shown most prominently on the label.",
  },
  {
    key: "dbaTradeName",
    label: "DBA / trade name",
    description: "The 'doing business as' or trade name shown on the label.",
  },
  {
    key: "fancifulName",
    label: "Fanciful name",
    description: "Optional decorative/fanciful product name.",
  },
  {
    key: "classOrTypeDesignation",
    label: "Class / type designation",
    description:
      "The class or type designation (e.g., 'Red Wine', 'Bourbon Whiskey', 'Lager').",
  },
  {
    key: "netContents",
    label: "Net contents",
    description:
      "Net contents statement(s). Capture every distinct volume found on the label.",
  },
  {
    key: "alcoholContent",
    label: "Alcohol content",
    description:
      "Alcohol-by-volume statement and/or proof statement as displayed.",
  },
  {
    key: "nameAndAddress",
    label: "Name & address",
    description:
      "Bottled / produced / imported by name and address as displayed.",
  },
  {
    key: "countryOfOrigin",
    label: "Country of origin",
    description: "Country of origin / 'Product of …' statement if present.",
  },
  {
    key: "governmentWarning",
    label: "Government warning",
    description:
      "The full mandatory government warning statement as visible on the label.",
  },
  {
    key: "foreignLanguageText",
    label: "Foreign-language text",
    description:
      "Any non-English text visible on the label, with translation if shown.",
  },
  {
    key: "specialWordingOrDesigns",
    label: "Special wording / designs",
    description:
      "Decorative wording, claims, awards, or imagery worth flagging.",
  },
];

const WINE_TARGETS: OcrTargetDescriptor[] = [
  {
    key: "vintageYear",
    label: "Vintage year",
    description: "Four-digit vintage year if shown.",
  },
  {
    key: "grapeVarietals",
    label: "Grape varietals",
    description: "Each grape varietal listed on the label.",
  },
  {
    key: "appellation",
    label: "Appellation of origin",
    description: "Appellation of origin or AVA statement.",
  },
  {
    key: "sulfiteDeclaration",
    label: "Sulfite declaration",
    description: "Sulfite declaration ('Contains Sulfites') if shown.",
  },
];

const DISTILLED_SPIRITS_TARGETS: OcrTargetDescriptor[] = [
  {
    key: "proof",
    label: "Proof",
    description: "Proof statement if shown (e.g., '90 Proof').",
  },
  {
    key: "ageStatement",
    label: "Age statement",
    description: "Age statement (e.g., 'Aged 4 Years').",
  },
  {
    key: "stateOfDistillation",
    label: "State of distillation",
    description: "State of distillation if disclosed.",
  },
  {
    key: "neutralSpiritsStatement",
    label: "Neutral spirits statement",
    description: "Neutral spirits / blended statement if applicable.",
  },
  {
    key: "coloringOrWoodTreatmentStatement",
    label: "Coloring / wood treatment statement",
    description: "Coloring or wood-treatment statement if applicable.",
  },
];

const MALT_BEVERAGE_TARGETS: OcrTargetDescriptor[] = [
  {
    key: "fdCYellow5Disclosure",
    label: "FD&C Yellow #5 disclosure",
    description: "FD&C Yellow #5 disclosure if expected.",
  },
  {
    key: "aspartameDisclosure",
    label: "Aspartame disclosure",
    description: "Aspartame disclosure if expected.",
  },
  {
    key: "cochinealOrCarmineDisclosure",
    label: "Cochineal / carmine disclosure",
    description: "Cochineal extract / carmine disclosure if expected.",
  },
  {
    key: "sulfiteDeclaration",
    label: "Sulfite declaration",
    description: "Sulfite declaration if expected.",
  },
];

export function getOcrTargetsForProductType(
  productType: ProductType,
): OcrTargetDescriptor[] {
  switch (productType) {
    case "wine":
      return [...SHARED_TARGETS, ...WINE_TARGETS];
    case "domestic_sake":
      return [...SHARED_TARGETS, ...WINE_TARGETS];
    case "distilled_spirits":
      return [...SHARED_TARGETS, ...DISTILLED_SPIRITS_TARGETS];
    case "malt_beverage":
      return [...SHARED_TARGETS, ...MALT_BEVERAGE_TARGETS];
  }
}
