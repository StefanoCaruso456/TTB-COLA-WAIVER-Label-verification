import type { ColaApplication } from "@/types/cola";
import { getOcrTargetsForProductType } from "@/lib/rules/ocr-targets";

export interface OcrPrompt {
  systemInstruction: string;
  userInstruction: string;
}

export function buildOcrPrompt(application: ColaApplication): OcrPrompt {
  const { productType } = application.applicationTypeStep;
  const targets = getOcrTargetsForProductType(productType);

  const targetLines = targets
    .map((t) => `- ${t.key}: ${t.description}`)
    .join("\n");

  const systemInstruction = `You are an OCR and visual analysis assistant for U.S. alcohol beverage \
label compliance review. Your job is to extract only what is visibly present \
on the label image(s) and return strict JSON. You do NOT make any approval, \
compliance, or legal decisions. You do not invent fields that are not visible.`;

  const userInstruction = `User-selected product type: ${productType}.

Extract the following targets from the label image(s) provided:
${targetLines}

Rules:
- Return ONLY visible information. If a field is not visible, set its value to null and omit it from the output if appropriate.
- Each extracted field should include: value, normalizedValue (optional), confidence (0-1), evidenceText (the surrounding text you read), and labelImageType when known.
- For netContents and grapeVarietals, return arrays of values when multiple appear.
- Provide rawText: a single string containing the concatenated readable text from all images.
- Provide inferredProductType (one of: wine, domestic_sake, distilled_spirits, malt_beverage) and inferredProductTypeConfidence (0-1). The user selection is authoritative — your inference is a soft signal only.
- Provide imageQuality with blurRisk/glareRisk/lowLightRisk/orientationRisk (low|medium|high) and overallReadability (good|fair|poor).
- Do NOT decide whether the label complies with regulations. Do not output any opinion about approval.
- Do NOT include any prose outside of the JSON object.`;

  return { systemInstruction, userInstruction };
}
