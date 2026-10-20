// GET /api/repositories/[id]/pulls: the open pull requests of a connected repository, read with
// the person's own token (VI-35). Needs view access. Up to 50, newest updated first.

import { loadRepositoryWithContext } from "@pinepoint/github/access";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import { authorizeRepository, notFound } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound("No repository with this id.");
  const guarded = await authorizeRepository(request, id, "view");
  if (!guarded.ok) return guarded.response;
  const repository = await loadRepositoryWithContext(id);
  if (!repository) return notFound("No repository with this id.");
  try {
    const gh = await octokitForUser(guarded.value.session.user.id);
    const { data } = await gh.pulls.list({ owner: repository.owner_login, repo: repository.name, state: "open", sort: "updated", direction: "desc", per_page: 50 });
    return Response.json(
      {
        pulls: data.map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          author: pr.user?.login ?? "",
          draft: Boolean(pr.draft),
          headSha: pr.head.sha,
          headRef: pr.head.ref,
          isFork: pr.head.repo?.id !== undefined && pr.head.repo?.id !== pr.base.repo.id,
          updatedAt: pr.updated_at,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof ReauthorizeError) return Response.json({ ok: false, error: err.message, state: "reauthorize" }, { status: 403, headers: NO_STORE });
    console.error("[pulls] list failed", { repositoryId: id, status: (err as { status?: number })?.status });
    return Response.json({ ok: false, error: "Could not list the pull requests." }, { status: 502, headers: NO_STORE });
  }
}
