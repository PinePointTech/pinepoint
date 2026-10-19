"use client";

import { useState } from "react";
import { IndeterminateBar, Spinner, formatElapsed, secondsUntil, useNow } from "@/components/app/progress";

// The screen area while a computer starts or the screen connects: a spinner, the stage, the
// time so far and an indeterminate bar. The last known picture shows dimmed underneath.
// It never shows failure text: a Computer that is still starting is not a failure.
export function LoadingScreen({
  stage,
  detail = null,
  since,
  nextStartAt = null,
  poster = null,
  busy = true,
  action = null,
  overlay = false,
}: {
  stage: string;
  detail?: string | null;
  // Epoch ms of the start of the wait. The clock counts from here.
  since: number;
  // runs.next_start_at. Adds the Pine rate limit countdown while it is in the future.
  nextStartAt?: string | null;
  poster?: string | null;
  // False hides the spinner and the bar, for example when the panel offers Try again.
  busy?: boolean;
  action?: React.ReactNode;
  // True to cover the desktop that connects underneath.
  overlay?: boolean;
}) {
  const now = useNow(busy);
  const [brokenPoster, setBrokenPoster] = useState<string | null>(null);
  const picture = poster && brokenPoster !== poster ? poster : null;
  const wait = secondsUntil(nextStartAt, now);

  return (
    <div
      className={`${overlay ? "absolute inset-0" : "relative aspect-video min-h-52 w-full"} flex items-center justify-center overflow-hidden rounded-2xl bg-surface-2`}
      aria-busy={busy}
      data-testid="loading-screen"
    >
      {picture && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture}
          alt=""
          aria-hidden
          onError={() => setBrokenPoster(picture)}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-25 grayscale"
        />
      )}
      <div className="relative flex w-full max-w-sm flex-col items-center gap-2.5 px-4 py-4 text-center">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          {busy && <Spinner className="size-4 text-accent" />}
          {/* Only the stage is live. The clock would repeat every second. */}
          <span role="status" aria-live="polite">
            {stage}
          </span>
        </div>
        {busy && (
          <>
            <IndeterminateBar label={stage} className="max-w-56" />
            <span className="text-xs tabular-nums text-muted">
              {formatElapsed((now - since) / 1000)} so far
            </span>
          </>
        )}
        {detail && <p className="text-xs text-muted">{detail}</p>}
        {wait !== null && (
          <p className="text-xs tabular-nums text-muted">
            Pine limits how many computers start each minute. Next start in {wait}s.
          </p>
        )}
        {action}
      </div>
    </div>
  );
}
