"use client";

import type { Run } from "@/lib/app-types";

// What the run is doing now, in plain words.
const STAGE_TEXT: Partial<Record<Run["status"], string>> = {
  planning: "Planning the missions. The planner reads the diff and qa.md.",
  running: "Running the simulated users on Pine computers.",
  reporting: "Checking the failures and writing the review.",
};

// A small orbit: a dot circles a ring while the run works.
// Reduced motion keeps the ring still.
function Orbit() {
  return (
    <span className="relative inline-flex size-6 shrink-0" aria-hidden>
      <span className="absolute inset-0 rounded-full border-2 border-accent/25" />
      <span className="absolute inset-0 animate-[spin_1.4s_linear_infinite] motion-reduce:animate-none">
        <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-accent" />
      </span>
      <span className="absolute inset-[7px] animate-pulse rounded-full bg-accent/30 motion-reduce:animate-none" />
    </span>
  );
}

export function Activity({
  status,
  running,
  total,
  seconds,
}: {
  status: Run["status"];
  running: number;
  total: number;
  seconds: number | null;
}) {
  const text = STAGE_TEXT[status];
  if (!text) return null;
  const detail =
    status === "running" && total > 0 ? ` ${running} of ${total} users are active now.` : "";
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-fg"
    >
      <Orbit />
      <span className="min-w-0">
        <span className="font-semibold">{text}</span>
        <span className="text-muted">{detail}</span>
      </span>
      {seconds !== null && (
        <span className="ml-auto shrink-0 tabular-nums text-muted">{seconds} s</span>
      )}
    </div>
  );
}
