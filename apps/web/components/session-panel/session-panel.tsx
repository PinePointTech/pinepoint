"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ExternalLink,
  Expand,
  Hand,
  ImageOff,
  Maximize2,
  Minimize2,
  MonitorOff,
  Wrench,
  X,
} from "lucide-react";
import type { MissionStatus } from "@/lib/app-types";
import { FAKE_COUPON_FIX, FAKE_FIX_COMMENT_URL } from "@/lib/fake-status";
import { ImageViewer, type ViewerItem } from "./image-viewer";
import { LoadingScreen } from "./loading-screen";
import type {
  Decision,
  DesktopPhase,
  FailedCheckView,
  FindingView,
  Fix,
  SessionPanelProps,
  StepShotView,
  StoredFix,
} from "./types";

// The desktop SDK uses browser APIs. Load it only in the browser.
const LiveDesktop = dynamic(() => import("./live-desktop"), {
  ssr: false,
  loading: () => <LoadingScreen stage="Connecting to the screen" since={Date.now()} />,
});

const IDLE_MS = 15 * 60 * 1000;
// A kept Computer stays on for one day (its idle timeout).
const KEPT_MS = 24 * 60 * 60 * 1000;

// Why the panel shows the last screen instead of a live desktop.
type LastReason = "ended" | "gone" | "not_started" | "no_computer" | "sample";

// What the screen area shows. Only "live" asks the desktop route for a Computer.
type Screen = { kind: "queued" } | { kind: "starting" } | { kind: "live" } | { kind: "last"; reason: LastReason };

