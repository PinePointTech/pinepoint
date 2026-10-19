import type { MissionStatus } from "@/lib/app-types";

// A kept Computer stays on for one day (its idle timeout).
export const KEPT_MS = 24 * 60 * 60 * 1000;

// Why the panel shows the last screen instead of a live desktop.
export type LastReason = "ended" | "gone" | "not_started" | "no_computer" | "sample";

// What the screen area shows. Only "live" asks the desktop route for a Computer.
export type Screen = { kind: "queued" } | { kind: "starting" } | { kind: "live" } | { kind: "last"; reason: LastReason };

export function screenFor(
  p: {
    status?: MissionStatus;
    kept?: boolean;
    hasComputer?: boolean;
    finishedAt?: string | null;
    fake: boolean;
  },
  gone: boolean,
  now: number,
): Screen {
  if (p.status === "queued") return { kind: "queued" };
  if (p.status === "running" && p.hasComputer === false) return { kind: "starting" };
  if (p.fake) return { kind: "last", reason: "sample" };
  // A Computer that stopped when its user finished reads as the end of the mission.
  if (gone) return { kind: "last", reason: p.finishedAt ? "ended" : "gone" };
  if (p.hasComputer !== false) {
    // No status: an older caller. Ask for the desktop, as before.
    if (p.status === undefined || p.status === "running" || p.status === "needs_you") return { kind: "live" };
    const end = p.finishedAt ? Date.parse(p.finishedAt) : NaN;
    if (p.kept && (!Number.isFinite(end) || now - end < KEPT_MS)) return { kind: "live" };
  }
  if (p.hasComputer === false) return { kind: "last", reason: p.finishedAt ? "no_computer" : "not_started" };
  return { kind: "last", reason: "ended" };
}
