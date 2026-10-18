// Column names come from the findings table in db/001_init.sql.
import type { StoredFix } from "@/lib/app-types";

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

// "starting": the panel asks for the desktop. "live": the desktop is connected.
// "ended": there is no live desktop (sample data, a failed request, or a stopped computer).
export type DesktopStatus = "starting" | "live" | "ended";

export type SessionPanelProps = {
  // Optional DOM id for the panel section.
  id?: string;
  runId: string;
  missionId: string;
  finding: FindingView | null;
  // The latest screenshot of the mission. The panel shows it when there is no live desktop.
  // When it is missing, the panel uses finding.screenshot_url.
  lastScreenshotUrl?: string | null;
  onClose: () => void;
  fake?: boolean;
};
