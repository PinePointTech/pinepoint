// GET /api/workspaces/[id]/repositories: the selected repositories of a connected workspace with
// this person's access to each (docs/github-access-contract.md section 5). Repositories the person
// cannot view are left out, the same as GitHub would hide them. A workspace the person has no
// repository in answers an empty list, not 404: they can see the installation on GitHub.

import { listWorkspaceRepositories } from "@pinepoint/github/installations";
import { requireUser } from "@/lib/access";
import { repositoriesWithAccess } from "@/lib/visible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "No workspace with this id." }, { status: 404, headers: NO_STORE });
  const user = await requireUser(request);
  if (!user.ok) return user.response;
  const repositories = await repositoriesWithAccess(user.value.user.id, await listWorkspaceRepositories(id));
  return Response.json(
    {
      repositories: repositories
        .filter((r) => r.access.canView || r.access.state === "reauthorize" || r.access.state === "sso_required" || r.access.state === "rate_limited")
        .map((r) => ({
          id: r.repository.id,
          fullName: r.repository.full_name,
          name: r.repository.name,
          owner: r.repository.owner_login,
          private: r.repository.private,
          defaultBranch: r.repository.default_branch,
          access: { level: r.access.level, state: r.access.state, reason: r.access.reason, canLaunch: r.access.canLaunch, canConfigure: r.access.canConfigure },
        })),
    },
    { headers: NO_STORE },
  );
}
