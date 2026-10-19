// Pure decisions for the orchestrator. No network, no database, so the tests cover them directly.

import {
  allChecksPassed,
  type FindingRow,
  type MissionKind,
  type MissionResult,
  type MissionRow,
  type MissionStatus,
  type RunRow,
} from "@pinepoint/core";
import { MISSION_BUDGET_MS } from "./pine";

/** How many failed Computers one run keeps running for the session link (plan risk 2). */
export const KEPT_CAP_PER_RUN = 3;

/** A claimed mission with no handle after this long never started. The claimer died mid-start. */
export const START_GRACE_MS = 2 * 60 * 1000;

/** A run still in `planning` after this long belongs to a call that died. advanceRun fails it. */
export const PLANNING_TIMEOUT_MS = 6 * 60 * 1000;

/** runs.error for a run that PLANNING_TIMEOUT_MS ended. */
export const PLANNING_TIMEOUT_ERROR = "Planning did not finish in 6 minutes.";

export interface TurnFacts {
  /** AgentTurn.state */
  state: string;
  /** AgentResult.terminalReason, when the turn ended. */
  terminalReason?: string;
  /** AgentResult.summary, or the question for needs_input. */
  summary?: string;
  /** Parsed result.json, or null when it is missing or invalid. */
  result: MissionResult | null;
  /** Why `result` is null. */
  resultError?: string | null;
  /** missions.started_at as epoch ms. */
  startedAtMs: number;
  nowMs: number;
}

export interface Decision {
  /** The end state, or null while the mission still runs. */
  status: Exclude<MissionStatus, "queued" | "running"> | null;
  /** Written to missions.result. Holds result.json plus the runner's own notes. */
  result: Record<string, unknown> | null;
  /** True when the turn must be canceled because it ran past the budget. */
  cancel: boolean;
}

/**
 * Maps one turn to a mission end state (plan section 5 and VI-10 steps 4 and 7).
 *
 * running or canceling: null, or blocked after 4 minutes.
 * needs_input: needs_you. The question goes in result.question.
 * completed or answered: passed when every check passed, failed when one failed, blocked when the
 *   agent wrote blocked: true, error when result.json is missing or invalid.
 * failed: error. canceled: blocked.
 */
export function decideTurn(facts: TurnFacts): Decision {
  const base: Record<string, unknown> = {};
  if (facts.terminalReason) base.terminalReason = facts.terminalReason;
  if (facts.summary) base.summary = facts.summary;

  switch (facts.state) {
    case "running":
    case "canceling": {
      if (facts.nowMs - facts.startedAtMs > MISSION_BUDGET_MS) {
        return {
          status: "blocked",
          result: { ...base, reason: "The mission ran past 4 minutes. PinePoint stopped it." },
          cancel: facts.state === "running",
        };
      }
      return { status: null, result: null, cancel: false };
    }
    case "needs_input":
      return { status: "needs_you", result: { ...base, question: facts.summary ?? "" }, cancel: false };
    case "completed":
    case "answered": {
      if (!facts.result) {
        return {
          status: "error",
          result: { ...base, reason: facts.resultError ?? "The agent did not write result.json." },
          cancel: false,
        };
      }
      const result = { ...base, ...facts.result };
      if (facts.result.blocked) {
        return { status: "blocked", result, cancel: false };
      }
      return { status: allChecksPassed(facts.result) ? "passed" : "failed", result, cancel: false };
    }
    case "failed":
      return {
        status: "error",
        result: { ...base, reason: facts.summary || `The agent turn failed (${facts.terminalReason ?? "unknown"}).` },
        cancel: false,
      };
    case "canceled":
      return { status: "blocked", result: { ...base, reason: "The agent turn was canceled." }, cancel: false };
    default:
      return { status: null, result: null, cancel: false };
  }
}

/** Free Computer slots: the project limit minus the Computers in use, never below zero. */
export function freeSlots(limit: number, inUse: number): number {
  return Math.max(0, limit - inUse);
}

/**
 * The most Computers one call starts. A start takes about 8 seconds, so 6 starts end well inside
 * START_LEASE_SECONDS and inside the 120-second status route. A claimed mission waits at most
 * about 45 seconds for its start, well inside START_GRACE_MS.
 */
export const MAX_STARTS_PER_CALL = 6;

