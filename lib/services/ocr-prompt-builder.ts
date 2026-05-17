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
- normalizedFields MUST be a JSON object (NOT an array). Each key is the exact target name listed above (e.g. "brandName", "classOrTypeDesignation"), and each value is a single field object of shape {value, normalizedValue?, confidence?, evidenceText?, labelImageType?}. For netContents and grapeVarietals only, the value is instead an object of shape {"values": [<field object>, ...]}.
- Include EVERY listed target above as a key in normalizedFields, without exception — even when the field is absent from the label. Do not omit a target from the output.
- Example shape (illustrative, not real values): {"normalizedFields": {"brandName": {"value": "EDOUARD DELAUNAY", "confidence": 0.95, "evidenceText": "centered top of front label"}, "classOrTypeDesignation": {"value": null, "evidenceText": "label is French; no US-format class designation shown"}, "netContents": {"values": [{"value": "750 mL", "confidence": 0.9}]}}}
- If a target is genuinely not present on the label, set its value to null and add a short evidenceText explaining why (e.g., "no US-style government warning on this foreign-market label" or "label is French; no 'Red Wine' class designation shown").
- If a target IS visible, return what you see verbatim in value. When you are uncertain which target a visible piece of text belongs to (e.g., a winery name that could be brand OR trade name), pick the closest-matching target, lower the confidence to reflect the uncertainty, and put the raw text in evidenceText — do NOT drop the field.
- Non-English text and foreign-market labels are in scope. Extract visible text exactly as written, in its original language; do not translate. Report fields that don't fit US-format conventions (e.g., no "GOVERNMENT WARNING" prefix) as absent with evidenceText noting the format mismatch, rather than silently omitting them.
- Each extracted field should include: value, normalizedValue (optional), confidence (0-1), evidenceText (the surrounding text you read), and labelImageType when known.
- For netContents and grapeVarietals, return arrays of values when multiple appear.
- Provide rawText: a single string containing the concatenated readable text from all images.
- Provide inferredProductType (one of: wine, domestic_sake, distilled_spirits, malt_beverage) and inferredProductTypeConfidence (0-1). The user selection is authoritative — your inference is a soft signal only.
- Provide imageQuality with blurRisk/glareRisk/lowLightRisk/orientationRisk (low|medium|high) and overallReadability (good|fair|poor).
- Do NOT decide whether the label complies with regulations. Do not output any opinion about approval.
- Do NOT include any prose outside of the JSON object.`;

  return { systemInstruction, userInstruction };
}
