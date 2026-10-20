// Per-repository QA settings (VI-34, docs/github-access-contract.md section 3): where the QA file
// lives, which Vercel project is the preview, and the production URL. Defaults apply until a
// maintainer saves any. Server code only.

import { DEFAULT_REPOSITORY_SETTINGS, sql, type RepositorySettingsRow } from "@pinepoint/core";
import type { RepoQaConfig } from "./context";
import { validateTargetUrl } from "./preview";

export type RepositorySettings = Pick<RepositorySettingsRow, "qa_md_path" | "preview_project_name" | "production_url">;

export async function loadRepositorySettings(repositoryId: string): Promise<RepositorySettingsRow | null> {
  const rows = (await sql()`select * from repository_settings where repository_id = ${repositoryId}`) as RepositorySettingsRow[];
  return rows[0] ?? null;
}

/** The settings, or the defaults when none were saved. */
export async function repositorySettingsOrDefault(repositoryId: string): Promise<RepositorySettings> {
  const row = await loadRepositorySettings(repositoryId);
  return row
    ? { qa_md_path: row.qa_md_path, preview_project_name: row.preview_project_name, production_url: row.production_url }
    : { ...DEFAULT_REPOSITORY_SETTINGS };
}

/** What getPrContext and the preview check need, from the settings. */
export function toQaConfig(s: RepositorySettings): RepoQaConfig {
  return { qaMdPath: s.qa_md_path, previewProjectName: s.preview_project_name, productionUrl: s.production_url };
}

export async function repoQaConfigFor(repositoryId: string): Promise<RepoQaConfig> {
  return toQaConfig(await repositorySettingsOrDefault(repositoryId));
}

export type SettingsVerdict = { ok: true; value: RepositorySettings } | { ok: false; error: string };

/** A repository-relative file path: no leading slash, no "..", no backslash, no control characters. */
export function validateQaPath(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "qaMdPath must be a string." };
  const path = raw.trim();
  if (!path) return { ok: false, error: "qaMdPath cannot be empty." };
  if (path.length > 200) return { ok: false, error: "qaMdPath is too long." };
  if (path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return { ok: false, error: "qaMdPath must be a relative path." };
  if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return { ok: false, error: "qaMdPath cannot contain empty, . or .. segments." };
  return { ok: true, value: path };
}

/** A Vercel project name as it appears in the deployment environment ("Preview – name"). */
export function validateProjectName(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "previewProjectName must be a string." };
  const name = raw.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)) return { ok: false, error: "previewProjectName has characters Vercel does not allow." };
  return { ok: true, value: name };
}

/** Validates a settings body. Pure. */
export function validateSettings(body: unknown): SettingsVerdict {
  const b = (body ?? {}) as Record<string, unknown>;
  const path = validateQaPath(b.qaMdPath ?? DEFAULT_REPOSITORY_SETTINGS.qa_md_path);
  if (!path.ok) return path;
  const project = validateProjectName(b.previewProjectName);
  if (!project.ok) return project;
  let production: string | null = null;
  if (b.productionUrl !== null && b.productionUrl !== undefined && b.productionUrl !== "") {
    if (typeof b.productionUrl !== "string") return { ok: false, error: "productionUrl must be a string." };
    const verdict = validateTargetUrl(b.productionUrl);
    if (!verdict.ok) return { ok: false, error: `productionUrl: ${verdict.reason}` };
    production = verdict.url;
  }
  return { ok: true, value: { qa_md_path: path.value, preview_project_name: project.value, production_url: production } };
}

export async function saveRepositorySettings(repositoryId: string, value: RepositorySettings, userId: string): Promise<RepositorySettingsRow> {
  const rows = (await sql()`
    insert into repository_settings (repository_id, qa_md_path, preview_project_name, production_url, updated_by_user_id)
    values (${repositoryId}, ${value.qa_md_path}, ${value.preview_project_name}, ${value.production_url}, ${userId})
    on conflict (repository_id) do update set
      qa_md_path = excluded.qa_md_path, preview_project_name = excluded.preview_project_name,
      production_url = excluded.production_url, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    returning *
  `) as RepositorySettingsRow[];
  return rows[0]!;
}
