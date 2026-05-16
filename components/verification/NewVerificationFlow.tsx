"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  ColaApplication,
  LabelImagePayload,
  ProductType,
} from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type { VerificationReport } from "@/types/verification";

import { VerificationResults } from "./VerificationResults";
import type { SampleScenario } from "./sample-scenarios";

type DraftState = {
  clientName: string;
  applicantName: string;
  productName: string;
  application: ColaApplication;
  images: LabelImagePayload[];
  mockScenario?: string;
};

const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "wine", label: "Wine" },
  { value: "domestic_sake", label: "Domestic Sake" },
  { value: "distilled_spirits", label: "Distilled Spirits" },
  { value: "malt_beverage", label: "Malt Beverage" },
];

const LABEL_IMAGE_TYPE_OPTIONS = [
  "brand",
  "back",
  "neck",
  "side",
  "strip",
  "other",
  "unknown",
] as const;

const EMPTY_DRAFT: DraftState = {
  clientName: "",
  applicantName: "",
  productName: "",
  application: {
    applicationTypeStep: {
      productType: "wine",
      sourceOfProduct: "domestic",
      applicationType: "certificate_of_label_approval",
      isResubmission: false,
    },
    colaInformationStep: {
      brandName: "",
      netContents: [],
    },
    uploadLabelsStep: {
      labelImages: [],
    },
  },
  images: [],
};

