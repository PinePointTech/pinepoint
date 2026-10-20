"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
  History,
  MessageSquareText,
} from "lucide-react";
import { ApiError, createRun, getRunStatus, listRuns, type WithFake } from "@/lib/app-api";
import {
  TERMINAL_RUN_STATUSES,
  type Finding,
  type Mission,
  type Run,
  type StatusResponse,
} from "@/lib/app-types";
import { SessionPanel, type FindingView, type StepShotView } from "@/components/session-panel";
import { RunProgress, StartingRun } from "./activity";
import { CostCard } from "./cost-card";
import { LaunchPanel, type LaunchRequest } from "./launch-panel";
import { MissionGroups } from "./mission-groups";
import { useNow } from "./progress";
import {
  detailLine,
  failedChecks,
  findingFor,
  flakePassed,
  reasonOf,
  tileState,
  type TileContext,
  type TileState,
} from "./tile-state";

const POLL_MS = 3000;

// missions.result.step_shots: the runner's pictures of the screen after each step.
function stepsOf(result: unknown): StepShotView[] {
  const steps = (result as { step_shots?: unknown } | null)?.step_shots;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as StepShotView).url === "string")
    .map((s) => ({
      url: s.url as string,
      title: typeof s.title === "string" ? s.title : "",
      at: typeof s.at === "string" ? s.at : null,
    }));
}

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  planning: "Planning",
  running: "Running",
  reporting: "Reporting",
  done: "Done",
  failed: "Failed",
  no_preview: "No preview",
};

// The line on a mission with no finding, in the session panel.
function noFindingNote(state: TileState, mission: Mission, missions: Mission[]): string | null {
  switch (state) {
    case "rechecking":
      return "A check failed. PinePoint runs the mission again to see if the failure repeats.";
    case "check_failed":
      return "A check failed. The findings come when every user ends.";
    case "not_confirmed":
      return flakePassed(mission, missions)
        ? "The re-check passed, so PinePoint does not report it."
        : "A check failed, but PinePoint does not report it.";
    case "needs_you": {
      // The person who takes control must see what the agent asked; on a phone the card is hidden.
      const asks = detailLine("needs_you", mission, undefined, missions);
      return asks ? `The agent needs help. Take control to help it. ${asks}` : null;
    }
    default:
      return null;
  }
}

// The session panel takes the finding in its own shape.
function toFindingView(f: Finding | undefined, prUrl: string): FindingView | null {
  if (!f || !f.level) return null;
  return {
    id: f.id,
    level: f.level,
    title: f.title ?? "Finding",
    steps: f.steps ?? [],
    expected: f.expected ?? "",
    saw: f.saw ?? "",
    production_saw: f.production_saw,
    screenshot_url: f.screenshot_url,
    path: f.path,
    line: f.line,
    decision: f.decision,
    decided_at: f.decided_at,
    fix: f.fix ?? null,
    // A review comment opens at {pr_url}#discussion_r{id}. 0 is the lock value while a post runs.
    fix_comment_url: f.fix_comment_id ? `${prUrl}#discussion_r${f.fix_comment_id}` : null,
  };
}

function minutesBetween(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const ms = (end ? Date.parse(end) : Date.now()) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return `${(ms / 60000).toFixed(1)} min`;
}

// What the sign-in and install callbacks say when they send a person back here (?auth_error=, ?install=).
const AUTH_ERROR_TEXT: Record<string, string> = {
  not_configured: "Sign-in is not set up on this deployment.",
  access_denied: "You cancelled the GitHub sign-in.",
  bad_state: "The sign-in did not come back the way it left. Try again.",
  no_code: "GitHub sent no code. Try again.",
  bad_code: "GitHub did not accept the sign-in. Try again.",
  github_error: "GitHub did not answer. Try again in a minute.",
};
const INSTALL_TEXT: Record<string, { tone: "info" | "error"; text: string }> = {
  connected: { tone: "info", text: "Connected. Pick the organization and a repository below." },
  requested: { tone: "info", text: "Your request went to the organization owners. When they approve the installation, come back here and connect it." },
  not_found: { tone: "error", text: "GitHub has no such installation." },
  not_visible_to_user: { tone: "error", text: "That installation is not one you can see on GitHub, so PinePoint did not connect it." },
  bad_request: { tone: "error", text: "GitHub sent no installation id." },
  reauthorize: { tone: "error", text: "GitHub no longer accepts your sign-in. Continue with GitHub again." },
  github_error: { tone: "error", text: "GitHub did not answer. Try again in a minute." },
  not_configured: { tone: "error", text: "Connecting an organization is not set up on this deployment." },
};

