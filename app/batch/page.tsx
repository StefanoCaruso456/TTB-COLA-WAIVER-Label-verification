import { AppShell } from "@/components/layout/AppShell";
import { BatchRunner } from "@/components/verification/BatchRunner";
import { getSampleScenarios } from "@/data/samples";

export default function BatchPage() {
  const samples = getSampleScenarios();
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Batch verification</h1>
        <p className="text-sm text-slate-600">
          Run multiple label verifications in one pass. Useful for the
          peak-season importer workflow described in the project brief — agents
          can submit a batch of applications instead of working one at a time.
        </p>
      </div>
      <BatchRunner samples={samples} />
    </AppShell>
  );
}
