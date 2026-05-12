import type { ProductType } from "@/types/cola";
import type { CommodityIntent } from "@/types/verification";

export const INFERRED_PRODUCT_TYPE_MIN_CONFIDENCE = 0.75;

export interface ResolveCommodityIntentInput {
  selectedProductType: ProductType;
  inferredProductType?: ProductType;
  inferredConfidence?: number;
}

/**
 * The user-selected product type is always the routing decision.
 * AI-inferred product type only contributes a consistency warning.
 */
export function resolveCommodityIntent(
  input: ResolveCommodityIntentInput,
): CommodityIntent {
  const {
    selectedProductType,
    inferredProductType,
    inferredConfidence,
  } = input;

  const hasReliableInference =
    inferredProductType !== undefined &&
    (inferredConfidence ?? 0) >= INFERRED_PRODUCT_TYPE_MIN_CONFIDENCE;

  if (!inferredProductType || !hasReliableInference) {
    return {
      selectedProductType,
      inferredProductType,
      inferredConfidence,
      routingDecision: selectedProductType,
      conflictDetected: false,
      reason: inferredProductType
        ? `Inferred product type "${inferredProductType}" had low confidence (${(
            inferredConfidence ?? 0
          ).toFixed(2)}); routing by user-selected "${selectedProductType}".`
        : `No reliable inferred product type; routing by user-selected "${selectedProductType}".`,
    };
  }

  if (inferredProductType === selectedProductType) {
    return {
      selectedProductType,
      inferredProductType,
      inferredConfidence,
      routingDecision: selectedProductType,
      conflictDetected: false,
      reason: `Selected and inferred product types agree (${selectedProductType}).`,
    };
  }

  return {
    selectedProductType,
    inferredProductType,
    inferredConfidence,
    routingDecision: selectedProductType,
    conflictDetected: true,
    reason: `Selected product type is "${selectedProductType}" but the label appears to be "${inferredProductType}" (confidence ${(
      inferredConfidence ?? 0
    ).toFixed(2)}). Routing by the user selection; flagging for human review.`,
  };
}