/** How long one call holds the start lease of a run (runs.start_lease_until). */
export const START_LEASE_SECONDS = 100;

/** How many queued missions one call claims: the free slots, but at most `cap`. */
export function slotsToFill(limit: number, inUse: number, cap = MAX_STARTS_PER_CALL): number {
  return Math.min(freeSlots(limit, inUse), Math.max(0, cap));
}

/** True when the run is running and has queued missions, so a call to startQueued has work. */
export function needsStarts(run: Pick<RunRow, "status">, missions: Array<Pick<MissionRow, "status">>): boolean {
  return run.status === "running" && missions.some((m) => m.status === "queued");
}

export interface FollowUp {
  kind: MissionKind;
  url: string;
}

/**
 * The missions to queue after a failure (VI-10 step 5). Only a failed preview mission gets them:
 * a flake re-run on the same preview, and a production run unless the feature is new to the PR.
 */
export function followUpsFor(mission: Pick<MissionRow, "kind" | "url" | "new_feature">, run: Pick<RunRow, "production_url">): FollowUp[] {
  if (mission.kind !== "preview" || !mission.url) {
    return [];
  }
  const list: FollowUp[] = [{ kind: "flake", url: mission.url }];
  if (!mission.new_feature && run.production_url) {
    list.push({ kind: "production", url: run.production_url });
  }
  return list;
}

/**
 * Whether the Computer stays running after the mission ends.
 * needs_you: always, so the developer can take control.
 * failed preview: while the run keeps fewer than the cap. The flake and production runs never keep theirs.
 * Everything else stops.
 */
export function shouldKeep(status: MissionStatus, kind: MissionKind, keptFailedInRun: number): boolean {
  if (status === "needs_you") return true;
  if (status === "failed" && kind === "preview") return keptFailedInRun < KEPT_CAP_PER_RUN;
  return false;
}

/** True when every mission is in an end state. */
export function runIsComplete(missions: Array<Pick<MissionRow, "status">>): boolean {
  return missions.length > 0 && missions.every((m) => m.status !== "queued" && m.status !== "running");
}

/** runs.error holds at most this many characters. A planner error can carry a long validation report. */
export const MAX_RUN_ERROR_CHARS = 500;

/** The runs.error text for an error: "<prefix>: <message>", cut at MAX_RUN_ERROR_CHARS. */
export function runErrorText(prefix: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = `${prefix}: ${raw.trim() || "no message"}`;
  return text.length <= MAX_RUN_ERROR_CHARS ? text : `${text.slice(0, MAX_RUN_ERROR_CHARS - 3)}...`;
}

/** True when the run is still `planning` more than PLANNING_TIMEOUT_MS after it started. */
export function planningTimedOut(run: Pick<RunRow, "status" | "started_at">, nowMs: number): boolean {
  if (run.status !== "planning" || !run.started_at) return false;
  return nowMs - new Date(run.started_at).getTime() > PLANNING_TIMEOUT_MS;
}

/**
 * The kept missions to release when a run ends: every kept mission that no Bug finding names,
 * except needs_you. A Bug keeps its Computers for the session link, and a needs_you mission keeps
 * its Computer for "Take control" (shouldKeep). Possible issues and old bugs stop, so they do not
 * hold Computer slots for 24 hours.
 */
export function keptToRelease<T extends Pick<MissionRow, "id" | "kept" | "status">>(
  missions: T[],
  findings: Array<Pick<FindingRow, "level" | "mission_ids">>,
): T[] {
  const needed = new Set(findings.filter((f) => f.level === "bug").flatMap((f) => f.mission_ids ?? []));
  return missions.filter((m) => m.kept && m.status !== "needs_you" && !needed.has(m.id));
}

/**
 * A mission that ended this recently can still have a status call that reads its step pictures
 * from the Computer (collectStepShots). The release waits until this much time has passed.
 */
export const RELEASE_GRACE_MS = 15_000;

/** How long to wait before a kept Computer is stopped: the rest of RELEASE_GRACE_MS after the mission ended. */
export function releaseDelayMs(finishedAt: string | null, nowMs: number): number {
  if (!finishedAt) return 0;
  const age = nowMs - new Date(finishedAt).getTime();
  if (!Number.isFinite(age)) return 0;
  return Math.min(RELEASE_GRACE_MS, Math.max(0, RELEASE_GRACE_MS - age));
}
