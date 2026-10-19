// Column names come from the findings table in db/001_init.sql.
import type { MissionStatus, StoredFix } from "@/lib/app-types";

export type FindingLevel = "bug" | "possible" | "old_bug";
export type Decision = "bug" | "not_bug";
export type { Fix, StoredFix } from "@/lib/app-types";

export type FindingView = {
  id: string;
  level: FindingLevel;
  title: string;
  steps: string[];
  expected: string;
  saw: string;
  production_saw: string | null;
  screenshot_url: string | null;
  path: string | null;
  line: number | null;
  decision: Decision | null;
  decided_at: string | null;
  // The stored fix, when the fix agent ran.
  fix: StoredFix | null;
  // The GitHub URL of the posted suggestion, when Post to PR ran.
  fix_comment_url: string | null;
};

// The live desktop, step by step.
// "waiting": the desktop route has no Computer yet (404, 409 or 429). The panel asks again.
// "connecting": the panel has the delegation and opens the screen.
// "live": the screen is connected. "reconnecting": the connection dropped and the SDK tries again.
// "stalled": the screen did not connect in time. The panel shows a Try again button.
// "gone": the Computer stopped (410 computer_stopped, or the reconnects stopped).
export type DesktopPhase = "waiting" | "connecting" | "live" | "reconnecting" | "stalled" | "gone";

// One picture of the screen after an agent step. The runner saves them in missions.result.step_shots.
// The title is Pine's step title. It does not match the text steps one to one.
export type StepShotView = { url: string; title: string; at: string | null };

// A check from result.json that did not pass.
export type FailedCheckView = { name: string; expected: string; saw: string };

export type SessionPanelProps = {
  // Optional DOM id for the panel section.
  id?: string;
  runId: string;
  missionId: string;
  finding: FindingView | null;
  // The latest screenshot of the mission. The panel shows it when there is no live desktop.
  // When it is missing, the panel uses finding.screenshot_url.
  lastScreenshotUrl?: string | null;
  // Pictures of the screen after each step, oldest first. Each opens in the picture viewer.
  steps?: StepShotView[];
  // The mission row. They decide what the screen area shows. Without them the panel asks
  // for the desktop, as before.
  missionStatus?: MissionStatus;
  kept?: boolean;
  hasComputer?: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  // runs.next_start_at: Pine rate limited a Computer start until this time.
  nextStartAt?: string | null;
  // Why the mission stopped, and the checks that failed. For a mission with no finding.
  reason?: string | null;
  failedChecks?: FailedCheckView[];
  // One line on a mission with no finding, for example why PinePoint does not report a failure.
  note?: string | null;
  onClose: () => void;
  fake?: boolean;
};
