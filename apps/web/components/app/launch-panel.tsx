"use client";

// The launch form of the dashboard (VI-35, docs/github-access-contract.md sections 5, 6 and 8).
//
// Signed out: the public demo form, a PR URL and Run, as before.
// Signed in: pick an organization, a repository you can write to, and an open PR (or paste its
// URL). The preflight card then shows the access, the preview, the QA file and the quota, and
// Run QA is enabled only when nothing blocks. The launch pins the PR head the preflight saw.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, ChevronDown, Lock, Play, Settings2 } from "lucide-react";
import { ApiError, getMe, installHref, listPulls, listRepositories, listWorkspaces, preflight, signInHref } from "@/lib/app-api";
import type { CreateRunRequest, MeResponse, PreflightResponse, PullView, RepositoryView, WorkspaceView } from "@/lib/app-types";
import { Spinner } from "./progress";
import { RepositorySettingsDialog } from "./repository-settings";

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
export const PR_URL_HINT = "Type a GitHub PR URL, for example https://github.com/owner/repo/pull/1.";

export interface LaunchRequest {
  request: CreateRunRequest;
  /** The card title while the run starts. */
  title: string;
}

interface Props {
  /** True while a run is starting; the controls go read-only. */
  busy: boolean;
  /** Where sign-in and install return to. */
  returnTo: string;
  onLaunch: (req: LaunchRequest) => void;
  onNotice: (notice: { tone: "info" | "error"; text: string } | null) => void;
  /** Bumped when the server said the head moved, so the preflight runs again. */
  refreshKey: number;
}

const field =
  "min-w-0 rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-ring/30 aria-disabled:opacity-60";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-accent";
const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-accent hover:text-accent";

