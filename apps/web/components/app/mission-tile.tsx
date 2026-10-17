"use client";

import { Hand, ImageOff, Loader2 } from "lucide-react";
import type { Finding, Mission } from "@/lib/app-types";
import { TILE_LABEL, tileState, type TileState } from "./tile-state";

const FRAME: Record<TileState, string> = {
  queued:
    "border-2 border-stone-300 bg-transparent dark:border-stone-600",
  running:
    "border-2 border-stone-300 bg-stone-100 dark:border-stone-600 dark:bg-stone-800",
  passed:
    "border-2 border-green-500 bg-white dark:border-green-500 dark:bg-stone-900",
  bug: "border-2 border-red-300 bg-red-50/60 dark:border-red-400/70 dark:bg-red-950/30",
  possible:
    "border-2 border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900",
  failed:
    "border-2 border-red-300 bg-white dark:border-red-400/70 dark:bg-stone-900",
  needs_you:
    "border-2 border-yellow-400 bg-yellow-100 dark:border-yellow-500 dark:bg-yellow-900/40",
  blocked:
    "border-2 border-stone-300 bg-stone-200 dark:border-stone-600 dark:bg-stone-800",
};

const LABEL: Record<TileState, string> = {
  queued: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  running: "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
  passed: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  bug: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  possible: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  needs_you: "bg-yellow-300 text-yellow-950 dark:bg-yellow-500 dark:text-yellow-950",
  blocked: "bg-stone-300 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
};

export function MissionTile({
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
  return (
    <div
      data-testid="mission-tile"
      data-state={state}
      data-mission-id={mission.id}
      className={`flex flex-col overflow-hidden rounded-xl ${FRAME[state]} ${
        selected ? "ring-2 ring-pine-600 ring-offset-2 dark:ring-offset-stone-950" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col text-left"
        aria-label={`Open ${mission.persona ?? "mission"}: ${TILE_LABEL[state]}`}
      >
        <div className="relative aspect-video w-full bg-stone-200/70 dark:bg-stone-800/70">
          {mission.screenshot_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mission.screenshot_url}
              alt={`Latest screenshot for ${mission.persona ?? "mission"}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-400 dark:text-stone-500">
              {state === "running" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <ImageOff className="h-6 w-6" />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <span
            className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${LABEL[state]}`}
          >
            {TILE_LABEL[state]}
          </span>
          <span className="text-sm font-medium">{mission.persona}</span>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {mission.lens}
          </span>
        </div>
      </button>
      {state === "needs_you" && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onOpen}
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-yellow-400 px-3 py-1.5 text-sm font-semibold text-yellow-950 hover:bg-yellow-300"
          >
            <Hand className="h-4 w-4" />
            Take control
          </button>
        </div>
      )}
    </div>
  );
}
