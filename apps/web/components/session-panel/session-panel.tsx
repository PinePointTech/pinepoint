"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Hand, Maximize2, Minimize2, MonitorOff, Wrench, X } from "lucide-react";
import type { Decision, DesktopStatus, FindingView, SessionPanelProps, StepShotView } from "./types";

// The desktop SDK uses browser APIs. Load it only in the browser.
const LiveDesktop = dynamic(() => import("./live-desktop"), {
  ssr: false,
  loading: () => <SoftBox text="The desktop is starting." />,
});

const IDLE_MS = 15 * 60 * 1000;

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
  onClose,
  fake = false,
}: SessionPanelProps) {
  const [desktop, setDesktop] = useState<DesktopStatus>("starting");
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

  // A new mission asks for its own desktop.
  useEffect(() => {
    setDesktop("starting");
    setControl("view");
    setControlError(null);
  }, [missionId]);

  // Sample data has no Pine computer. A failed or stopped desktop has no live view.
  const live = !fake && desktop === "live";
  const ended = fake || desktop === "ended";

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

  const onDesktopStatus = useCallback((status: "live" | "ended") => {
    setDesktop(status);
    if (status === "ended") {
      // Nobody can drive a desktop that is gone.
      setControl("view");
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
  const lastScreen = lastScreenshotUrl ?? finding?.screenshot_url ?? null;

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
        {ended ? (
          <LastScreen url={lastScreen} />
        ) : (
          <LiveDesktop
            missionId={missionId}
            control={control}
            onInput={onInput}
            onStatus={onDesktopStatus}
          />
        )}
      </FullScreenFrame>

      {steps.length > 0 && <StepShots steps={steps} />}

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
            <div className="rounded-2xl border border-dashed border-border bg-surface p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4 text-muted" aria-hidden />
                Fix
              </h3>
              <p className="text-sm text-muted">The fix shows here.</p>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
          This mission has no finding.
        </p>
      )}
    </section>
  );
}

function SoftBox({ text }: { text: string }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-surface-2 px-4 text-center text-sm text-muted">
      {text}
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

// Pine's picture of the screen after each step. Each one links to the full image in Vercel Blob.
function StepShots({ steps }: { steps: StepShotView[] }) {
  return (
    <section aria-labelledby="step-shots-title" className="flex flex-col gap-2">
      <h3 id="step-shots-title" className="text-sm font-semibold">
        Screens at each step
      </h3>
      <ol className="grid grid-cols-2 gap-3 @md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.url} className="min-w-0">
            <a
              href={step.url}
              target="_blank"
              rel="noreferrer"
              className={`group flex flex-col gap-1.5 rounded-2xl ${FOCUS}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={step.url}
                alt=""
                loading="lazy"
                className="aspect-video w-full rounded-xl border border-border bg-surface-2 object-cover object-top transition-[filter] group-hover:brightness-95"
              />
              <span className="text-xs text-muted group-hover:text-fg">
                <span className="font-medium text-fg">Step {i + 1}</span>
                {step.title ? `. ${step.title}` : ""}
                <span className="sr-only"> (opens the full picture in a new tab)</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

// The panel shows the last screen when there is no live desktop.
function LastScreen({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  if (!url || broken) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 text-center text-sm text-muted">
        <MonitorOff className="h-5 w-5" aria-hidden />
        No live computer for this mission.
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
        <MonitorOff className="h-3.5 w-3.5" aria-hidden />
        Live session ended. This is the last screen.
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Last screen of the mission computer"
        onError={() => setBroken(true)}
        className="aspect-video w-full rounded-2xl bg-surface-2 object-contain"
      />
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