// The click on Run, until the new run's first status arrives.
interface Starting {
  title: string;
  at: number;
  // Set when POST /api/runs answers.
  runId: string | null;
  existing: boolean;
}

function startingStage(s: Starting, now: number): string {
  if (s.runId) return s.existing ? "Opening the run that is already going." : "Opening the run.";
  // POST /api/runs reads the PR and answers in a few seconds. The page waits 30 seconds at most.
  return now - s.at < 8000
    ? "Reading the PR on GitHub."
    : "The server is slow to answer. PinePoint waits up to 30 seconds.";
}

// The server's 500 text already starts with "Could not start the run". Do not say it two times.
const startErrorText = (m: string) =>
  /^(could not|cannot) start the run/i.test(m) ? m : `Cannot start the run: ${m}`;

function Chip({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <li className={`flex items-baseline gap-2 rounded-2xl border px-4 py-2 ${tone}`}>
      <span className="text-lg font-bold tabular-nums">{value}</span>
      <span className="text-sm">{label}</span>
    </li>
  );
}

function QuickLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof ExternalLink;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      {children}
    </a>
  );
}

export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fakeParam = params.get("fake") === "1";
  const runId = params.get("run");
  const findingParam = params.get("finding");

  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState<WithFake<StatusResponse> | null>(null);
  // A load failure (the run list or the status poll). The next good poll clears it.
  const [error, setError] = useState<string | null>(null);
  // A note about the run start, or another failure of a click. The status poll does not clear it.
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [starting, setStarting] = useState<Starting | null>(null);
  // Bumped when the server refused a launch because the PR head moved, so the preflight runs again.
  const [preflightKey, setPreflightKey] = useState(0);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // A shared ?finding= link opens a finished run. Fake data skips the wait.
  const [complete] = useState(() => findingParam !== null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fullscreenExitAt = useRef(0);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) fullscreenExitAt.current = Date.now();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Only the status of the run in the URL shows. A late answer for the run before never does.
  const view = status && status.run.id === runId ? status : null;
  const usingFake = fakeParam || view?.fake === true;

  // The newest query. startRun calls setQuery after an await, so it must not use the query
  // of the render where Run was clicked.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      const q = new URLSearchParams(paramsRef.current.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const refreshRuns = useCallback(() => {
    listRuns({ fake: fakeParam })
      .then((r) => setRuns(r.runs.slice(0, 10)))
      .catch((e: Error) => setError(`Cannot load runs: ${e.message}`));
  }, [fakeParam]);

  useEffect(refreshRuns, [refreshRuns]);

  // The sign-in and install callbacks come back with ?auth_error= or ?install=. Show it once and drop it from the URL.
  const authError = params.get("auth_error");
  const installResult = params.get("install");
  useEffect(() => {
    if (!authError && !installResult) return;
    if (authError) setNotice({ tone: "error", text: AUTH_ERROR_TEXT[authError] ?? "The sign-in did not finish." });
    else if (installResult) setNotice(INSTALL_TEXT[installResult] ?? { tone: "info", text: "Back from GitHub." });
    setQuery({ auth_error: null, install: null, workspace: null });
  }, [authError, installResult, setQuery]);

  // Bumped to poll the open run again after it ended, for example when the sample run restarts.
  const [pollKey, setPollKey] = useState(0);
  // Poll the open run every 3 seconds until it ends.
  useEffect(() => {
    if (!runId) {
      setStatus(null);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The Last runs list shows each run's status, so refresh it when the open run moves on.
    let lastStatus: string | null = null;
    const tick = async () => {
      try {
        const s = await getRunStatus(runId, { fake: fakeParam, complete });
        if (stop) return;
        setStatus(s);
        setError(null);
        const moved = lastStatus !== null && lastStatus !== s.run.status;
        lastStatus = s.run.status;
        if (TERMINAL_RUN_STATUSES.includes(s.run.status)) {
          refreshRuns();
          return;
        }
        if (moved) refreshRuns();
      } catch (e) {
        if (stop) return;
        setError(`Cannot load the run: ${(e as Error).message}`);
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, fakeParam, complete, refreshRuns, pollKey]);

  // The start card goes when the new run's status arrives, or when it cannot load.
  useEffect(() => {
    if (!starting?.runId) return;
    if (view?.run.id === starting.runId || error) setStarting(null);
  }, [starting, view, error]);

  const runEnded = view ? TERMINAL_RUN_STATUSES.includes(view.run.status) : true;
  // Move the clocks (elapsed time, countdowns, the "minutes" chip) while something goes on.
  const now = useNow(!runEnded || starting !== null);

  async function startRun(launch: LaunchRequest) {
    if (starting) return;
    setStarting({ title: launch.title, at: Date.now(), runId: null, existing: false });
    setError(null);
    setNotice(null);
    try {
      const res = await createRun(launch.request, { fake: fakeParam });
      // runId is the run in the URL when Run was clicked. The person cannot change it while
      // the form waits, but they can open a mission card of that run.
      const same = res.runId === runId;
      const fake = fakeParam || res.fake ? "1" : null;
      // The run already open keeps its drawer, its ?finding= and its view.
      if (same) {
        setQuery({ fake });
        // A sample run restarts its clock on Run, and a finished run stopped its poll: poll again.
        if (res.fake || (status && TERMINAL_RUN_STATUSES.includes(status.run.status))) setPollKey((k) => k + 1);
      } else {
        setMissionId(null);
        setQuery({ run: res.runId, finding: null, fake });
      }
      if (res.existing) {
        setNotice({ tone: "info", text: "A run for this commit is already going. You are watching it." });
      }
      setStarting((s) => (s ? { ...s, runId: res.runId, existing: res.existing } : s));
      refreshRuns();
    } catch (err) {
      const text = startErrorText((err as Error).message);
      setStarting(null);
      // 409: the PR head moved since the preflight. The card looks again; the person clicks when ready.
      if (err instanceof ApiError && err.status === 409) setPreflightKey((k) => k + 1);
      if (err instanceof ApiError && err.runId) {
        // The run row exists. Open it, so its status shows what happened.
        if (err.runId !== runId) {
          setMissionId(null);
          setQuery({ run: err.runId, finding: null });
        }
      }
      setNotice({ tone: "error", text });
      // A slow server can still make the run. Then it shows in the list.
      refreshRuns();
    }
  }

  // Sign-in and install return to the page as it is, minus the callback's own parameters.
  const returnTo = (() => {
    const q = new URLSearchParams(params.toString());
    q.delete("auth_error");
    q.delete("install");
    q.delete("workspace");
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  })();

  function openRun(id: string) {
    setMissionId(null);
    setNotice(null);
    setQuery({ run: id, finding: null });
  }

  const findings = view?.findings ?? [];
  const missions = view?.missions ?? [];
  const previewMissions = missions.filter((m) => m.kind === "preview");
  const context: TileContext = { run: view?.run ?? null, missions, now };
  const openFinding = findings.find((f) => f.id === findingParam);
  const panelMissionId = missionId ?? openFinding?.mission_ids?.[0] ?? null;
  const panelMission = missions.find((m) => m.id === panelMissionId);
  const panelFinding = openFinding ?? (panelMission ? findingFor(panelMission, findings) : undefined);
  const panelState = panelMission ? tileState(panelMission, panelFinding, context) : null;
  const panelOpen = view !== null && panelMissionId !== null;

  function openMission(id: string) {
    const mission = missions.find((m) => m.id === id);
    const f = mission ? findingFor(mission, findings) : undefined;
    setMissionId(id);
    setQuery({ finding: f?.id ?? null });
  }

  const closePanel = useCallback(() => {
    setMissionId(null);
    setQuery({ finding: null });
  }, [setQuery]);

  // The panel is a native modal dialog: it traps focus, closes on Esc and
  // keeps the cards visible behind a light backdrop.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (panelOpen && !d.open) d.showModal();
    if (!panelOpen && d.open) d.close();
  }, [panelOpen]);

  async function copyRunLink() {
    if (!view) return;
    const link = `${window.location.origin}/app?run=${view.run.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({ tone: "error", text: `Copy did not work. The link is ${link}` });
    }
  }

  const states = previewMissions.map((m) => tileState(m, findingFor(m, findings), context));
  const counts = {
    bugs: findings.filter((f) => f.level === "bug").length,
    possible: findings.filter((f) => f.level === "possible").length,
    oldBugs: findings.filter((f) => f.level === "old_bug").length,
    passed: states.filter((s) => s === "passed").length,
    notConfirmed: states.filter((s) => s === "not_confirmed").length,
    couldNotRun: states.filter((s) => s === "could_not_run").length,
    blocked: states.filter((s) => s === "blocked" || s === "timed_out").length,
  };
  const minutes = view ? minutesBetween(view.run.started_at, view.run.finished_at) : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pb-16 sm:px-6 md:flex-row">
      <aside className="md:w-60 md:shrink-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
          <History className="size-4" strokeWidth={1.75} aria-hidden />
          Last runs
        </h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No runs yet.</p>
        ) : (
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            {runs.map((r) => (
              <li key={r.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => openRun(r.id)}
                  className={`w-full rounded-2xl px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface ${
                    r.id === runId ? "bg-surface font-semibold ring-1 ring-border" : ""
                  }`}
                >
                  <span className="block">
                    {r.repo} #{r.pr_number}
                  </span>
                  <span className="block text-xs text-muted">
                    {RUN_STATUS_LABEL[r.status] ?? r.status}
                    {r.started_at
                      ? ` / ${new Date(r.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-8">
        <LaunchPanel busy={starting !== null} returnTo={returnTo} onLaunch={startRun} onNotice={setNotice} refreshKey={preflightKey} />
        {fakeParam && (
          <p className="-mt-4 text-xs text-muted">Sample data: Run shows the sample run, whatever is picked above.</p>
        )}

        {error && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        {notice &&
          (notice.tone === "error" ? (
            <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {notice.text}
            </p>
          ) : (
            <p role="status" className="rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-fg">
              {notice.text}
            </p>
          ))}

        {starting && (
          <StartingRun
            title={starting.title}
            stage={startingStage(starting, now)}
            seconds={Math.max(0, Math.floor((now - starting.at) / 1000))}
            level={view ? 2 : 1}
          />
        )}

        {!runId && !starting && (
          <section aria-labelledby="how-to" className="max-w-xl">
            <h1 id="how-to" className="text-2xl font-extrabold tracking-tight">
              Test a pull request
            </h1>
            <ol className="mt-4 space-y-3 text-muted">
              <li className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">1</span>
                Pick a GitHub PR that has a Vercel preview: from your organization after you sign in, or by URL for the public demo.
              </li>
              <li className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">2</span>
                Click Run QA. Ten simulated users test the preview.
              </li>
              <li className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">3</span>
                Open the red card to see the bug, the steps and the screen.
              </li>
            </ol>
          </section>
        )}

        {runId && !view && !error && !starting && <p className="text-sm text-muted">Loading the run.</p>}

        {view && (
          <>
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-2xl font-extrabold tracking-tight">
                  {view.run.owner}/{view.run.repo} #{view.run.pr_number}
                </h1>
                {usingFake && (
                  <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    Demo data
                  </span>
                )}
              </div>
              {usingFake && (
                <p className="-mt-2 text-sm text-muted">
                  This is sample data, not a real run.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <QuickLink href={view.run.pr_url} icon={GitPullRequest}>
                  Open the PR
                </QuickLink>
                {view.run.preview_url && (
                  <QuickLink href={view.run.preview_url} icon={ExternalLink}>
                    Open the preview
                  </QuickLink>
                )}
                {view.run.review_id ? (
                  <QuickLink
                    href={`${view.run.pr_url}#pullrequestreview-${view.run.review_id}`}
                    icon={MessageSquareText}
                  >
                    Open the PR review
                  </QuickLink>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted"
                    title="PinePoint posts the review when all missions end."
                  >
                    <MessageSquareText className="size-4" strokeWidth={1.75} aria-hidden />
                    Review not posted yet
                  </span>
                )}
                <button
                  type="button"
                  onClick={copyRunLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
                >
                  {copied ? (
                    <Check className="size-4" strokeWidth={2} aria-hidden />
                  ) : (
                    <Copy className="size-4" strokeWidth={1.75} aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy the run link"}
                </button>
              </div>

              {view.run.status !== "no_preview" && (
                <RunProgress
                  run={view.run}
                  missions={missions}
                  statusLabel={RUN_STATUS_LABEL[view.run.status] ?? view.run.status}
                  now={now}
                />
              )}

              {view.run.status === "failed" && (
                <div className="rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm" data-testid="run-error">
                  <p className="font-semibold text-danger">The run failed.</p>
                  <p className="mt-1 break-words text-fg">{view.run.error?.trim() || "PinePoint has no reason for it."}</p>
                </div>
              )}

              <ul className="flex flex-wrap gap-2" aria-label="Run summary">
                <Chip label="Bugs" value={counts.bugs} tone="border-danger/40 bg-danger-soft text-danger" />
                <Chip
                  label="Possible issues"
                  value={counts.possible}
                  tone="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                />
                {counts.oldBugs > 0 && (
                  <Chip label="Old bugs" value={counts.oldBugs} tone="border-border bg-surface-2 text-muted" />
                )}
                <Chip label="Passed" value={counts.passed} tone="border-accent/30 bg-accent-soft text-accent" />
                {counts.notConfirmed > 0 && (
                  <Chip label="Not confirmed" value={counts.notConfirmed} tone="border-border bg-surface text-muted" />
                )}
                {counts.couldNotRun > 0 && (
                  <Chip label="Could not run" value={counts.couldNotRun} tone="border-border bg-surface text-muted" />
                )}
                <Chip label="Blocked" value={counts.blocked} tone="border-border bg-surface text-muted" />
                {minutes && (
                  <Chip
                    label={runEnded ? "from Run to the end" : "so far"}
                    value={minutes}
                    tone="border-border bg-surface text-muted"
                  />
                )}
              </ul>
            </section>

            {view.run.status === "no_preview" && (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
                This PR has no preview URL. PinePoint cannot test it.
              </p>
            )}

            <MissionGroups
              missions={missions}
              findings={findings}
              run={view.run}
              now={now}
              selectedId={panelMissionId}
              onOpen={openMission}
            />

            <CostCard run={view.run} missions={missions} />
          </>
        )}
      </main>

      <dialog
        ref={dialogRef}
        aria-label="Session"
        onCancel={(e) => {
          // A cancel from the picture viewer inside the drawer is not for the drawer.
          if (e.target !== e.currentTarget) return;
          // Esc that leaves full screen must not also close the drawer.
          if (document.fullscreenElement) {
            e.preventDefault();
            document.exitFullscreen().catch(() => {});
          } else if (Date.now() - fullscreenExitAt.current < 600) {
            e.preventDefault();
          }
        }}
        onClose={(e) => {
          // The picture viewer is a dialog too. Its close event must not close the drawer.
          if (e.target !== e.currentTarget) return;
          if (panelOpen) closePanel();
        }}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === e.currentTarget) closePanel();
        }}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-bg p-4 text-fg shadow-2xl backdrop:bg-fg/15 sm:p-6 md:w-[58%] md:rounded-l-[20px] lg:w-[52%]"
      >
        {panelOpen && view && panelMissionId && (
          <SessionPanel
            key={panelMissionId}
            runId={view.run.id}
            missionId={panelMissionId}
            finding={toFindingView(panelFinding, view.run.pr_url)}
            lastScreenshotUrl={panelMission?.screenshot_url ?? null}
            steps={stepsOf(panelMission?.result)}
            missionStatus={panelMission?.status}
            kept={panelMission?.kept}
            hasComputer={panelMission?.has_computer}
            startedAt={panelMission?.started_at ?? null}
            finishedAt={panelMission?.finished_at ?? null}
            nextStartAt={view.run.next_start_at ?? null}
            reason={panelMission ? reasonOf(panelMission) : null}
            failedChecks={panelMission ? failedChecks(panelMission) : []}
            note={panelMission && panelState ? noFindingNote(panelState, panelMission, missions) : null}
            onClose={closePanel}
            fake={usingFake}
          />
        )}
      </dialog>
    </div>
  );
}
