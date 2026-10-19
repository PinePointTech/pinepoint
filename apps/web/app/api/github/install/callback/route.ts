// GET /api/github/install/callback?installation_id=&setup_action=&state=: connect an installation
// (VI-31, docs/github-access-contract.md section 3).
//
// The installation id in the URL is not trusted on its own. It must exist on the app (read with
// the app JWT) and be one the signed-in person can see (GET /user/installations with their token):
// a guessed or pasted id connects nothing. setup_action=request means an organization member asked
// an owner to approve the installation; nothing exists yet, and the page says so. A missing or
// mismatched state still connects when the person is signed in and both checks pass, because
// GitHub also sends people here from the app's settings page without our state; the state only
// carries the return path then.

import { NextResponse } from "next/server";
import { githubAppConfigured } from "@pinepoint/github/app";
import { openSignInState, safeReturnTo } from "@pinepoint/github/oauth";
import { connectInstallation, listUserInstallationIds, readInstallation, verifyInstallationForUser } from "@pinepoint/github/installations";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import { recordAction } from "@/lib/access";
import { requestOrigin } from "@/lib/auth/csrf";
import { clearStateCookie, cookieValue, sessionOf, STATE_COOKIE } from "@/lib/auth/session";
import { withQuery } from "@/lib/auth/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(origin: string, returnTo: string, params: Record<string, string>): NextResponse {
  const res = NextResponse.redirect(`${origin}${withQuery(returnTo, params)}`);
  clearStateCookie(res);
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const query = new URL(request.url).searchParams;
  const state = openSignInState(cookieValue(request.headers.get("cookie"), STATE_COOKIE), query.get("state"));
  const returnTo = state?.purpose === "install" ? state.returnTo : safeReturnTo(null);

  if (!githubAppConfigured()) return back(origin, returnTo, { install: "not_configured" });
  const session = await sessionOf(request);
  if (!session) {
    // Sign in, then come back to this exact URL (minus nothing: the id and action are in the query).
    const here = withQuery("/api/github/install/callback", Object.fromEntries(query.entries()));
    return NextResponse.redirect(`${origin}${withQuery("/api/auth/github/start", { return_to: here })}`);
  }
  if (query.get("setup_action") === "request") return back(origin, returnTo, { install: "requested" });
  const installationId = Number(query.get("installation_id"));
  if (!Number.isInteger(installationId) || installationId <= 0) return back(origin, returnTo, { install: "bad_request" });

  try {
    const gh = await octokitForUser(session.user.id);
    const verdict = await verifyInstallationForUser(installationId, {
      readInstallation: (id) => readInstallation(id),
      userInstallationIds: () => listUserInstallationIds(gh),
    });
    if (!verdict.ok) {
      console.warn(`[install] installation ${installationId} refused: ${verdict.reason}`);
      return back(origin, returnTo, { install: verdict.reason });
    }
    const result = await connectInstallation(gh, verdict.facts);
    void recordAction({
      action: "workspace_connect",
      userId: session.user.id,
      detail: { workspaceId: result.workspace.id, installationId, repositories: result.repositories, status: result.installation.status },
    });
    return back(origin, returnTo, { install: "connected", workspace: result.workspace.id });
  } catch (err) {
    if (err instanceof ReauthorizeError) return back(origin, returnTo, { install: "reauthorize" });
    console.error("[install] connect failed", { error: (err as Error)?.name, status: (err as { status?: number })?.status });
    return back(origin, returnTo, { install: "github_error" });
  }
}