export function NewVerificationFlow({
  samples,
}: {
  samples: SampleScenario[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [extractedLabel, setExtractedLabel] = useState<ExtractedLabel | null>(
    null,
  );
  const [recordId, setRecordId] = useState<string | null>(null);

  const productType = draft.application.applicationTypeStep.productType;

  const updateAppType = useCallback(
    (patch: Partial<DraftState["application"]["applicationTypeStep"]>) => {
      setDraft((prev) => ({
        ...prev,
        application: {
          ...prev.application,
          applicationTypeStep: {
            ...prev.application.applicationTypeStep,
            ...patch,
          },
        },
      }));
    },
    [],
  );

  const updateInfo = useCallback(
    (patch: Partial<DraftState["application"]["colaInformationStep"]>) => {
      setDraft((prev) => ({
        ...prev,
        application: {
          ...prev.application,
          colaInformationStep: {
            ...prev.application.colaInformationStep,
            ...patch,
          },
        },
      }));
    },
    [],
  );

  const updateUpload = useCallback(
    (patch: Partial<DraftState["application"]["uploadLabelsStep"]>) => {
      setDraft((prev) => ({
        ...prev,
        application: {
          ...prev.application,
          uploadLabelsStep: {
            ...prev.application.uploadLabelsStep,
            ...patch,
          },
        },
      }));
    },
    [],
  );

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList).slice(0, 10);
    const payloads = await Promise.all(
      files.map(async (file, idx) => {
        const base64 = await fileToBase64(file);
        const payload: LabelImagePayload = {
          id: `img-${Date.now()}-${idx}`,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          labelImageType: idx === 0 ? "brand" : "unknown",
          base64,
        };
        return payload;
      }),
    );
    setDraft((prev) => {
      const next = [...prev.images, ...payloads].slice(0, 10);
      return {
        ...prev,
        images: next,
        application: {
          ...prev.application,
          uploadLabelsStep: {
            ...prev.application.uploadLabelsStep,
            labelImages: next.map((image) => ({
              ...image,
              base64: undefined,
            })),
          },
        },
      };
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setDraft((prev) => {
      const next = prev.images.filter((i) => i.id !== id);
      return {
        ...prev,
        images: next,
        application: {
          ...prev.application,
          uploadLabelsStep: {
            ...prev.application.uploadLabelsStep,
            labelImages: next.map((image) => ({
              ...image,
              base64: undefined,
            })),
          },
        },
      };
    });
  }, []);

  const setImageType = useCallback(
    (id: string, labelImageType: LabelImagePayload["labelImageType"]) => {
      setDraft((prev) => {
        const next = prev.images.map((i) =>
          i.id === id ? { ...i, labelImageType } : i,
        );
        return {
          ...prev,
          images: next,
          application: {
            ...prev.application,
            uploadLabelsStep: {
              ...prev.application.uploadLabelsStep,
              labelImages: next.map((image) => ({
                ...image,
                base64: undefined,
              })),
            },
          },
        };
      });
    },
    [],
  );

  const loadSample = useCallback((sample: SampleScenario) => {
    setDraft({
      clientName: sample.clientName ?? "",
      applicantName: sample.applicantName ?? "",
      productName: sample.productName ?? "",
      application: sample.application,
      images: sample.images,
      mockScenario: sample.mockScenario,
    });
    setReport(null);
    setExtractedLabel(null);
    setError(null);
    setRecordId(null);
  }, []);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setReport(null);
    setExtractedLabel(null);
    setError(null);
    setRecordId(null);
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    setExtractedLabel(null);
    const fetchStart = performance.now();
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: draft.clientName || undefined,
          applicantName: draft.applicantName || undefined,
          productName: draft.productName || undefined,
          application: draft.application,
          images: draft.images,
          mockScenario: draft.mockScenario,
        }),
      });
      const json = await res.json();
      const fetchTotalMs = Math.round(performance.now() - fetchStart);
      if (!res.ok) {
        setError(json.error ?? "Verification failed.");
        return;
      }
      setReport(json.report);
      setExtractedLabel(json.extractedLabel);
      setRecordId(json.recordId ?? null);

      if (json.timings && typeof window !== "undefined") {
        const t = json.timings;
        const networkMs = Math.max(0, fetchTotalMs - t.totalServerMs);
        // eslint-disable-next-line no-console
        console.groupCollapsed(
          `[verify] ${fetchTotalMs}ms total — ${t.imageSizeKB} KB → ${t.resizedSizeKB} KB after resize`,
        );
        // eslint-disable-next-line no-console
        console.table({
          "form parse (server)": { ms: t.formParseMs },
          "image decode (server)": { ms: t.imageDecodeMs },
          "image preprocess (server)": { ms: t.imagePreprocessMs },
          "extraction + validation (server)": { ms: t.geminiExtractionMs },
          "server total": { ms: t.totalServerMs },
          "network (client ↔ server)": { ms: networkMs },
          "fetch total (client)": { ms: fetchTotalMs },
        });
        // eslint-disable-next-line no-console
        console.groupEnd();
      }

      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }, [draft, router]);

  const wineFields = draft.application.colaInformationStep.wine;
  const dsFields = draft.application.colaInformationStep.distilledSpirits;
  const mbFields = draft.application.colaInformationStep.maltBeverage;

  const showStateOfSale =
    draft.application.applicationTypeStep.applicationType ===
    "certificate_of_exemption";
  const showPriorTtbId = draft.application.applicationTypeStep.isResubmission;

  const canSubmit = useMemo(() => {
    return (
      !!draft.application.colaInformationStep.brandName.trim() &&
      draft.images.length > 0 &&
      !busy
    );
  }, [draft, busy]);

  return (
    <div className="space-y-6">
      <SamplesPanel samples={samples} onLoad={loadSample} onReset={reset} />

      <Section title="Reviewer context (optional)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField
            label="Client name"
            value={draft.clientName}
            onChange={(clientName) => setDraft((p) => ({ ...p, clientName }))}
          />
          <TextField
            label="Applicant name"
            value={draft.applicantName}
            onChange={(applicantName) =>
              setDraft((p) => ({ ...p, applicantName }))
            }
          />
          <TextField
            label="Product name"
            value={draft.productName}
            onChange={(productName) =>
              setDraft((p) => ({ ...p, productName }))
            }
          />
        </div>
      </Section>

      <Section title="1. Application type">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField
            label="Product type"
            value={productType}
            options={PRODUCT_TYPE_OPTIONS.map((o) => o)}
            onChange={(value) => updateAppType({ productType: value as ProductType })}
          />
          <SelectField
            label="Source of product"
            value={draft.application.applicationTypeStep.sourceOfProduct}
            options={[
              { value: "domestic", label: "Domestic" },
              { value: "imported", label: "Imported" },
            ]}
            onChange={(value) =>
              updateAppType({ sourceOfProduct: value as "domestic" | "imported" })
            }
          />
          <SelectField
            label="Application type"
            value={draft.application.applicationTypeStep.applicationType}
            options={[
              {
                value: "certificate_of_label_approval",
                label: "Certificate of Label Approval",
              },
              {
                value: "certificate_of_exemption",
                label: "Certificate of Exemption",
              },
            ]}
            onChange={(value) =>
              updateAppType({
                applicationType:
                  value as "certificate_of_label_approval" | "certificate_of_exemption",
              })
            }
          />
          {showStateOfSale && (
            <TextField
              label="State of sale (exemption)"
              value={
                draft.application.applicationTypeStep.stateOfSaleForExemption ??
                ""
              }
              onChange={(stateOfSaleForExemption) =>
                updateAppType({ stateOfSaleForExemption })
              }
            />
          )}
          <CheckboxField
            label="This is a resubmission"
            checked={draft.application.applicationTypeStep.isResubmission}
            onChange={(isResubmission) => updateAppType({ isResubmission })}
          />
          {showPriorTtbId && (
            <TextField
              label="Prior TTB ID"
              value={draft.application.applicationTypeStep.priorTtbId ?? ""}
              onChange={(priorTtbId) => updateAppType({ priorTtbId })}
            />
          )}
        </div>
      </Section>

      <Section title="2. COLA information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label="Brand name *"
            value={draft.application.colaInformationStep.brandName}
            onChange={(brandName) => updateInfo({ brandName })}
          />
          <TextField
            label="DBA / trade name"
            value={draft.application.colaInformationStep.dbaTradeName ?? ""}
            onChange={(dbaTradeName) => updateInfo({ dbaTradeName })}
          />
          <TextField
            label="Fanciful name"
            value={draft.application.colaInformationStep.fancifulName ?? ""}
            onChange={(fancifulName) => updateInfo({ fancifulName })}
          />
          <TextField
            label="Serial number"
            value={draft.application.colaInformationStep.serialNumber ?? ""}
            onChange={(serialNumber) => updateInfo({ serialNumber })}
          />
          <TextField
            label="Formula ID"
            value={draft.application.colaInformationStep.formulaId ?? ""}
            onChange={(formulaId) => updateInfo({ formulaId })}
          />
          <TextField
            label="Net contents (comma-separated)"
            placeholder="750 mL, 1.5 L"
            value={(draft.application.colaInformationStep.netContents ?? []).join(", ")}
            onChange={(value) =>
              updateInfo({
                netContents: value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          <TextField
            label="Alcohol content"
            placeholder="13.5% Alc./Vol."
            value={draft.application.colaInformationStep.alcoholContent ?? ""}
            onChange={(alcoholContent) => updateInfo({ alcoholContent })}
          />
          <TextField
            label="Country of origin"
            value={draft.application.colaInformationStep.countryOfOrigin ?? ""}
            onChange={(countryOfOrigin) => updateInfo({ countryOfOrigin })}
          />
          <TextField
            label="Name & address"
            value={draft.application.colaInformationStep.nameAndAddress ?? ""}
            onChange={(nameAndAddress) => updateInfo({ nameAndAddress })}
          />
        </div>

        <div className="mt-4">
          <TextAreaField
            label="Notes to specialist"
            value={
              draft.application.colaInformationStep.notesToSpecialist ?? ""
            }
            onChange={(notesToSpecialist) =>
              updateInfo({ notesToSpecialist })
            }
          />
        </div>

        {(productType === "wine" || productType === "domestic_sake") && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium mb-3">
              {productType === "wine"
                ? "Wine-specific"
                : "Sake (wine-like optional)"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField
                label="Vintage year"
                value={
                  wineFields?.vintageYear !== undefined
                    ? String(wineFields.vintageYear)
                    : ""
                }
                onChange={(vintageYear) =>
                  updateInfo({
                    wine: {
                      ...wineFields,
                      vintageYear: vintageYear || undefined,
                    },
                  })
                }
              />
              <TextField
                label="Appellation"
                value={wineFields?.appellation ?? ""}
                onChange={(appellation) =>
                  updateInfo({ wine: { ...wineFields, appellation } })
                }
              />
              <TextField
                label="Grape varietals (comma-separated)"
                value={(wineFields?.grapeVarietals ?? []).join(", ")}
                onChange={(value) =>
                  updateInfo({
                    wine: {
                      ...wineFields,
                      grapeVarietals: value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
              <CheckboxField
                label="Sulfite declaration expected"
                checked={wineFields?.sulfiteDeclarationExpected ?? false}
                onChange={(sulfiteDeclarationExpected) =>
                  updateInfo({
                    wine: {
                      ...wineFields,
                      sulfiteDeclarationExpected,
                    },
                  })
                }
              />
            </div>
          </div>
        )}

        {productType === "distilled_spirits" && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium mb-3">
              Distilled-spirits specific
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField
                label="Age statement"
                value={dsFields?.ageStatement ?? ""}
                onChange={(ageStatement) =>
                  updateInfo({
                    distilledSpirits: {
                      ...dsFields,
                      ageStatement,
                    },
                  })
                }
              />
              <TextField
                label="State of distillation"
                value={dsFields?.stateOfDistillation ?? ""}
                onChange={(stateOfDistillation) =>
                  updateInfo({
                    distilledSpirits: {
                      ...dsFields,
                      stateOfDistillation,
                    },
                  })
                }
              />
            </div>
          </div>
        )}

        {productType === "malt_beverage" && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium mb-3">Malt beverage specific</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckboxField
                label="Contains FD&C Yellow #5"
                checked={mbFields?.containsFdCYellow5 ?? false}
                onChange={(containsFdCYellow5) =>
                  updateInfo({
                    maltBeverage: { ...mbFields, containsFdCYellow5 },
                  })
                }
              />
              <CheckboxField
                label="Contains aspartame"
                checked={mbFields?.containsAspartame ?? false}
                onChange={(containsAspartame) =>
                  updateInfo({
                    maltBeverage: { ...mbFields, containsAspartame },
                  })
                }
              />
              <CheckboxField
                label="Contains cochineal or carmine"
                checked={mbFields?.containsCochinealOrCarmine ?? false}
                onChange={(containsCochinealOrCarmine) =>
                  updateInfo({
                    maltBeverage: { ...mbFields, containsCochinealOrCarmine },
                  })
                }
              />
              <CheckboxField
                label="Contains sulfites"
                checked={mbFields?.containsSulfites ?? false}
                onChange={(containsSulfites) =>
                  updateInfo({
                    maltBeverage: { ...mbFields, containsSulfites },
                  })
                }
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="3. Upload labels">
        <p className="text-xs text-slate-500 mb-3">
          Drop in up to 10 label images (front, back, neck, etc.). The first
          uploaded image is tagged as the brand label by default. Official
          COLAs Online upload requirements may differ — this is a demo.
        </p>
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => void handleFiles(e.target.files)}
            className="block mx-auto text-sm"
          />
        </div>

        {draft.images.length > 0 && (
          <ul className="mt-4 space-y-2">
            {draft.images.map((image) => (
              <li
                key={image.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                <span className="text-sm flex-1 truncate">
                  {image.fileName}
                </span>
                <span className="text-xs text-slate-500">
                  {Math.ceil(image.size / 1024)} KB
                </span>
                <select
                  className="text-xs border border-slate-200 rounded px-2 py-1"
                  value={image.labelImageType}
                  onChange={(e) =>
                    setImageType(
                      image.id,
                      e.target.value as LabelImagePayload["labelImageType"],
                    )
                  }
                >
                  {LABEL_IMAGE_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-xs text-rose-600 hover:underline"
                  onClick={() => removeImage(image.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextAreaField
            label="Foreign-text translation (optional)"
            value={
              draft.application.uploadLabelsStep.foreignTextTranslation ?? ""
            }
            onChange={(foreignTextTranslation) =>
              updateUpload({ foreignTextTranslation })
            }
          />
          <TextAreaField
            label="Special wording / designs (optional)"
            value={
              draft.application.uploadLabelsStep.specialWordingOrDesigns ?? ""
            }
            onChange={(specialWordingOrDesigns) =>
              updateUpload({ specialWordingOrDesigns })
            }
          />
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Run verification"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-sm text-slate-600 hover:underline"
        >
          Reset
        </button>
        {draft.mockScenario && (
          <span className="text-xs text-slate-500 italic">
            Loaded sample scenario: {draft.mockScenario}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {recordId && (
            <p className="text-xs text-slate-500">
              Saved as record{" "}
              <span className="font-mono">{recordId}</span>.
            </p>
          )}
          <VerificationResults
            report={report}
            extractedLabel={extractedLabel ?? undefined}
          />
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.substring(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-base font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-slate-700 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100 outline-none"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-slate-700 mb-1">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100 outline-none"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-slate-700 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      {label}
    </label>
  );
}

function SamplesPanel({
  samples,
  onLoad,
  onReset,
}: {
  samples: SampleScenario[];
  onLoad: (s: SampleScenario) => void;
  onReset: () => void;
}) {
  if (samples.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-slate-50 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">Try a sample scenario</h2>
          <p className="text-xs text-slate-500">
            Pre-fills the form with realistic data so you can see varied
            outcomes without typing.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-slate-600 hover:underline"
        >
          Clear form
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onLoad(s)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs hover:border-[var(--accent)]"
            title={s.description}
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
