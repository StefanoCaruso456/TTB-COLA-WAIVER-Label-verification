"use client";

import { useState } from "react";

import { BatchVerificationFlow } from "./BatchVerificationFlow";
import { NewVerificationFlow } from "./NewVerificationFlow";
import type { SampleScenario } from "./sample-scenarios";

type Mode = "standard" | "batch";

interface Props {
  samples: SampleScenario[];
}

export function VerificationModeSwitcher({ samples }: Props) {
  const [mode, setMode] = useState<Mode>("standard");

  return (
    <div>
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <ModeButton
          active={mode === "standard"}
          onClick={() => setMode("standard")}
          label="Standard"
          sub="One label, one bottle"
        />
        <ModeButton
          active={mode === "batch"}
          onClick={() => setMode("batch")}
          label="Batch"
          sub="Up to 200 labels, one per file"
        />
      </div>

      {mode === "standard" ? (
        <NewVerificationFlow samples={samples} />
      ) : (
        <BatchVerificationFlow />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start rounded-md px-4 py-2 text-left transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span
        className={`text-xs ${active ? "text-indigo-100" : "text-slate-500"}`}
      >
        {sub}
      </span>
    </button>
  );
}
