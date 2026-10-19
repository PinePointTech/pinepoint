// GET /api/auth/github/start?return_to=/app?...: begin "Continue with GitHub" (VI-30).
// Sets the encrypted state cookie (state, PKCE verifier, return path, expiry) and redirects to
// GitHub. Without a configured app it sends the person back with ?auth_error=not_configured.

import { NextResponse } from "next/server";
import { githubAppConfigured } from "@pinepoint/github/app";
import { authorizeUrl, newSignInState, safeReturnTo, sealSignInState, STATE_TTL_MS } from "@pinepoint/github/oauth";
import { setStateCookie } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/auth/csrf";
import { callbackUrl, withQuery } from "@/lib/auth/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"));
  if (!githubAppConfigured()) {
    return NextResponse.redirect(`${origin}${withQuery(returnTo, { auth_error: "not_configured" })}`);
  }
  const state = newSignInState(returnTo, "signin");
  const res = NextResponse.redirect(
    authorizeUrl({ clientId: process.env.GITHUB_APP_CLIENT_ID!, redirectUri: callbackUrl(origin), state }),
  );
  setStateCookie(res, sealSignInState(state), Math.floor(STATE_TTL_MS / 1000));
  res.headers.set("cache-control", "no-store");
  return res;
}
