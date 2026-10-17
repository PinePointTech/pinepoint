import type { Finding, Mission } from "@/lib/app-types";

export type TileState =
  | "queued"
  | "running"
  | "passed"
  | "bug"
  | "possible"
  | "failed"
  | "needs_you"
  | "blocked";

// A mission is a Bug when a finding with level bug lists it in mission_ids.
export function findingFor(
  mission: Mission,
  findings: Finding[],
): Finding | undefined {
  const listed = findings.filter((f) => f.mission_ids?.includes(mission.id));
  return (
    listed.find((f) => f.level === "bug") ??
    listed.find((f) => f.level === "possible") ??
    listed[0]
  );
}

export function tileState(mission: Mission, finding?: Finding): TileState {
  switch (mission.status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "needs_you":
      return "needs_you";
    case "blocked":
      return "blocked";
  }
  if (finding?.level === "bug") return "bug";
  if (finding?.level === "possible") return "possible";
  if (mission.status === "passed") return "passed";
  return "failed";
}

export const TILE_LABEL: Record<TileState, string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  bug: "Bug",
  possible: "Possible issue",
  failed: "Failed",
  needs_you: "Needs you",
  blocked: "Blocked",
};
