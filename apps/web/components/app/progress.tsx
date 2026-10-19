"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// The sliding bar of an indeterminate progress bar. React hoists the style tag into the head once.
const SLIDE = "@keyframes pp-slide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}";

// A progress bar for work with no known end. Reduced motion shows a still, striped bar. The
// solid fill is for motion only: under the stripes it would make the bar look full.
export function IndeterminateBar({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext="In progress"
      className={`relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      <style href="pp-progress-slide" precedence="default">
        {SLIDE}
      </style>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-2/5 animate-[pp-slide_1.6s_ease-in-out_infinite] rounded-full motion-safe:bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-[repeating-linear-gradient(135deg,var(--pp-accent)_0_6px,transparent_6px_12px)] motion-reduce:opacity-60"
      />
    </div>
  );
}

// A progress bar with a known end.
export function DeterminateBar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <progress
      className="h-2.5 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent"
      max={Math.max(max, 1)}
      value={Math.min(value, Math.max(max, 1))}
      aria-label={label}
    />
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <Loader2 aria-hidden className={`${className} shrink-0 animate-spin motion-reduce:animate-none`} />;
}

// The clock, moved on every `ms` while `enabled`. Use it for elapsed times and countdowns.
export function useNow(enabled = true, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [enabled, ms]);
  return now;
}

// Seconds as m:ss, for example 0:07 or 4:32.
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Whole seconds from `iso` to `now`, or null when `iso` is missing or bad.
export function secondsSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

// Whole seconds from `now` to `iso`, or null when `iso` is missing, bad or past.
export function secondsUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= now) return null;
  return Math.max(1, Math.ceil((t - now) / 1000));
}
