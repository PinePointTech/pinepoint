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

export type SessionPanelProps = {
  runId: string;
  missionId: string;
  finding: FindingView | null;
  onClose: () => void;
  fake?: boolean;
};