function screenFor(
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

const LEVEL_TEXT: Record<FindingView["level"], string> = {
  bug: "Bug",
  possible: "Possible issue",
  old_bug: "Old bug",
};

// Soft pastel pills with a thin border, the same colors as the mission tiles.
const LEVEL_PILL: Record<FindingView["level"], string> = {
  bug: "border-danger/30 bg-danger-soft text-danger",
  possible:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/40 dark:text-amber-200",
  old_bug: "border-border bg-surface-2 text-muted",
};

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function timePT(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  return t.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
}

function decisionText(decision: Decision, at: string | null): string {
  return decision === "bug"
    ? `Marked as Bug at ${timePT(at)} PT.`
    : `Marked as Not a bug at ${timePT(at)} PT. PinePoint stores this lesson.`;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json().catch(() => ({}));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SessionPanel({
  id,
  runId,
  missionId,
  finding,
  lastScreenshotUrl,
  steps = [],
  missionStatus,
  kept,
  hasComputer,
  startedAt = null,
  finishedAt = null,
  nextStartAt = null,
  reason = null,
  failedChecks = [],
  note = null,
  onClose,
  fake = false,
}: SessionPanelProps) {
  const [phase, setPhase] = useState<DesktopPhase>("waiting");
  // The desktop said the Computer is gone. The panel shows the last screen from then on.
  const [gone, setGone] = useState(false);
  // The newest frame of the live screen. The last screen shows it first.
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; start: number; label: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [control, setControl] = useState<"view" | "drive">("view");
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);

  const [decision, setDecision] = useState<Decision | null>(finding?.decision ?? null);
  const [decidedAt, setDecidedAt] = useState<string | null>(finding?.decided_at ?? null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    setDecision(finding?.decision ?? null);
    setDecidedAt(finding?.decided_at ?? null);
    setDecisionError(null);
  }, [finding?.id, finding?.decision, finding?.decided_at]);

  // The fix (plan 9.3): after Bug, the panel asks the fix agent, shows the fix, then Post to PR.
  const [fix, setFix] = useState<StoredFix | null>(finding?.fix ?? null);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [postBusy, setPostBusy] = useState(false);
  const [postUrl, setPostUrl] = useState<string | null>(finding?.fix_comment_url ?? null);
  const [postError, setPostError] = useState<string | null>(null);
  // The finding id that the panel asked a fix for. It stops a second request for the same finding.
  const fixAsked = useRef<string | null>(null);

  useEffect(() => {
    setFix(finding?.fix ?? null);
    setFixError(null);
    setPostUrl(finding?.fix_comment_url ?? null);
    setPostError(null);
    fixAsked.current = null;
  }, [finding?.id]);

  // The status poll brings the stored fix and the posted comment after a reload or from another tab.
  useEffect(() => {
    if (finding?.fix && !fix) setFix(finding.fix);
  }, [finding?.fix, fix]);
  useEffect(() => {
    if (finding?.fix_comment_url && !postUrl) setPostUrl(finding.fix_comment_url);
  }, [finding?.fix_comment_url, postUrl]);

  const requestFix = useCallback(
    async (force = false) => {
      if (!finding) return;
      setFixBusy(true);
      setFixError(null);
      try {
        if (fake) {
          await wait(1500);
          setFix(FAKE_COUPON_FIX);
        } else {
          const reply = (await postJson(`/api/findings/${encodeURIComponent(finding.id)}/fix`, { force })) as {
            fix?: StoredFix | null;
          };
          if (!reply?.fix) throw new Error("no fix");
          setFix(reply.fix);
        }
      } catch {
        setFixError("The fix did not come. Try again.");
      } finally {
        setFixBusy(false);
      }
    },
    [finding, fake],
  );

  // Ask for the fix one time, after Bug, for a Bug finding that has none yet.
  useEffect(() => {
    if (!finding || finding.level !== "bug" || decision !== "bug" || fix || fixBusy) return;
    if (fixAsked.current === finding.id) return;
    fixAsked.current = finding.id;
    void requestFix();
  }, [finding, decision, fix, fixBusy, requestFix]);

  async function postFix() {
    if (!finding || !fix?.fix || postUrl) return;
    setPostBusy(true);
    setPostError(null);
    try {
      if (fake) {
        await wait(600);
        setPostUrl(FAKE_FIX_COMMENT_URL);
      } else {
        const reply = (await postJson(`/api/findings/${encodeURIComponent(finding.id)}/post-fix`, {})) as {
          url?: unknown;
        };
        if (typeof reply?.url !== "string") throw new Error("no url");
        setPostUrl(reply.url);
      }
    } catch {
      setPostError("The post did not work. Try again.");
    } finally {
      setPostBusy(false);
    }
  }

  // A new mission asks for its own desktop.
  useEffect(() => {
    setPhase("waiting");
    setGone(false);
    setLastFrame(null);
    setControl("view");
    setControlError(null);
  }, [missionId]);

  // The mission row decides the screen area. Queued and starting missions get a loading card
  // and no desktop request. An ended mission that keeps no Computer shows its last screen.
  const screen = screenFor({ status: missionStatus, kept, hasComputer, finishedAt, fake }, gone, Date.now());
  const live = screen.kind === "live" && phase === "live";

  // Nobody can drive a desktop that is not live.
  useEffect(() => {
    if (!live) setControl("view");
  }, [live]);

  // Control returns to the agent after 15 minutes without input.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setControl("view");
      setControlError("Control went back to the agent after 15 minutes without input.");
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    if (control !== "drive" && idleTimer.current) clearTimeout(idleTimer.current);
  }, [control]);
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );
  const onInput = useCallback(() => {
    if (control === "drive") armIdle();
  }, [control, armIdle]);

  const onDesktopPhase = useCallback((next: DesktopPhase) => {
    setPhase(next);
    if (next === "gone") {
      setGone(true);
      setControlError(null);
    }
  }, []);

  async function changeControl(action: "take" | "release") {
    setControlBusy(true);
    setControlError(null);
    try {
      await postJson(`/api/missions/${encodeURIComponent(missionId)}/control`, { action });
      if (action === "take") {
        setControl("drive");
        armIdle();
      } else {
        setControl("view");
      }
    } catch {
      setControlError(
        action === "take"
          ? "You cannot take control now. Try again."
          : "The release did not save. Try again.",
      );
    } finally {
      setControlBusy(false);
    }
  }

  async function decide(value: Decision) {
    if (!finding || decision) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      let at: string | null = null;
      let stored: Decision = value;
      if (fake) {
        await wait(300);
      } else {
        // The route can return a decision that another request stored first.
        const reply = (await postJson(`/api/findings/${encodeURIComponent(finding.id)}/decision`, {
          decision: value,
        })) as { decision?: unknown; decidedAt?: unknown; decided_at?: unknown };
        const replyAt = reply?.decidedAt ?? reply?.decided_at;
        if (typeof replyAt === "string") at = replyAt;
        if (reply?.decision === "bug" || reply?.decision === "not_bug") stored = reply.decision;
      }
      setDecision(stored);
      setDecidedAt(at ?? new Date().toISOString());
    } catch {
      setDecisionError("The decision did not save. Try again.");
    } finally {
      setDecisionBusy(false);
    }
  }

  const driving = control === "drive";
  const missionShot = lastScreenshotUrl ?? null;
  const findingShot = finding?.screenshot_url ?? null;
  const poster = lastFrame ?? missionShot ?? findingShot;
  const bugShot = findingShot ?? missionShot;
  const pending = missionStatus === "queued" || missionStatus === "running";
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;

  const openViewer = (items: ViewerItem[], start: number, label: string) => setViewer({ items, start, label });

  return (
    <section
      id={id}
      className="@container flex w-full flex-col gap-5 text-fg"
      aria-label="Session"
      data-run-id={runId}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          {finding && (
            <span
              className={`w-fit rounded-full border px-2.5 py-0.5 text-xs font-medium ${LEVEL_PILL[finding.level] ?? LEVEL_PILL.old_bug}`}
            >
              {LEVEL_TEXT[finding.level] ?? finding.level}
            </span>
          )}
          <h2 className="text-lg font-semibold text-balance text-fg sm:text-xl">
            {finding?.title ?? "Session"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the panel"
          className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <FullScreenFrame>
        {screen.kind === "queued" ? (
          <LoadingScreen
            stage="Waiting for a free computer."
            detail="This user starts when Pine has a computer for it."
            since={openedAt}
            nextStartAt={nextStartAt}
            poster={poster}
          />
        ) : screen.kind === "starting" ? (
          <LoadingScreen
            stage="Starting the computer."
            detail="Pine starts each computer in about 8 seconds, one after another."
            since={Number.isFinite(startedMs) ? startedMs : openedAt}
            nextStartAt={nextStartAt}
            poster={poster}
          />
        ) : screen.kind === "live" ? (
          <LiveDesktop
            // A Computer that just started gets a fresh desktop request.
            key={String(hasComputer)}
            missionId={missionId}
            control={control}
            running={missionStatus === undefined || missionStatus === "running"}
            poster={poster}
            onInput={onInput}
            onPhase={onDesktopPhase}
            onLastFrame={setLastFrame}
          />
        ) : (
          <LastScreen
            urls={[lastFrame, missionShot, findingShot]}
            reason={screen.reason}
            onOpen={(url) =>
              openViewer([{ url, title: "Last screen", at: finishedAt }], 0, "Last screen")
            }
          />
        )}
      </FullScreenFrame>

      <StepShots
        steps={steps}
        pending={pending}
        onOpen={(i) => openViewer(steps, i, "Pictures of each step")}
      />

      {live && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 @md:flex-row @md:items-center @md:justify-between @md:pl-4">
            <p className="flex items-center gap-2 text-sm" aria-live="polite">
              {driving ? (
                <>
                  <Hand className="h-4 w-4 text-accent" aria-hidden />
                  You have control.
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 text-muted" aria-hidden />
                  The agent has control.
                </>
              )}
            </p>
            <button
              type="button"
              disabled={controlBusy}
              onClick={() => changeControl(driving ? "release" : "take")}
              className={`min-h-12 w-full rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 @md:w-auto ${FOCUS} ${
                driving
                  ? "border border-border bg-surface text-fg hover:bg-surface-2"
                  : "bg-accent text-accent-fg hover:bg-accent-hover"
              }`}
            >
              {controlBusy ? "Wait..." : driving ? "Release control" : "Take control"}
            </button>
          </div>
          {controlError && (
            <p className="px-1 text-sm text-danger" role="alert">
              {controlError}
            </p>
          )}
        </div>
      )}

      {finding ? (
        <>
          {finding.steps.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold">Steps</h3>
              {/* role="list" keeps list semantics in Safari after list-style: none. */}
              <ol role="list" className="flex list-none flex-col gap-2.5 text-sm">
                {finding.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular-nums"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 pt-0.5 break-words">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid gap-3 @lg:grid-cols-2">
            <Tile label="Expected" text={finding.expected} tone="plain" />
            <Tile label="Saw" text={finding.saw} tone="danger" />
            {finding.production_saw && (
              <Tile
                label="Production"
                text={finding.production_saw}
                tone="soft"
                className="@lg:col-span-2"
              />
            )}
          </div>

          {bugShot && (
            <BugScreen
              url={bugShot}
              title={finding.title}
              onOpen={() => openViewer([{ url: bugShot, title: finding.title, at: finishedAt }], 0, "Bug screen")}
            />
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 @md:flex-row">
              <button
                type="button"
                disabled={decisionBusy || decision !== null}
                aria-pressed={decision === "bug"}
                onClick={() => decide("bug")}
                className={`min-h-12 w-full rounded-full bg-danger px-5 text-base font-semibold text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:hover:bg-danger @md:flex-1 dark:text-bg ${FOCUS} ${
                  decision !== null && decision !== "bug" ? "opacity-40" : ""
                }`}
              >
                Bug
              </button>
              <button
                type="button"
                disabled={decisionBusy || decision !== null}
                aria-pressed={decision === "not_bug"}
                onClick={() => decide("not_bug")}
                className={`min-h-12 w-full rounded-full border border-border bg-surface px-5 text-base font-semibold text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:hover:bg-surface @md:flex-1 ${FOCUS} ${
                  decision !== null && decision !== "not_bug" ? "opacity-40" : ""
                }`}
              >
                Not a bug
              </button>
            </div>

            {/* The live region stays in the page so screen readers announce the change. */}
            <div role="status" aria-live="polite">
              {decisionBusy && <p className="px-1 text-sm text-muted">Wait...</p>}
              {decision && (
                <p className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-medium text-fg">
                  <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                  {decisionText(decision, decidedAt)}
                </p>
              )}
            </div>
            {decisionError && (
              <p className="px-1 text-sm text-danger" role="alert">
                {decisionError}
              </p>
            )}
          </div>

          {decision === "bug" && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4 text-muted" aria-hidden />
                Fix
              </h3>
              <div role="status" aria-live="polite" className="flex flex-col gap-3">
                {finding.level === "old_bug" ? (
                  <p className="text-sm text-muted">Production has this bug too. PinePoint proposes no fix.</p>
                ) : fixBusy ? (
                  <p className="text-sm text-muted">Claude writes the fix. This takes up to one minute.</p>
                ) : fix?.fix ? (
                  <FixCard stored={fix} fix={fix.fix} />
                ) : fix ? (
                  <>
                    <p className="text-sm">No fix inside the diff.</p>
                    {fix.reason && <p className="text-sm text-muted">{fix.reason}</p>}
                  </>
                ) : !fixError ? (
                  <p className="text-sm text-muted">The fix shows here.</p>
                ) : null}
              </div>
              {fixError && (
                <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
                  <p className="text-sm text-danger" role="alert">
                    {fixError}
                  </p>
                  <button
                    type="button"
                    onClick={() => requestFix(true)}
                    className={`min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 ${FOCUS}`}
                  >
                    Try again
                  </button>
                </div>
              )}
              {fix?.fix && finding.level === "bug" && (
                <div className="flex flex-col gap-2">
                  {postUrl ? (
                    <p className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-medium text-fg" role="status">
                      <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                      <span>
                        Posted.{" "}
                        <a
                          href={postUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 underline underline-offset-2 hover:text-accent ${FOCUS}`}
                        >
                          Open the suggestion
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={postBusy}
                      onClick={postFix}
                      className={`min-h-12 w-full rounded-full bg-accent px-5 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent ${FOCUS}`}
                    >
                      {postBusy ? "Wait..." : "Post to PR"}
                    </button>
                  )}
                  {postError && (
                    <p className="px-1 text-sm text-danger" role="alert">
                      {postError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <NoFinding status={missionStatus} note={note} reason={reason} failedChecks={failedChecks} />
      )}

      {viewer && (
        <ImageViewer
          items={viewer.items}
          start={viewer.start}
          label={viewer.label}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}

const NO_FINDING_TEXT: Partial<Record<MissionStatus, string>> = {
  queued: "This user has not started yet. A finding shows here when a check fails.",
  running: "This user is still testing. A finding shows here when a check fails.",
  passed: "Every check passed. There is no finding.",
  failed: "A check failed. There is no finding for it yet.",
  blocked: "This user could not finish. There is no finding.",
  error: "This user could not run. There is no finding.",
  needs_you: "The agent needs help. Take control to help it.",
};

// A mission with no finding: what it did, why it stopped, and the checks that failed.
function NoFinding({
  status,
  note,
  reason,
  failedChecks,
}: {
  status?: MissionStatus;
  note: string | null;
  reason: string | null;
  failedChecks: FailedCheckView[];
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="no-finding">
      <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
        {note ?? (status && NO_FINDING_TEXT[status]) ?? "This mission has no finding."}
      </p>
      {reason && <Tile label="Reason" text={reason} tone="plain" />}
      {failedChecks.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold">Checks that failed</h3>
          <ul role="list" className="flex list-none flex-col gap-3 text-sm">
            {failedChecks.map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5 break-words">
                <span className="font-medium">{c.name}</span>
                {c.expected && <span className="text-muted">Expected: {c.expected}</span>}
                {c.saw && <span className="text-muted">Saw: {c.saw}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// The fix: the file and the line range, the replacement, the explanation and the confidence.
function FixCard({ stored, fix: f }: { stored: StoredFix; fix: Fix }) {
  const range = f.startLine === f.endLine ? `line ${f.startLine}` : `lines ${f.startLine}-${f.endLine}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs break-all">{f.path}</code>
        <span className="text-muted">{range}</span>
      </p>
      <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed">
        <code>{f.replacement}</code>
      </pre>
      <p className="text-sm break-words">{f.explanation}</p>
      <p className="text-xs text-muted">
        Confidence: {f.confidence}. Model: {stored.model}.
      </p>
    </div>
  );
}

// Wraps the desktop or the last screen with a Full screen button. It uses the
// Fullscreen API, and falls back to a fixed full-window layer where the API is
// missing (for example iPhone Safari). Esc leaves full screen.
function FullScreenFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);
  const full = native || fallback;

  useEffect(() => {
    const sync = () => setNative(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!fallback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setFallback(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fallback]);

  async function toggle() {
    if (native) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (fallback) {
      setFallback(false);
      return;
    }
    const el = ref.current;
    if (el && document.fullscreenEnabled && el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        // Fall through to the fixed layer.
      }
    }
    setFallback(true);
  }

  return (
    <div
      ref={ref}
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col gap-3 bg-bg p-3 sm:p-5"
          : "relative flex flex-col gap-2"
      }
    >
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={full}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm text-fg transition-colors hover:border-accent hover:text-accent ${FOCUS}`}
        >
          {full ? (
            <Minimize2 className="h-4 w-4" aria-hidden />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden />
          )}
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <div className={full ? "flex min-h-0 flex-1 items-center justify-center" : ""}>
        <div
          className={
            full ? "w-full max-w-[calc((100dvh-6rem)*16/9)]" : "w-full"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function shotTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })} PT`;
}

// One step picture. A picture that does not load shows an icon, never a broken image.
function StepThumb({ step, onOpen }: { step: StepShotView; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const time = shotTime(step.at);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full flex-col gap-1.5 rounded-2xl text-left ${FOCUS}`}
    >
      {broken ? (
        <span className="flex aspect-video w-full items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
          <ImageOff className="h-5 w-5" aria-hidden />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={step.url}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="aspect-video w-full rounded-xl border border-border bg-surface-2 object-cover object-top transition-[filter] group-hover:brightness-95"
        />
      )}
      <span className="flex flex-col text-xs text-muted group-hover:text-fg">
        <span className="font-medium break-words text-fg">{step.title || "Picture"}</span>
        {time && <span className="tabular-nums">{time}</span>}
        <span className="sr-only"> (opens the picture viewer)</span>
      </span>
    </button>
  );
}

// Pine's picture of the screen after each step. Each one opens the picture viewer. The titles
// are Pine's step titles, so they are not numbered like the text steps.
function StepShots({
  steps,
  pending,
  onOpen,
}: {
  steps: StepShotView[];
  pending: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <section aria-labelledby="step-shots-title" className="flex flex-col gap-2" data-testid="step-shots">
      <h3 id="step-shots-title" className="text-sm font-semibold">
        Pictures of each step
      </h3>
      {steps.length > 0 ? (
        <ol role="list" className="grid list-none grid-cols-2 gap-3 @md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={`${i}-${step.url}`} className="min-w-0">
              <StepThumb step={step} onOpen={() => onOpen(i)} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
          {pending
            ? "Pictures of each step appear when this user finishes."
            : "PinePoint has no pictures of the steps for this user."}
        </p>
      )}
    </section>
  );
}

const LAST_CAPTION: Record<LastReason, string> = {
  ended: "The computer stopped when this user finished. This is the last screen.",
  gone: "The computer stopped. This is the last screen.",
  not_started: "The computer has not started yet.",
  no_computer: "The computer did not start for this user.",
  sample: "Sample data has no live computer. This is the last screen.",
};

const NO_PICTURE: Record<LastReason, string> = {
  ended: "The computer stopped when this user finished. There is no picture of the last screen.",
  gone: "The computer stopped. There is no picture of the last screen.",
  not_started: "The computer has not started yet.",
  no_computer: "The computer did not start for this user.",
  sample: "Sample data has no live computer.",
};

// The panel shows the last screen when there is no live desktop. It uses the first picture
// that loads: the last frame of the live screen, the mission screenshot, the finding screenshot.
function LastScreen({
  urls,
  reason,
  onOpen,
}: {
  urls: Array<string | null>;
  reason: LastReason;
  onOpen: (url: string) => void;
}) {
  const [broken, setBroken] = useState<string[]>([]);
  const url = urls.find((u): u is string => !!u && !broken.includes(u)) ?? null;

  if (!url) {
    return (
      <div
        className="flex aspect-video min-h-52 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 text-center text-sm text-muted"
        data-testid="last-screen"
      >
        <MonitorOff className="h-5 w-5" aria-hidden />
        {NO_PICTURE[reason]}
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2" data-testid="last-screen">
      <figcaption className="flex w-fit max-w-full items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
        <MonitorOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {LAST_CAPTION[reason]}
      </figcaption>
      <button
        type="button"
        onClick={() => onOpen(url)}
        aria-label="Expand the last screen"
        className={`group relative block w-full overflow-hidden rounded-2xl ${FOCUS}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Last screen of the mission computer"
          onError={() => setBroken((b) => [...b, url])}
          className="aspect-video w-full bg-surface-2 object-contain"
        />
        <ExpandHint />
      </button>
    </figure>
  );
}

function ExpandHint() {
  return (
    <span
      aria-hidden
      className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-xs font-medium text-fg opacity-90 transition-opacity group-hover:opacity-100"
    >
      <Expand className="h-3.5 w-3.5" />
      Expand
    </span>
  );
}

// The screen when the check failed. It shows whatever the desktop does, so the bug is always
// in view, and it opens in the picture viewer.
function BugScreen({ url, title, onOpen }: { url: string; title: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3" data-testid="bug-screen">
      <figcaption className="px-1 text-sm font-semibold">Bug screen</figcaption>
      {broken ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 text-center text-sm text-muted">
          <ImageOff className="h-5 w-5" aria-hidden />
          The bug picture did not load.
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Expand the bug screen: ${title}`}
          className={`group relative block w-full overflow-hidden rounded-xl ${FOCUS}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`The screen for: ${title}`}
            loading="lazy"
            onError={() => setBroken(true)}
            className="aspect-video w-full bg-surface-2 object-contain"
          />
          <ExpandHint />
        </button>
      )}
    </figure>
  );
}

function Tile({
  label,
  text,
  tone,
  className = "",
}: {
  label: string;
  text: string;
  tone: "plain" | "danger" | "soft";
  className?: string;
}) {
  const box =
    tone === "danger"
      ? "border-danger/25 bg-danger-soft"
      : tone === "soft"
        ? "border-border bg-surface-2"
        : "border-border bg-surface";
  const head = tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className={`rounded-2xl border p-4 ${box} ${className}`}>
      <h3 className={`mb-1.5 text-xs font-semibold tracking-wide uppercase ${head}`}>{label}</h3>
      <p className="text-sm break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}
