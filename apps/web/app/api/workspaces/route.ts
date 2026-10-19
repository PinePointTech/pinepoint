// GET /api/workspaces: the organizations and accounts this person can see the app installed on,
// split into connected (we have the rows) and not yet connected (GitHub lists it, we never
// received the callback or the webhook). Needs a session. The install URL for a new one is
// /api/github/install.

import { githubAppConfigured } from "@pinepoint/github/app";
import { listWorkspacesForUser } from "@pinepoint/github/installations";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import { requireUser } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user.ok) return user.response;
  if (!githubAppConfigured()) {
    return Response.json({ connected: [], unconnected: [], installAvailable: false }, { headers: NO_STORE });
  }
  try {
    const gh = await octokitForUser(user.value.user.id);
    const { connected, unconnected } = await listWorkspacesForUser(gh);
    return Response.json(
      {
        connected: connected.map((w) => ({
          id: w.id,
          login: w.account_login,
          type: w.account_type,
          installationStatus: w.installation_status,
          repositoryCount: w.repository_count,
        })),
        unconnected,
        installAvailable: true,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof ReauthorizeError) {
      return Response.json({ ok: false, error: err.message, state: "reauthorize" }, { status: 403, headers: NO_STORE });
    }
    console.error("[workspaces] list failed", { error: (err as Error)?.name, status: (err as { status?: number })?.status });
    return Response.json({ ok: false, error: "Could not list your organizations." }, { status: 502, headers: NO_STORE });
  }
}
