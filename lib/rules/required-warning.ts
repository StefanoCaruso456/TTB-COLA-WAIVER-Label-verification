/**
 * Required text fragments for the U.S. government health warning on
 * alcoholic beverage labels (27 CFR 16). We do not store the warning
 * verbatim here — we look for canonical fragments that must be present.
 */
export const GOVERNMENT_WARNING_PREFIX = "GOVERNMENT WARNING";

export const GOVERNMENT_WARNING_REQUIRED_FRAGMENTS: readonly string[] = [
  "according to the surgeon general",
  "women should not drink alcoholic beverages",
  "during pregnancy",
  "birth defects",
  "consumption of alcoholic beverages",
  "ability to drive a car or operate machinery",
  "health problems",
];
