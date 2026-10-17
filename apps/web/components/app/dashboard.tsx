"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { History, Play } from "lucide-react";
import { createRun, formatCost, getRunStatus, listRuns } from "@/lib/app-api";
import {
  TERMINAL_RUN_STATUSES,
  type Run,
  type StatusResponse,
} from "@/lib/app-types";
import { MissionTile } from "./mission-tile";
import { SessionPanelSlot } from "./session-panel-slot";
import { findingFor } from "./tile-state";

const POLL_MS = 3000;

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  planning: "Planning",
  running: "Running",
  reporting: "Reporting",
  done: "Done",
  failed: "Failed",
  no_preview: "No preview",
};

export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fake = params.get("fake") === "1";
  const runId = params.get("run");
  const findingParam = params.get("finding");

  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [missionId, setMissionId] = useState<string | null>(null);
  // A shared ?finding= link opens a finished run. Fake data skips the wait.
  const [complete] = useState(() => findingParam !== null);

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const refreshRuns = useCallback(() => {
    listRuns({ fake })
      .then((r) => setRuns(r.runs.slice(0, 10)))
      .catch((e: Error) => setError(`Cannot load runs: ${e.message}`));
  }, [fake]);

  useEffect(refreshRuns, [refreshRuns]);

  // Poll the open run every 3 seconds until it ends.
  useEffect(() => {
    if (!runId) {
      setStatus(null);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await getRunStatus(runId, { fake, complete });
        if (stop) return;
        setStatus(s);
        setError(null);
        if (TERMINAL_RUN_STATUSES.includes(s.run.status)) {
          refreshRuns();
          return;
        }
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
  }, [runId, fake, complete, refreshRuns]);

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    const url = prUrl.trim();
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) {
      setError("Type a GitHub PR URL, for example https://github.com/owner/repo/pull/1.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await createRun(url, { fake });
      setStatus(null);
      setMissionId(null);
      setQuery({ run: res.runId, finding: null, fake: fake || res.fake ? "1" : null });
      refreshRuns();
    } catch (err) {
      setError(`Cannot start the run: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  function openRun(id: string) {
    setMissionId(null);
    setQuery({ run: id, finding: null });
  }

  const findings = status?.findings ?? [];
  const openFinding = findings.find((f) => f.id === findingParam);
  const panelMissionId = missionId ?? openFinding?.mission_ids?.[0] ?? null;
  const panelOpen = status !== null && (panelMissionId !== null || openFinding !== undefined);

  function openMission(id: string) {
    const mission = status?.missions.find((m) => m.id === id);
    const f = mission ? findingFor(mission, findings) : undefined;
    setMissionId(id);
    setQuery({ finding: f?.id ?? null });
  }

  function closePanel() {
    setMissionId(null);
    setQuery({ finding: null });
  }

  const missions = status?.missions ?? [];
  const ended = missions.filter((m) => m.finished_at !== null).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <aside className="md:w-64 md:shrink-0">
        <Link href="/" className="text-xl font-semibold text-pine-900 dark:text-pine-50">
          PinePoint
        </Link>
        <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          <History className="h-4 w-4" />
          Last runs
        </h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">No runs yet.</p>
        ) : (
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            {runs.map((r) => (
              <li key={r.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => openRun(r.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800 ${
                    r.id === runId
                      ? "bg-pine-50 font-medium text-pine-900 dark:bg-pine-900/40 dark:text-pine-50"
                      : ""
                  }`}
                >
                  <span className="block">
                    {r.repo} #{r.pr_number}
                  </span>
                  <span className="block text-xs text-stone-500 dark:text-stone-400">
                    {RUN_STATUS_LABEL[r.status] ?? r.status}
                    {r.started_at ? ` / ${new Date(r.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <form onSubmit={onRun} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="pr-url" className="sr-only">
            PR URL
          </label>
          <input
            id="pr-url"
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/1"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-pine-600 focus:ring-2 focus:ring-pine-600/30 dark:border-stone-700 dark:bg-stone-900"
          />
          <button
            type="submit"
            disabled={starting}
            className="flex items-center justify-center gap-1 rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pine-900 disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            {starting ? "Starting" : "Run"}
          </button>
        </form>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        {!runId && (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Type a PR URL and click Run, or open a run from the list.
          </p>
        )}

        {runId && !status && !error && (
          <p className="text-sm text-stone-600 dark:text-stone-300">Loading the run.</p>
        )}

        {status && (
          <>
            <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-xl font-semibold text-pine-900 dark:text-pine-50">
                <a href={status.run.pr_url} target="_blank" rel="noreferrer" className="hover:underline">
                  {status.run.owner}/{status.run.repo} #{status.run.pr_number}
                </a>
              </h1>
              <span data-testid="run-status" className="text-sm text-stone-600 dark:text-stone-300">
                {RUN_STATUS_LABEL[status.run.status] ?? status.run.status}
                {missions.length > 0 ? ` / ${ended} of ${missions.length} missions end` : ""}
              </span>
            </section>

            {status.run.status === "no_preview" && (
              <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">
                This PR has no preview URL. PinePoint cannot test it.
              </p>
            )}

            {missions.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  Missions
                </h2>
                <ol className="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
                  {missions.map((m, i) => (
                    <li key={m.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                      <span className="shrink-0 text-stone-400 sm:w-6">{i + 1}</span>
                      <span className="shrink-0 font-medium sm:w-32">{m.lens}</span>
                      <span className="shrink-0 text-stone-600 dark:text-stone-300 sm:w-48">{m.persona}</span>
                      <span className="min-w-0">{m.goal}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {panelOpen && (
              <SessionPanelSlot
                runId={status.run.id}
                missionId={panelMissionId}
                findingId={openFinding?.id ?? null}
                onClose={closePanel}
                status={status}
              />
            )}

            {missions.length > 0 && (
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {missions.map((m) => (
                  <MissionTile
                    key={m.id}
                    mission={m}
                    finding={findingFor(m, findings)}
                    selected={m.id === panelMissionId}
                    onOpen={() => openMission(m.id)}
                  />
                ))}
              </section>
            )}

            <p data-testid="run-cost" className="text-sm text-stone-600 dark:text-stone-300">
              Cost of this run: {formatCost(status.run.cost_usd)}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
