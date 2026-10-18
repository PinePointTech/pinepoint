// Column names come from the findings table in db/001_init.sql.
export type FindingLevel = "bug" | "possible" | "old_bug";
export type Decision = "bug" | "not_bug";

export type FindingView = {
  id: string;
  level: FindingLevel;
  title: string;
  steps: string[];
  expected: string;
  saw: string;
  production_saw: string | null;
  screenshot_url: string | null;
  decision: Decision | null;
  decided_at: string | null;
};

// "starting": the panel asks for the desktop. "live": the desktop is connected.
// "ended": there is no live desktop (sample data, a failed request, or a stopped computer).
export type DesktopStatus = "starting" | "live" | "ended";

// One picture of the screen after an agent step. The runner saves them in missions.result.steps.
export type StepShotView = { url: string; title: string; at: string | null };

export type SessionPanelProps = {
  // Optional DOM id for the panel section.
  id?: string;
  runId: string;
  missionId: string;
  finding: FindingView | null;
  // The latest screenshot of the mission. The panel shows it when there is no live desktop.
  // When it is missing, the panel uses finding.screenshot_url.
  lastScreenshotUrl?: string | null;
  // Pictures of the screen after each step, oldest first. Each opens full size in a new tab.
  steps?: StepShotView[];
  onClose: () => void;
  fake?: boolean;
};
