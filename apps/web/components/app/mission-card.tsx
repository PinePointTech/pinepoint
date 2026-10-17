"use client";

import { Hand, ImageOff, Loader2 } from "lucide-react";
import type { Finding, Mission } from "@/lib/app-types";
import { TILE_LABEL, tileState, type TileState } from "./tile-state";

// Thin status border on the card. Soft pastels, no full fills.
const FRAME: Record<TileState, string> = {
  queued: "border-border",
  running: "border-border",
  passed: "border-accent/35",
  bug: "border-danger/50",
  possible: "border-amber-200 dark:border-amber-800/60",
  failed: "border-danger/25",
  needs_you: "border-yellow-300 dark:border-yellow-700/60",
  blocked: "border-border",
};

// Small status pill: soft background, thin border, readable text.
const PILL: Record<TileState, string> = {
  queued: "border-border bg-surface-2 text-muted",
  running: "border-border bg-surface-2 text-fg",
  passed: "border-accent/30 bg-accent-soft text-accent",
  bug: "border-danger/30 bg-danger-soft text-danger",
  possible:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/40 dark:text-amber-200",
  failed: "border-danger/25 bg-surface-2 text-danger",
  needs_you:
    "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-900/40 dark:text-yellow-100",
  blocked: "border-border bg-surface-2 text-muted",
};

// Ends a fragment with a period, so "Expected X. Saw Y." reads as two sentences.
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function findingLine(finding: Finding | undefined): string | null {
  if (!finding) return null;
  const parts: string[] = [];
  if (finding.expected?.trim()) parts.push(`Expected ${sentence(finding.expected)}`);
  if (finding.saw?.trim()) parts.push(`Saw ${sentence(finding.saw)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function MissionCard({
  mission,
  finding,
  selected,
  onOpen,
}: {
  mission: Mission;
  finding?: Finding;
  selected: boolean;
  onOpen: () => void;
}) {
  const state = tileState(mission, finding);
  const label = TILE_LABEL[state];
  const persona = mission.persona?.trim() || "User";
  const detail =
    state === "bug" || state === "possible" ? findingLine(finding) : null;

  return (
    <div
      data-testid="mission-card"
      data-state={state}
      data-mission-id={mission.id}
      className={`flex flex-col rounded-[20px] border bg-surface p-3 motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 ${FRAME[state]} ${
        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${persona}: ${label}`}
        aria-current={selected ? "true" : undefined}
        className="flex flex-1 flex-col gap-3 rounded-2xl text-left"
      >
        <span className="relative block aspect-video w-full overflow-clip rounded-2xl border border-border bg-surface-2">
          {mission.screenshot_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mission.screenshot_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted">
              {state === "running" ? (
                <Loader2 aria-hidden className="h-6 w-6 animate-spin" />
              ) : (
                <ImageOff aria-hidden className="h-6 w-6" />
              )}
            </span>
          )}
        </span>

        <span className="flex flex-col gap-1.5 px-1 pb-1">
          <span
            className={`w-fit rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PILL[state]}`}
          >
            {label}
          </span>
          <span className="font-semibold text-fg">{persona}</span>
          {mission.goal && (
            <span className="line-clamp-3 text-sm text-muted [line-clamp:3]">
              {mission.goal}
            </span>
          )}
          {detail && (
            <span className="text-xs leading-relaxed text-fg/80">{detail}</span>
          )}
        </span>
      </button>

      {state === "needs_you" && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Take control: ${persona}`}
          className="mx-1 mt-2 mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-900 transition-colors hover:bg-yellow-100 dark:border-yellow-700/60 dark:bg-yellow-900/40 dark:text-yellow-100 dark:hover:bg-yellow-900/60"
        >
          <Hand aria-hidden className="h-3.5 w-3.5" />
          Take control
        </button>
      )}
    </div>
  );
}
