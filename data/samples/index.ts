import {
  fromRawSample,
  type RawSampleScenarioFile,
  type SampleScenario,
} from "@/components/verification/sample-scenarios";

import wineValid from "./wine-valid.json";
import wineAbvWarning from "./wine-abv-warning.json";
import spiritsValid from "./spirits-valid.json";
import spiritsMissingWarning from "./spirits-missing-warning.json";
import maltValid from "./malt-valid.json";
import importedMissingOrigin from "./imported-missing-origin.json";

const RAW_SAMPLES: RawSampleScenarioFile[] = [
  wineValid as RawSampleScenarioFile,
  wineAbvWarning as RawSampleScenarioFile,
  spiritsValid as RawSampleScenarioFile,
  spiritsMissingWarning as RawSampleScenarioFile,
  maltValid as RawSampleScenarioFile,
  importedMissingOrigin as RawSampleScenarioFile,
];

export function getSampleScenarios(): SampleScenario[] {
  return RAW_SAMPLES.map(fromRawSample);
}
