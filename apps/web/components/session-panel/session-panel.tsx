"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Hand, Wrench, X } from "lucide-react";
import { DesktopMessage } from "./live-desktop";
import type { Decision, FindingView, SessionPanelProps } from "./types";

// The desktop SDK uses browser APIs. Load it only in the browser.
const LiveDesktop = dynamic(() => import("./live-desktop"), {
  ssr: false,
  loading: () => <DesktopMessage text="The desktop is starting." />,
});

const IDLE_MS = 15 * 60 * 1000;

const LEVEL_TEXT: Record<FindingView["level"], string> = {
  bug: "Bug",
  possible: "Possible bug",
  old_bug: "Old bug",
};

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

export function SessionPanel({ runId, missionId, finding, onClose, fake = false }: SessionPanelProps) {
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

  async function changeControl(action: "take" | "release") {
    setControlBusy(true);
    setControlError(null);
    try {
      if (fake) await wait(300);
      else await postJson(`/api/missions/${encodeURIComponent(missionId)}/control`, { action });
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

  return (
    <section
      className="flex w-full flex-col gap-4 bg-white p-4 text-zinc-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100"
      aria-label="Session"
      data-run-id={runId}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {finding && (
            <p className="text-xs font-medium uppercase tracking-wide text-pine-600 dark:text-pine-50/70">
              {LEVEL_TEXT[finding.level] ?? finding.level}
            </p>
          )}
          <h2 className="text-lg font-semibold text-pine-900 sm:text-xl dark:text-pine-50">
            {finding?.title ?? "Session"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the panel"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {fake ? (
        finding?.screenshot_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={finding.screenshot_url}
            alt="Screenshot of the desktop at the bug"
            className="aspect-video w-full rounded-lg bg-zinc-200 object-contain dark:bg-zinc-800"
          />
        ) : (
          <DesktopMessage text="Sample desktop. The live desktop shows here." />
        )
      ) : (
        <LiveDesktop missionId={missionId} control={control} onInput={onInput} />
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm" aria-live="polite">
          {driving ? (
            <>
              <Hand className="h-4 w-4 text-pine-600" aria-hidden />
              You have control.
            </>
          ) : (
            <>
              <Bot className="h-4 w-4 text-zinc-500" aria-hidden />
              The agent has control.
            </>
          )}
        </p>
        <button
          type="button"
          disabled={controlBusy}
          onClick={() => changeControl(driving ? "release" : "take")}
          className="min-h-11 w-full rounded-md border border-pine-600 px-4 text-sm font-medium text-pine-900 hover:bg-pine-50 disabled:opacity-50 sm:w-auto dark:text-pine-50 dark:hover:bg-pine-900"
        >
          {controlBusy ? "Wait..." : driving ? "Release control" : "Take control"}
        </button>
      </div>
      {controlError && (
        <p className="text-sm text-red-700 dark:text-red-400" role="status">
          {controlError}
        </p>
      )}

      {finding ? (
        <>
          <div className="flex flex-col gap-3 text-sm">
            {finding.steps.length > 0 && (
              <div>
                <h3 className="mb-1 font-semibold">Steps</h3>
                <ol className="list-decimal space-y-1 pl-5">
                  {finding.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
            <Field label="Expected" text={finding.expected} />
            <Field label="Saw" text={finding.saw} />
            {finding.production_saw && <Field label="Production" text={finding.production_saw} />}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={decisionBusy || decision !== null}
              onClick={() => decide("bug")}
              className={`min-h-12 w-full rounded-md px-4 text-base font-semibold text-white disabled:cursor-not-allowed sm:flex-1 ${
                decision === "bug" ? "bg-red-700" : "bg-red-600 hover:bg-red-700"
              } ${decision !== null && decision !== "bug" ? "opacity-40" : ""}`}
            >
              Bug
            </button>
            <button
              type="button"
              disabled={decisionBusy || decision !== null}
              onClick={() => decide("not_bug")}
              className={`min-h-12 w-full rounded-md px-4 text-base font-semibold text-white disabled:cursor-not-allowed sm:flex-1 ${
                decision === "not_bug" ? "bg-pine-900" : "bg-pine-600 hover:bg-pine-900"
              } ${decision !== null && decision !== "not_bug" ? "opacity-40" : ""}`}
            >
              Not a bug
            </button>
          </div>
          {decisionBusy && <p className="text-sm">Wait...</p>}
          {decision && (
            <p className="flex items-center gap-2 text-sm font-medium" role="status">
              <Check className="h-4 w-4 text-pine-600" aria-hidden />
              {decisionText(decision, decidedAt)}
            </p>
          )}
          {decisionError && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {decisionError}
            </p>
          )}

          {decision === "bug" && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4" aria-hidden />
                Fix
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">The fix shows here.</p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">This computer has no finding.</p>
      )}
    </section>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold">{label}</h3>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}
