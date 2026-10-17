// Text of the PR review: the summary body and the inline comments (plan section 9.4).
// Pure functions. They read no env and do no I/O.

export type ReviewFinding = {
  id: string;
  level: "bug" | "possible" | "old_bug";
  title: string;
  steps: string[];
  expected: string | null;
  saw: string | null;
  production_saw: string | null;
  screenshot_url: string | null;
  path: string | null;
  line: number | null;
  /** Persona and lens of the first mission in mission_ids. */
  persona: string | null;
  lens: string | null;
};

export type SummaryInput = {
  appBaseUrl: string;
  runId: string;
  author: string | null;
  bugs: number;
  passed: number;
  blocked: number;
  possible: ReviewFinding[];
  oldBugs: ReviewFinding[];
  /** Bugs that have no path or line, so they get no inline comment. */
  bugsWithoutLine: ReviewFinding[];
};

/** The link to a run in the web app. */
export function runLink(appBaseUrl: string, runId: string): string {
  return `${trimSlash(appBaseUrl)}/app?run=${runId}`;
}

/** The link to one finding of a run in the web app. */
export function findingLink(appBaseUrl: string, runId: string, findingId: string): string {
  return `${runLink(appBaseUrl, runId)}&finding=${findingId}`;
}

/** The review body. */
export function summaryBody(input: SummaryInput): string {
  const p = input.possible.length;
  const mention = input.author ? ` @${input.author}` : "";
  const lines = [
    `PinePoint tested this preview with 10 simulated users.${mention}`,
    `Bugs: ${input.bugs}. Possible issues: ${p}. Passed: ${input.passed}. Blocked: ${input.blocked}.`,
    `Open the run: ${runLink(input.appBaseUrl, input.runId)}`,
  ];
  if (p > 0) {
    lines.push(
      `<details><summary>Possible issues (${p})</summary>`,
      ...numbered(input.possible.map((f) => f.title)),
      "</details>",
    );
  }
  if (input.bugsWithoutLine.length > 0) {
    lines.push("", "Bugs with no target line:", ...numbered(input.bugsWithoutLine.map((f) => f.title)));
  }
  if (input.oldBugs.length > 0) {
    lines.push("", "Old bugs (production has them too):", ...numbered(input.oldBugs.map((f) => f.title)));
  }
  return lines.join("\n");
}

/** The inline comment body for one Bug. */
export function bugCommentBody(appBaseUrl: string, runId: string, f: ReviewFinding): string {
  const who = [f.persona, f.lens ? `${f.lens} lens` : null].filter(Boolean).join(", ");
  const lines = [`Bug: ${f.title}`];
  if (who) lines.push(who);
  lines.push("", "Steps:", ...numbered(f.steps), "");
  lines.push(`Expected: ${f.expected ?? ""}`, `Saw: ${f.saw ?? ""}`);
  if (f.production_saw != null) lines.push(`Production: ${f.production_saw}`);
  if (f.screenshot_url) lines.push("", `![Failure screenshot](${f.screenshot_url})`);
  lines.push(
    "",
    `[Open the paused session](${findingLink(appBaseUrl, runId, f.id)}). Take control. The cart is still full.`,
    "Decide in the session: Bug or Not a bug.",
  );
  return lines.join("\n");
}

function numbered(items: string[]): string[] {
  return items.map((s, i) => `${i + 1}. ${s}`);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
