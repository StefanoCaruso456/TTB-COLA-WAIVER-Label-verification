import type { ColaApplication, LabelImagePayload } from "@/types/cola";

export interface SampleScenario {
  id: string;
  label: string;
  description: string;
  clientName?: string;
  applicantName?: string;
  productName?: string;
  application: ColaApplication;
  images: LabelImagePayload[];
  mockScenario?: string;
}

export interface RawSampleScenarioFile {
  id: string;
  label: string;
  description: string;
  clientName?: string;
  applicantName?: string;
  productName?: string;
  application: ColaApplication;
  images: Array<Omit<LabelImagePayload, "base64">>;
  mockScenario?: string;
}

/**
 * Loader helper so each sample JSON can be imported without dragging Base64
 * payloads into the bundle. Image stubs are synthesised with deterministic
 * metadata that satisfies the schema while keeping the mock extractor happy.
 */
export function fromRawSample(raw: RawSampleScenarioFile): SampleScenario {
  return {
    ...raw,
    images: raw.images.map((image) => ({
      ...image,
      labelImageType: image.labelImageType ?? "unknown",
    })),
  };
}
