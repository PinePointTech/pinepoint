// GET /api/github/install?return_to=: send a signed-in person to GitHub to install the app on an
// organization or account and pick repositories (VI-31). GitHub comes back to
// /api/github/install/callback with installation_id and our state. A person who is not signed in
// is sent through sign-in first and lands here again.

import { NextResponse } from "next/server";
import { githubAppConfigured, installUrl } from "@pinepoint/github/app";
import { newSignInState, safeReturnTo, sealSignInState, STATE_TTL_MS } from "@pinepoint/github/oauth";
import { requestOrigin } from "@/lib/auth/csrf";
import { sessionOf, setStateCookie } from "@/lib/auth/session";
import { withQuery } from "@/lib/auth/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"));
  if (!githubAppConfigured()) {
    return NextResponse.redirect(`${origin}${withQuery(returnTo, { auth_error: "not_configured" })}`);
  }
  const session = await sessionOf(request);
  if (!session) {
    const back = withQuery("/api/github/install", { return_to: returnTo });
    return NextResponse.redirect(`${origin}${withQuery("/api/auth/github/start", { return_to: back })}`);
  }
  const state = newSignInState(returnTo, "install");
  const res = NextResponse.redirect(installUrl(process.env.GITHUB_APP_SLUG!, state.state));
  setStateCookie(res, sealSignInState(state), Math.floor(STATE_TTL_MS / 1000));
  res.headers.set("cache-control", "no-store");
  return res;
}
