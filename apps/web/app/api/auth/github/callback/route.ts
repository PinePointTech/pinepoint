// GET /api/auth/github/callback?code=&state=: finish the sign-in (VI-30).
//
// Checks the state against the encrypted cookie (a replay, a cross-site start or an expired
// cookie fails), exchanges the code on the server, reads the GitHub profile, stores the user and
// the encrypted tokens, creates a session and redirects to the validated return path. Every
// failure redirects to the return path with ?auth_error=<code> and no session; the state cookie
// is cleared either way, so a second use of the same callback URL fails.

import { NextResponse } from "next/server";
import { exchangeCode, fetchProfile, githubAppConfig, githubAppConfigured, OAuthTokenError } from "@pinepoint/github/app";
import { callbackFailureFromQuery, openSignInState, safeReturnTo, type CallbackFailure } from "@pinepoint/github/oauth";
import { saveUserTokens } from "@pinepoint/github/user-tokens";
import { recordAction } from "@/lib/access";
import { clearStateCookie, cookieValue, createSession, setSessionCookie, STATE_COOKIE, upsertUser } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/auth/csrf";
import { callbackUrl, withQuery } from "@/lib/auth/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(origin: string, returnTo: string, code: CallbackFailure): NextResponse {
  const res = NextResponse.redirect(`${origin}${withQuery(returnTo, { auth_error: code })}`);
  clearStateCookie(res);
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const query = new URL(request.url).searchParams;
  const sealed = cookieValue(request.headers.get("cookie"), STATE_COOKIE);
  const state = openSignInState(sealed, query.get("state"));
  const returnTo = state?.returnTo ?? safeReturnTo(null);

  if (!githubAppConfigured()) return fail(origin, returnTo, "not_configured");
  const denied = callbackFailureFromQuery(query);
  if (denied) return fail(origin, returnTo, denied);
  if (!state || state.purpose !== "signin") return fail(origin, returnTo, "bad_state");
  const code = query.get("code");
  if (!code) return fail(origin, returnTo, "no_code");

  try {
    const tokens = await exchangeCode(githubAppConfig(), { code, redirectUri: callbackUrl(origin), codeVerifier: state.codeVerifier });
    const profile = await fetchProfile(tokens.accessToken);
    const user = await upsertUser(profile);
    await saveUserTokens(user.id, tokens);
    const { token } = await createSession(user.id);
    void recordAction({ action: "sign_in", userId: user.id });

    const res = NextResponse.redirect(`${origin}${returnTo}`);
    setSessionCookie(res, token);
    clearStateCookie(res);
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof OAuthTokenError) {
      console.warn(`[auth] token exchange failed: ${err.code}`);
      return fail(origin, returnTo, "bad_code");
    }
    // Log the class and status only. The message of a GitHub error can echo request data.
    console.error("[auth] callback failed", { error: (err as Error)?.name, status: (err as { status?: number })?.status });
    return fail(origin, returnTo, "github_error");
  }
}
