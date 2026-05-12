import { AppShell } from "@/components/layout/AppShell";
import { NewVerificationFlow } from "@/components/verification/NewVerificationFlow";
import { getSampleScenarios } from "@/data/samples";

export default function NewVerificationPage() {
  const samples = getSampleScenarios();
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">New verification</h1>
        <p className="text-sm text-slate-600">
          Capture COLA-style application data, upload label images, and run an
          AI-assisted field-level verification against TTB-style rules.
        </p>
      </div>
      <NewVerificationFlow samples={samples} />
    </AppShell>
  );
}
