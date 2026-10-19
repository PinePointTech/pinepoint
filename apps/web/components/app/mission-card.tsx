"use client";

import { useId, useState } from "react";
import { Hand, Hourglass, ImageOff } from "lucide-react";
import type { Finding, Mission } from "@/lib/app-types";
import { Spinner } from "./progress";
import { TILE_LABEL, detailLine, tileState, type TileContext, type TileState } from "./tile-state";

const AMBER_FRAME = "border-amber-200 dark:border-amber-800/60";
const AMBER_PILL =
  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/40 dark:text-amber-200";
const MUTED_PILL = "border-border bg-surface-2 text-muted";

// Thin status border on the card. Soft pastels, no full fills. Only a Bug uses the danger color.
const FRAME: Record<TileState, string> = {
  queued: "border-border",
  waiting: "border-border",
  starting: "border-border",
  testing: "border-border",
  needs_you: "border-yellow-300 dark:border-yellow-700/60",
  could_not_run: "border-border",
  blocked: "border-border",
  timed_out: "border-border",
  bug: "border-danger/50",
  old_bug: "border-border",
  possible: AMBER_FRAME,
  rechecking: AMBER_FRAME,
  not_confirmed: "border-border",
  check_failed: AMBER_FRAME,
  passed: "border-accent/35",
};

// Small status pill: soft background, thin border, readable text.
const PILL: Record<TileState, string> = {
  queued: MUTED_PILL,
  waiting: MUTED_PILL,
  starting: "border-border bg-surface-2 text-fg",
  testing: "border-border bg-surface-2 text-fg",
  needs_you:
    "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-900/40 dark:text-yellow-100",
  could_not_run: MUTED_PILL,
  blocked: MUTED_PILL,
  timed_out: MUTED_PILL,
  bug: "border-danger/30 bg-danger-soft text-danger",
  old_bug: MUTED_PILL,
  possible: AMBER_PILL,
  rechecking: AMBER_PILL,
  not_confirmed: MUTED_PILL,
  check_failed: AMBER_PILL,
  passed: "border-accent/30 bg-accent-soft text-accent",
};

const BUSY: TileState[] = ["starting", "testing", "rechecking"];
const WAITING: TileState[] = ["queued", "waiting"];

// The mission's picture, or an icon for its state. A picture that does not load shows the icon.
function Thumb({ url, state }: { url: string | null; state: TileState }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const busy = BUSY.includes(state);
  const picture = url && brokenUrl !== url ? url : null;

  return (
    <span className="relative block aspect-video w-full overflow-clip rounded-2xl border border-border bg-surface-2">
      {picture ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picture}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBrokenUrl(picture)}
            className="h-full w-full object-cover object-top"
          />
          {busy && (
            <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full border border-border bg-surface/90 text-fg">
              <Spinner className="size-4" />
            </span>
          )}
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted">
          {busy ? (
            <Spinner className="size-6" />
          ) : WAITING.includes(state) ? (
            <Hourglass aria-hidden className="size-6" strokeWidth={1.75} />
          ) : (
            <ImageOff aria-hidden className="size-6" strokeWidth={1.75} />
          )}
        </span>
      )}
    </span>
  );
}

export function MissionCard({
  mission,
  finding,
  context,
  selected,
  onOpen,
}: {
  mission: Mission;
  finding?: Finding;
  context?: TileContext;
  selected: boolean;
  onOpen: () => void;
}) {
  const state = tileState(mission, finding, context);
  const label = TILE_LABEL[state];
  const persona = mission.persona?.trim() || "User";
  const detail = detailLine(state, mission, finding, context?.missions);
  // The button name stays short. The goal and the detail line are its description.
  const id = useId();
  const goalId = `${id}-goal`;
  const detailId = `${id}-detail`;
  const describedBy = [mission.goal ? goalId : null, detail ? detailId : null].filter(Boolean).join(" ");

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
        aria-describedby={describedBy || undefined}
        aria-current={selected ? "true" : undefined}
        className="flex flex-1 flex-col gap-3 rounded-2xl text-left"
      >
        <Thumb url={mission.screenshot_url} state={state} />

        <span className="flex flex-col gap-1.5 px-1 pb-1">
          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PILL[state]}`}
          >
            {state === "rechecking" && <Spinner className="size-3" />}
            {label}
          </span>
          <span className="font-semibold text-fg">{persona}</span>
          {mission.goal && (
            <span id={goalId} className="line-clamp-3 text-sm text-muted [line-clamp:3]">
              {mission.goal}
            </span>
          )}
          {detail && (
            <span id={detailId} className="text-xs leading-relaxed break-words text-fg/80">
              {detail}
            </span>
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
