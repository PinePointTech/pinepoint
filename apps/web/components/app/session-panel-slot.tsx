"use client";

// Placeholder for the session panel. The real panel lives in
// components/session-panel and replaces this slot after it merges.
import { X } from "lucide-react";
import type { StatusResponse } from "@/lib/app-types";

export type SessionPanelSlotProps = {
  runId: string;
  missionId: string | null;
  findingId: string | null;
  onClose: () => void;
  // Optional. The placeholder reads the finding from this data.
  status?: StatusResponse | null;
};

export function SessionPanelSlot({
  runId,
  missionId,
  findingId,
  onClose,
  status,
}: SessionPanelSlotProps) {
  const finding = status?.findings.find((f) => f.id === findingId);
  const mission =
    status?.missions.find((m) => m.id === missionId) ??
    status?.missions.find((m) => finding?.mission_ids?.includes(m.id));

  return (
    <aside
      data-testid="session-panel"
      data-run-id={runId}
      data-finding-id={findingId ?? ""}
      className="rounded-xl border border-stone-300 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Session
          </p>
          <h2 className="text-lg font-semibold text-pine-900 dark:text-pine-50">
            {finding?.title ?? mission?.persona ?? "Mission"}
          </h2>
          {mission && (
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {mission.lens} / {mission.persona}: {mission.goal}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the session panel"
          className="rounded-md p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {finding ? (
        <div className="mt-4 space-y-3 text-sm">
          {finding.steps && finding.steps.length > 0 && (
            <div>
              <h3 className="font-medium">Steps</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {finding.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-pine-50 p-3 dark:bg-pine-900/40">
              <h3 className="font-medium">Expected</h3>
              <p className="mt-1 font-mono">{finding.expected ?? "-"}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
              <h3 className="font-medium">Saw</h3>
              <p className="mt-1 font-mono">{finding.saw ?? "-"}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-300">
          This mission has no finding. The live session view comes soon.
        </p>
      )}
    </aside>
  );
}
