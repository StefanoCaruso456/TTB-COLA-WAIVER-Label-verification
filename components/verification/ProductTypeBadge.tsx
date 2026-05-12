import type { ProductType } from "@/types/cola";

const LABELS: Record<ProductType, string> = {
  wine: "Wine",
  domestic_sake: "Domestic Sake",
  distilled_spirits: "Distilled Spirits",
  malt_beverage: "Malt Beverage",
};

const STYLES: Record<ProductType, string> = {
  wine: "bg-rose-50 text-rose-800 border-rose-200",
  domestic_sake: "bg-sky-50 text-sky-800 border-sky-200",
  distilled_spirits: "bg-amber-50 text-amber-800 border-amber-200",
  malt_beverage: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function ProductTypeBadge({ productType }: { productType: ProductType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[productType]}`}
    >
      {LABELS[productType]}
    </span>
  );
}
