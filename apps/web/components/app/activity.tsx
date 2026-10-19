"use client";

import { TERMINAL_RUN_STATUSES, type Mission, type Run } from "@/lib/app-types";
import { DeterminateBar, IndeterminateBar, formatElapsed, secondsSince, secondsUntil } from "./progress";

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

// A user that waits for a person is not done: its computer stays on until someone helps.
const ended = (m: Mission) => m.status !== "queued" && m.status !== "running" && m.status !== "needs_you";
const starting = (m: Mission) => m.status === "running" && m.has_computer === false;
const testing = (m: Mission) => m.status === "running" && m.has_computer !== false;

function users(n: number): string {
  return n === 1 ? "1 user" : `${n} users`;
}

// What the run does now, in plain words, from the run and mission rows.
export function stageOf(run: Run, missions: Mission[]): { text: string; detail: string | null } | null {
  switch (run.status) {
    case "planning":
      return { text: "Reading the PR and planning 10 missions with Claude.", detail: null };
    case "reporting":
      return { text: "Building the findings and writing the review.", detail: null };
    case "running": {
      const lines: string[] = [];
      const needYou = missions.filter((m) => m.status === "needs_you").length;
      if (needYou > 0) lines.push(`${users(needYou)} ${needYou === 1 ? "needs" : "need"} you. Open the yellow card.`);
      // Of the missions that have a slot now, how many have their Computer.
      const claimed = missions.filter((m) => m.status === "running");
      const startingNow = claimed.filter(starting).length;
      if (startingNow > 0) {
        lines.push(`Starting Pine computers: ${claimed.length - startingNow} of ${claimed.length} ready.`);
      }
      const active = missions.filter(testing);
      if (active.length > 0) {
        const rechecks = active.filter((m) => m.kind !== "preview").length;
        lines.push(
          `${users(active.length)} ${active.length === 1 ? "is" : "are"} testing now.` +
            (rechecks > 0 ? ` ${rechecks} of them re-check a failure.` : ""),
        );
      }
      const queued = missions.filter((m) => m.status === "queued").length;
      if (lines.length === 0) {
        lines.push(
          queued > 0
            ? `${users(queued)} ${queued === 1 ? "waits" : "wait"} for a free computer.`
            : "Running the simulated users on Pine computers.",
        );
      } else if (queued > 0) {
        lines.push(`${queued} more ${queued === 1 ? "waits" : "wait"} for a free computer.`);
      }
      return { text: lines[0]!, detail: lines.slice(1).join(" ") || null };
    }
    default:
      return null;
  }
}

// The progress line, the bar and the stage of the open run. The bar is indeterminate while
// Claude plans. After that it counts every mission, the previews and their re-checks.
export function RunProgress({
  run,
  missions,
  statusLabel,
  now,
}: {
  run: Run;
  missions: Mission[];
  statusLabel: string;
  now: number;
}) {
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const previews = missions.filter((m) => m.kind === "preview");
  const previewsDone = previews.filter(ended).length;
  const rechecking = missions.filter((m) => m.kind !== "preview" && !ended(m)).length;
  const allDone = missions.filter(ended).length;
  const indeterminate = run.status === "planning" || (!terminal && missions.length === 0);

  const count =
    previews.length > 0
      ? `${previewsDone} of ${previews.length} users done${rechecking > 0 ? `, re-checking ${rechecking}` : ""}`
      : run.status === "planning"
        ? "Writing the missions"
        : null;

  const stage = terminal ? null : stageOf(run, missions);
  const elapsed = terminal ? null : secondsSince(run.started_at, now);
  const nextStart = run.status === "running" ? secondsUntil(run.next_start_at, now) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">{statusLabel}</span>
          {count && <span className="text-right text-muted tabular-nums">{count}</span>}
        </div>
        {indeterminate ? (
          <IndeterminateBar label="Planning the missions" />
        ) : missions.length > 0 ? (
          <DeterminateBar value={allDone} max={missions.length} label="Missions done" />
        ) : null}
      </div>

      {stage && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-fg">
          <Orbit />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Only the stage is live. The clock below would repeat every second. */}
            <p role="status" aria-live="polite" className="min-w-0">
              <span className="font-semibold">{stage.text}</span>
              {stage.detail && <span className="text-muted"> {stage.detail}</span>}
            </p>
            {nextStart !== null && (
              <p className="text-muted tabular-nums">
                Pine limits how many computers start each minute. Next start in {nextStart}s.
              </p>
            )}
          </div>
          {elapsed !== null && (
            <span className="ml-auto shrink-0 pt-0.5 tabular-nums text-muted">
              <span aria-hidden>{formatElapsed(elapsed)}</span>
              <span className="sr-only">{elapsed} seconds so far</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Shows from the click on Run until the new run's first status arrives. The POST reads the PR
// and answers in a few seconds; planning goes on after that. It is an h2 when the page already
// has the h1 of an open run.
export function StartingRun({
  title,
  stage,
  seconds,
  level = 1,
}: {
  title: string;
  stage: string;
  seconds: number;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section
      aria-labelledby="starting-run"
      className="flex max-w-xl flex-col gap-4 rounded-[20px] border border-accent/25 bg-surface p-5"
      data-testid="starting-run"
    >
      <div className="flex items-start gap-3">
        <Orbit />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Heading id="starting-run" className="text-xl font-extrabold tracking-tight break-words">
            {title}
          </Heading>
          <p role="status" aria-live="polite" className="text-sm text-fg">
            {stage}
          </p>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted">
          <span aria-hidden>{seconds} s</span>
          <span className="sr-only">{seconds} seconds so far</span>
        </span>
      </div>
      <IndeterminateBar label="Starting the run" />
      <p className="text-sm text-muted">This takes a few seconds. Then the run shows here.</p>
    </section>
  );
}