function Select<T extends { key: string; label: string; disabled?: boolean; hint?: string }>({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: T[];
  placeholder: string;
  disabled?: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${field} w-full appearance-none pr-10 disabled:opacity-60`}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.key} value={o.key} disabled={o.disabled} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} aria-hidden />
      </span>
    </label>
  );
}

function Line({ ok, text, warn }: { ok: boolean; text: string; warn?: boolean }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const tone = ok ? "text-accent" : warn ? "text-amber-700 dark:text-amber-300" : "text-danger";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 break-words">{text}</span>
    </li>
  );
}

function PreflightCard({ p }: { p: PreflightResponse }) {
  const previewLabel: Record<PreflightResponse["preview"]["state"], string> = {
    ready: "The preview answers.",
    building: "The preview is still building. Wait for Vercel, then look again.",
    failed: "The preview deployment failed. Fix the build first.",
    missing: "No preview deployment for this commit yet.",
    protected: "The preview is protected (Vercel Authentication or a password). PinePoint cannot test a protected preview in this version.",
    unreachable: "The preview did not answer.",
    unsafe: "The preview URL is not one PinePoint will open.",
  };
  const full = p.quota.filter((q) => q.used >= q.limit);
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3" data-testid="preflight">
      <p className="text-sm font-semibold">
        #{p.pr.number} {p.pr.title}
        <span className="ml-2 font-normal text-muted">
          {p.pr.headRef} @ {p.pr.headSha.slice(0, 7)}
          {p.pr.draft ? " / draft" : ""}
          {p.pr.isFork ? " / from a fork" : ""}
        </span>
      </p>
      <ul className="mt-2 space-y-1.5">
        <Line ok={p.access.canLaunch} text={p.access.canLaunch ? `You can launch QA here (${p.access.level}).` : p.access.reason || "You cannot launch QA on this repository."} />
        <Line ok={p.pr.state === "open"} text={p.pr.state === "open" ? "The pull request is open." : "The pull request is closed."} />
        <Line ok={p.preview.state === "ready"} text={previewLabel[p.preview.state] ?? p.preview.note} />
        <Line ok={p.qaFile.exists} warn text={p.qaFile.exists ? `QA instructions: ${p.qaFile.path}.` : p.qaFile.note} />
        <Line
          ok={full.length === 0}
          text={
            full.length === 0
              ? `Capacity: ${p.quota.map((q) => `${q.scope.replace("_", " ")} ${q.used}/${q.limit}`).join(", ")}.`
              : `No room right now: ${full.map((q) => `${q.scope.replace("_", " ")} ${q.used}/${q.limit}`).join(", ")}. Wait for a run to end.`
          }
        />
      </ul>
      {p.pr.isFork && (
        <p className="mt-2 text-xs text-muted">
          For a PR from a fork, PinePoint reads the QA file from the base branch and does not read the fork&apos;s secrets.
        </p>
      )}
    </div>
  );
}

export function LaunchPanel({ busy, returnTo, onLaunch, onNotice, refreshKey }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [repositories, setRepositories] = useState<RepositoryView[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [pulls, setPulls] = useState<PullView[]>([]);
  const [prNumber, setPrNumber] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [check, setCheck] = useState<{ state: "idle" } | { state: "loading" } | { state: "done"; p: PreflightResponse } | { state: "error"; text: string }>({ state: "idle" });
  const [loading, setLoading] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fail = useCallback(
    (what: string, err: unknown) => {
      const e = err as ApiError;
      if (e instanceof ApiError && e.state === "reauthorize") {
        onNotice({ tone: "error", text: "GitHub no longer accepts your sign-in. Continue with GitHub again." });
        return;
      }
      onNotice({ tone: "error", text: `${what}: ${e?.message ?? String(err)}` });
    },
    [onNotice],
  );

  useEffect(() => {
    let stop = false;
    getMe()
      .then((m) => !stop && setMe(m))
      .catch(() => !stop && setMe({ user: null, signInAvailable: false }));
    return () => {
      stop = true;
    };
  }, []);

  const signedIn = Boolean(me?.user);

  useEffect(() => {
    if (!signedIn) return;
    let stop = false;
    setLoading("workspaces");
    listWorkspaces()
      .then((w) => {
        if (stop) return;
        setWorkspaces(w.connected);
        if (w.connected.length === 1) setWorkspaceId(w.connected[0]!.id);
      })
      .catch((e) => !stop && fail("Cannot list your organizations", e))
      .finally(() => !stop && setLoading(null));
    return () => {
      stop = true;
    };
  }, [signedIn, fail]);

  useEffect(() => {
    setRepositories([]);
    setRepositoryId("");
    if (!workspaceId) return;
    let stop = false;
    setLoading("repositories");
    listRepositories(workspaceId)
      .then((r) => {
        if (stop) return;
        setRepositories(r.repositories);
        const launchable = r.repositories.filter((x) => x.access.canLaunch);
        if (launchable.length === 1) setRepositoryId(launchable[0]!.id);
      })
      .catch((e) => !stop && fail("Cannot list the repositories", e))
      .finally(() => !stop && setLoading(null));
    return () => {
      stop = true;
    };
  }, [workspaceId, fail]);

  useEffect(() => {
    setPulls([]);
    setPrNumber("");
    setCheck({ state: "idle" });
    if (!repositoryId) return;
    let stop = false;
    setLoading("pulls");
    listPulls(repositoryId)
      .then((p) => !stop && setPulls(p.pulls))
      .catch((e) => !stop && fail("Cannot list the pull requests", e))
      .finally(() => !stop && setLoading(null));
    return () => {
      stop = true;
    };
  }, [repositoryId, fail]);

  const repository = repositories.find((r) => r.id === repositoryId) ?? null;

  // A pasted URL in the signed-in form picks the PR of the chosen repository.
  const pastedNumber = useMemo(() => {
    const m = PR_URL.exec(prUrl.trim());
    if (!m || !repository) return null;
    if (m[1]!.toLowerCase() !== repository.owner.toLowerCase() || m[2]!.toLowerCase() !== repository.name.toLowerCase()) return null;
    return Number(m[3]);
  }, [prUrl, repository]);

  const chosenNumber = prNumber ? Number(prNumber) : pastedNumber;

  useEffect(() => {
    if (!repositoryId || !chosenNumber) {
      setCheck({ state: "idle" });
      return;
    }
    let stop = false;
    setCheck({ state: "loading" });
    preflight(repositoryId, chosenNumber)
      .then((p) => !stop && setCheck({ state: "done", p }))
      .catch((e: ApiError) => {
        if (stop) return;
        if (e.state === "reauthorize") fail("Preflight", e);
        setCheck({ state: "error", text: e.message });
      });
    return () => {
      stop = true;
    };
  }, [repositoryId, chosenNumber, refreshKey, fail]);

  function submitDemo(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const url = prUrl.trim();
    const m = PR_URL.exec(url);
    if (!m) {
      onNotice({ tone: "error", text: PR_URL_HINT });
      return;
    }
    onLaunch({ request: { prUrl: url }, title: `${m[1]}/${m[2]} #${m[3]}` });
  }

  function submitPrivate(e: React.FormEvent) {
    e.preventDefault();
    if (busy || check.state !== "done" || !check.p.canRun || !repository) return;
    onLaunch({
      request: { repositoryId: repository.id, prNumber: check.p.pr.number, expectedHeadSha: check.p.pr.headSha },
      title: `${repository.fullName} #${check.p.pr.number}`,
    });
  }

  if (!me) return <div className="h-12" aria-hidden />;

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-3">
        <form onSubmit={submitDemo} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="pr-url" className="sr-only">
            PR URL
          </label>
          {/* readOnly and aria-disabled, not disabled: a disabled control drops the focus to the body. */}
          <input
            id="pr-url"
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            readOnly={busy}
            aria-disabled={busy}
            placeholder="https://github.com/owner/repo/pull/1"
            className={`${field} flex-1`}
          />
          <button type="submit" aria-disabled={busy} className={primary}>
            {busy ? <Spinner className="size-4" /> : <Play className="size-4" strokeWidth={2} aria-hidden />}
            {busy ? "Starting" : "Run"}
          </button>
        </form>
        {me.signInAvailable && (
          <p className="text-sm text-muted">
            This form tests the public demo.{" "}
            <a href={signInHref(returnTo)} className="font-semibold text-accent hover:underline">
              Continue with GitHub
            </a>{" "}
            to run QA on your own organization&apos;s pull requests.
          </p>
        )}
      </div>
    );
  }

  const wsOptions = workspaces.map((w) => ({
    key: w.id,
    label: `${w.login}${w.installationStatus === "suspended" ? " (suspended)" : ""}`,
    disabled: w.installationStatus !== "active",
  }));
  const repoOptions = repositories.map((r) => ({
    key: r.id,
    label: `${r.name}${r.access.canLaunch ? "" : ` (${r.access.state === "read_only" ? "read only" : r.access.state.replace("_", " ")})`}`,
    disabled: !r.access.canLaunch,
    hint: r.access.reason || undefined,
  }));
  const prOptions = pulls.map((p) => ({
    key: String(p.number),
    label: `#${p.number} ${p.title}${p.draft ? " (draft)" : ""}`,
  }));
  const canRun = check.state === "done" && check.p.canRun && !busy;

  return (
    <form onSubmit={submitPrivate} className="flex flex-col gap-4" aria-busy={loading !== null}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Select id="workspace" label="Organization" value={workspaceId} options={wsOptions} placeholder={loading === "workspaces" ? "Loading" : workspaces.length === 0 ? "None connected yet" : "Pick one"} disabled={busy} onChange={setWorkspaceId} />
        <Select id="repository" label="Repository" value={repositoryId} options={repoOptions} placeholder={loading === "repositories" ? "Loading" : !workspaceId ? "Pick an organization first" : repositories.length === 0 ? "No repositories you can see" : "Pick one"} disabled={busy || !workspaceId} onChange={setRepositoryId} />
        <Select id="pull" label="Open pull request" value={prNumber} options={prOptions} placeholder={loading === "pulls" ? "Loading" : !repositoryId ? "Pick a repository first" : pulls.length === 0 ? "No open pull requests" : "Pick one"} disabled={busy || !repositoryId} onChange={setPrNumber} />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="pr-url" className="sr-only">
          Or paste a PR URL
        </label>
        <input
          id="pr-url"
          type="url"
          value={prUrl}
          onChange={(e) => {
            setPrUrl(e.target.value);
            if (e.target.value) setPrNumber("");
          }}
          readOnly={busy || !repositoryId}
          aria-disabled={busy || !repositoryId}
          placeholder={repository ? `or paste a PR URL in ${repository.fullName}` : "or paste a PR URL after picking a repository"}
          className={`${field} flex-1`}
        />
        <button type="submit" aria-disabled={!canRun} className={primary} title={canRun ? "" : "Pick a pull request and clear every blocker first."}>
          {busy ? <Spinner className="size-4" /> : <Play className="size-4" strokeWidth={2} aria-hidden />}
          {busy ? "Starting" : "Run QA"}
        </button>
      </div>

      {check.state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> Checking the pull request, the preview and your access.
        </p>
      )}
      {check.state === "error" && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {check.text}
        </p>
      )}
      {check.state === "done" && <PreflightCard p={check.p} />}

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <a href={installHref(returnTo)} className={pill}>
          <Building2 className="size-4" strokeWidth={1.75} aria-hidden />
          Connect an organization
        </a>
        {repository && (
          <button type="button" onClick={() => setSettingsOpen(true)} className={pill} aria-disabled={!repository.access.canConfigure} title={repository.access.canConfigure ? "" : "Maintainers and admins can change these."}>
            {repository.access.canConfigure ? <Settings2 className="size-4" strokeWidth={1.75} aria-hidden /> : <Lock className="size-4" strokeWidth={1.75} aria-hidden />}
            Repository settings
          </button>
        )}
        <span>Runs start only from this button. Nothing starts from a push or a webhook.</span>
      </div>

      {settingsOpen && repository && <RepositorySettingsDialog repository={repository} onClose={() => setSettingsOpen(false)} onNotice={onNotice} />}
    </form>
  );
}
