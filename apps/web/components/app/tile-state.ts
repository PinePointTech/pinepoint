import { TERMINAL_RUN_STATUSES, type Finding, type Mission, type Run } from "@/lib/app-types";

export type TileState =
  | "queued"
  | "waiting"
  | "starting"
  | "testing"
  | "needs_you"
  | "could_not_run"
  | "blocked"
  | "timed_out"
  | "bug"
  | "old_bug"
  | "possible"
  | "rechecking"
  | "not_confirmed"
  | "check_failed"
  | "passed";

// What tileState needs besides the mission: the run (its status and next start time) and
// every mission of the run (the flake and production re-checks of a failure).
export interface TileContext {
  run?: Pick<Run, "status" | "next_start_at"> | null;
  missions?: Mission[];
  now?: number;
}

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

type Check = { name: string; expected: string; saw: string; passed: boolean };

function resultOf(mission: Mission): Record<string, unknown> | null {
  const r = mission.result;
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
}

// missions.result.reason: why the runner stopped the mission or could not run it.
export function reasonOf(mission: Mission): string | null {
  const reason = resultOf(mission)?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

// The checks in result.json that did not pass.
export function failedChecks(mission: Mission): Check[] {
  const checks = resultOf(mission)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.filter(
    (c): c is Check =>
      !!c && typeof c === "object" && (c as Check).passed === false && typeof (c as Check).name === "string",
  );
}

// The flake and production missions that re-check this mission.
export function followUpsOf(mission: Mission, missions: Mission[] = []): Mission[] {
  return missions.filter((m) => m.parent_id === mission.id);
}

// The flake re-run passed: the failure did not repeat on the same preview.
export function flakePassed(mission: Mission, missions: Mission[] = []): boolean {
  return followUpsOf(mission, missions).some((m) => m.kind === "flake" && m.status === "passed");
}

function future(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now;
}

export function tileState(mission: Mission, finding?: Finding, ctx: TileContext = {}): TileState {
  const now = ctx.now ?? Date.now();
  switch (mission.status) {
    case "queued":
      return future(ctx.run?.next_start_at, now) ? "waiting" : "queued";
    case "running":
      // has_computer is false while Pine starts the Computer. An older API does not send it.
      return mission.has_computer === false ? "starting" : "testing";
    case "needs_you":
      return "needs_you";
    case "error":
      return "could_not_run";
    case "blocked":
      return /past \d+ minutes/i.test(reasonOf(mission) ?? "") ? "timed_out" : "blocked";
  }
  if (finding?.level === "bug") return "bug";
  if (finding?.level === "old_bug") return "old_bug";
  if (finding?.level === "possible") return "possible";
  if (mission.status === "passed") return "passed";

  // A failed check. The flake re-run and the production run decide what it means.
  const followUps = followUpsOf(mission, ctx.missions);
  if (followUps.some((m) => m.status === "queued" || m.status === "running")) return "rechecking";
  if (ctx.run && TERMINAL_RUN_STATUSES.includes(ctx.run.status)) return "not_confirmed";
  return "check_failed";
}

export const TILE_LABEL: Record<TileState, string> = {
  queued: "Queued",
  waiting: "Waiting for Pine",
  starting: "Starting computer",
  testing: "Testing",
  needs_you: "Needs you",
  could_not_run: "Could not run",
  blocked: "Blocked",
  timed_out: "Timed out",
  bug: "Bug",
  old_bug: "Old bug",
  possible: "Possible issue",
  rechecking: "Re-checking",
  not_confirmed: "Not confirmed",
  check_failed: "Check failed",
  passed: "Passed",
};

// Ends a fragment with a period, so "Expected X. Saw Y." reads as two sentences.
export function sentence(text: string): string {
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

// "Check failed: <name>. Expected X. Saw Y." for the first failed check in result.json.
export function checkLine(mission: Mission): string | null {
  const failed = failedChecks(mission);
  const first = failed[0];
  if (!first) return null;
  const parts = [`Check failed: ${sentence(first.name)}`];
  if (first.expected?.trim()) parts.push(`Expected ${sentence(first.expected)}`);
  if (first.saw?.trim()) parts.push(`Saw ${sentence(first.saw)}`);
  if (failed.length > 1) parts.push(`${failed.length - 1} more failed.`);
  return parts.join(" ");
}

// The short line under the goal on a mission card.
export function detailLine(
  state: TileState,
  mission: Mission,
  finding: Finding | undefined,
  missions: Mission[] = [],
): string | null {
  switch (state) {
    case "bug":
    case "old_bug":
    case "possible":
      return findingLine(finding) ?? checkLine(mission);
    case "rechecking":
    case "check_failed":
      return checkLine(mission);
    case "not_confirmed":
      return flakePassed(mission, missions)
        ? "The re-check passed, so PinePoint does not report it."
        : checkLine(mission);
    case "could_not_run":
    case "blocked":
    case "timed_out":
      return reasonOf(mission);
    case "needs_you": {
      const question = resultOf(mission)?.question;
      return typeof question === "string" && question.trim() ? `The agent asks: ${question.trim()}` : null;
    }
    default:
      return null;
  }
}
