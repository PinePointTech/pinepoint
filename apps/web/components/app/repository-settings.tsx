"use client";

// The per-repository QA settings dialog (VI-34): the QA file path, the Vercel project of the
// preview, and the production URL for the old-bug comparison. Everyone with view access can read
// them; maintainers and admins can save (docs/github-access-contract.md decision 5).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getRepositorySettings, saveRepositorySettings } from "@/lib/app-api";
import type { RepositorySettingsView, RepositoryView } from "@/lib/app-types";
import { Spinner } from "./progress";

const field =
  "w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-ring/30 read-only:opacity-70";

export function RepositorySettingsDialog({
  repository,
  onClose,
  onNotice,
}: {
  repository: RepositoryView;
  onClose: () => void;
  onNotice: (notice: { tone: "info" | "error"; text: string } | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<RepositorySettingsView | null>(null);
  const [qaMdPath, setQaMdPath] = useState("");
  const [project, setProject] = useState("");
  const [production, setProduction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let stop = false;
    getRepositorySettings(repository.id)
      .then((s) => {
        if (stop) return;
        setSettings(s);
        setQaMdPath(s.qaMdPath);
        setProject(s.previewProjectName ?? "");
        setProduction(s.productionUrl ?? "");
      })
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [repository.id]);

  const readOnly = !settings?.canConfigure;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveRepositorySettings(repository.id, {
        qaMdPath: qaMdPath.trim(),
        previewProjectName: project.trim() || null,
        productionUrl: production.trim() || null,
      });
      onNotice({ tone: "info", text: `Settings for ${repository.fullName} saved.` });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label={`Settings for ${repository.fullName}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-[20px] bg-bg p-6 text-fg shadow-2xl backdrop:bg-fg/15"
    >
      <form onSubmit={onSave} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">{repository.fullName}</h2>
            <p className="text-sm text-muted">{readOnly ? "Only maintainers and admins can change these." : "How PinePoint tests this repository."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-muted hover:text-fg" aria-label="Close">
            <X className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {!settings && !error && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> Loading.
          </p>
        )}

        {settings && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">QA instructions file</span>
              <input value={qaMdPath} onChange={(e) => setQaMdPath(e.target.value)} readOnly={readOnly} placeholder="qa.md" className={field} />
              <span className="text-xs text-muted">Relative to the repository root. Read at the PR head, or at the base for a PR from a fork.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Vercel project of the preview</span>
              <input value={project} onChange={(e) => setProject(e.target.value)} readOnly={readOnly} placeholder="any non-production deployment" className={field} />
              <span className="text-xs text-muted">The name in the deployment environment, for example &quot;Preview – my-app&quot;. Empty takes any preview.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Production URL</span>
              <input value={production} onChange={(e) => setProduction(e.target.value)} readOnly={readOnly} type="url" placeholder="https://" className={field} />
              <span className="text-xs text-muted">For the old-bug check. https and a public host only. Empty skips it.</span>
            </label>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        {!readOnly && settings && (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" aria-disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-fg hover:bg-accent-hover aria-disabled:opacity-60">
              {saving && <Spinner className="size-4" />}
              Save
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
