// GET and PUT /api/repositories/[id]/settings (VI-34): where the QA file lives, which Vercel
// project is the preview, and the production URL. Reading needs view access; saving needs
// configure (maintain or admin on GitHub, docs/github-access-contract.md decision 5). The
// production URL goes through the same URL policy as a preview: https, a public host.

import { loadRepositorySettings, repositorySettingsOrDefault, saveRepositorySettings, validateSettings } from "@pinepoint/github/settings";
import { authorizeRepository, recordAction } from "@/lib/access";
import { rejectCrossSite } from "@/lib/auth/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "private, no-store" };

function view(s: { qa_md_path: string; preview_project_name: string | null; production_url: string | null }, canConfigure: boolean, updatedAt: string | null) {
  return { qaMdPath: s.qa_md_path, previewProjectName: s.preview_project_name, productionUrl: s.production_url, canConfigure, updatedAt };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "No repository with this id." }, { status: 404, headers: NO_STORE });
  const guarded = await authorizeRepository(request, id, "view");
  if (!guarded.ok) return guarded.response;
  const row = await loadRepositorySettings(id);
  const settings = row ?? (await repositorySettingsOrDefault(id));
  return Response.json({ settings: view(settings, guarded.value.access.canConfigure, row?.updated_at ?? null) }, { headers: NO_STORE });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "No repository with this id." }, { status: 404, headers: NO_STORE });
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const guarded = await authorizeRepository(request, id, "configure", { fresh: true });
  if (!guarded.ok) return guarded.response;
  const body = await request.json().catch(() => null);
  const verdict = validateSettings(body);
  if (!verdict.ok) return Response.json({ ok: false, error: verdict.error }, { status: 400, headers: NO_STORE });
  const saved = await saveRepositorySettings(id, verdict.value, guarded.value.session.user.id);
  void recordAction({ action: "settings_update", userId: guarded.value.session.user.id, detail: { repositoryId: id, ...verdict.value } });
  return Response.json({ ok: true, settings: view(saved, true, saved.updated_at) }, { headers: NO_STORE });
}
