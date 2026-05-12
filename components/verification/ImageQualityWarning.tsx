import type { ImageQuality } from "@/types/extracted-label";

export function ImageQualityWarning({ quality }: { quality?: ImageQuality }) {
  if (!quality) return null;
  const risks = [
    quality.blurRisk,
    quality.glareRisk,
    quality.lowLightRisk,
    quality.orientationRisk,
  ];
  const hasIssue =
    quality.overallReadability === "poor" ||
    risks.some((r) => r === "high") ||
    risks.filter((r) => r === "medium").length >= 2;

  if (!hasIssue) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-medium">Image quality may affect extraction.</div>
      <ul className="mt-1 text-xs list-disc list-inside space-y-0.5">
        {quality.overallReadability && (
          <li>Overall readability: {quality.overallReadability}</li>
        )}
        {quality.blurRisk && <li>Blur risk: {quality.blurRisk}</li>}
        {quality.glareRisk && <li>Glare risk: {quality.glareRisk}</li>}
        {quality.lowLightRisk && <li>Low-light risk: {quality.lowLightRisk}</li>}
        {quality.orientationRisk && (
          <li>Orientation risk: {quality.orientationRisk}</li>
        )}
        {quality.notes && <li>{quality.notes}</li>}
      </ul>
    </div>
  );
}
