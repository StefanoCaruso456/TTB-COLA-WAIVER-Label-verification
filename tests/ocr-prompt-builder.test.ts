import { describe, it, expect } from "vitest";

import { buildOcrPrompt } from "@/lib/services/ocr-prompt-builder";
import type { ColaApplication } from "@/types/cola";

function wineApp(): ColaApplication {
  return {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName: "Cypress Hills",
      netContents: ["750 mL"],
      alcoholContent: "13.5%",
      wine: {
        vintageYear: 2021,
        appellation: "Napa Valley",
        grapeVarietals: ["Cabernet Sauvignon"],
        sulfiteDeclarationExpected: true,
        containsSulfites: true,
      },
    },
    uploadLabelsStep: {
      labelImages: [
        {
          id: "img-1",
          fileName: "front.jpg",
          mimeType: "image/jpeg",
          size: 1024,
          labelImageType: "brand",
        },
      ],
    },
  };
}

describe("buildOcrPrompt — BUG-01 prompt tightening", () => {
  it("requires an entry for every listed target (no silent omission)", () => {
    const { userInstruction } = buildOcrPrompt(wineApp());
    expect(userInstruction).toMatch(/every listed target/i);
    expect(userInstruction).toMatch(/value:\s*null/i);
  });

  it("does not contain the old permissive omit-if-appropriate clause", () => {
    const { userInstruction } = buildOcrPrompt(wineApp());
    expect(userInstruction).not.toMatch(/omit it from the output if appropriate/i);
  });

  it("declares non-English / foreign-market labels in scope and forbids translation", () => {
    const { userInstruction } = buildOcrPrompt(wineApp());
    expect(userInstruction).toMatch(/non-english/i);
    expect(userInstruction).toMatch(/foreign-market/i);
    expect(userInstruction).toMatch(/original language/i);
    expect(userInstruction).toMatch(/do not translate/i);
  });

  it("tells the model to slot uncertain text into the closest target with low confidence rather than dropping it", () => {
    const { userInstruction } = buildOcrPrompt(wineApp());
    expect(userInstruction).toMatch(/closest-matching target/i);
    expect(userInstruction).toMatch(/do NOT drop the field/i);
  });

  it("still keeps the system instruction's no-compliance-decisions guardrail", () => {
    const { systemInstruction } = buildOcrPrompt(wineApp());
    expect(systemInstruction).toMatch(/do not make any approval, compliance, or legal decisions/i);
  });
});
