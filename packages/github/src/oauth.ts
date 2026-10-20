// The sign-in flow's pure parts: the authorize URL, the state and PKCE values, the short-lived
// state cookie, and the return-path rule (docs/github-access-contract.md section 10).
// apps/web/app/api/auth/github/* use them. Nothing here talks to GitHub or the database.

import { createHash, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@pinepoint/core";

export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/** The default page after sign-in. */
export const DEFAULT_RETURN_TO = "/app";

/** How long a sign-in may take between the start and the callback. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Non-/app paths a sign-in may return to: the install flow's own GET routes. */
export const INSTALL_RETURN_PATHS: ReadonlySet<string> = new Set(["/api/github/install", "/api/github/install/callback"]);

/**
 * A safe return path: relative, starts with one "/", no scheme, no backslash, no control characters,
 * and only /app routes (the dashboard, a run, a finding, a workspace page). Anything else gives the
 * default. "//evil.example" and "/\evil" are not paths.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  const v = value.trim();
  if (v.length > 2048) return DEFAULT_RETURN_TO;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return DEFAULT_RETURN_TO;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v) || /^\/[^/?#]*:/.test(v)) return DEFAULT_RETURN_TO;
  try {
    const url = new URL(v, "https://pinepoint.invalid");
    if (url.origin !== "https://pinepoint.invalid") return DEFAULT_RETURN_TO;
    const app = url.pathname === "/app" || url.pathname.startsWith("/app/");
    // The install flow sends a person through sign-in and back to itself. Both are GET routes
    // that check the session and the installation on their own.
    const install = INSTALL_RETURN_PATHS.has(url.pathname);
    if (!app && !install) return DEFAULT_RETURN_TO;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

/** The state cookie's content: the state, the PKCE verifier, where to go after, and when it expires. */
export interface SignInState {
  state: string;
  codeVerifier: string;
  returnTo: string;
  /** Epoch ms. */
  expiresAt: number;
  /** "signin" for the OAuth flow, "install" for the installation flow (the state comes back as ?state=). */
  purpose: "signin" | "install";
}

export function newSignInState(returnTo: string | null | undefined, purpose: SignInState["purpose"] = "signin", nowMs = Date.now()): SignInState {
  return {
    state: randomBytes(24).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    returnTo: safeReturnTo(returnTo),
    expiresAt: nowMs + STATE_TTL_MS,
    purpose,
  };
}

/** S256 code challenge for the verifier. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The state cookie value: the state encrypted under ENCRYPTION_KEY, so the browser cannot forge or read it. */
export function sealSignInState(s: SignInState): string {
  return encrypt(JSON.stringify(s));
}

/**
 * Reads a state cookie back. Null when it is missing, forged, expired, or the state in the callback
 * does not match (a replay or a cross-site start).
 */
export function openSignInState(cookie: string | null | undefined, callbackState: string | null | undefined, nowMs = Date.now()): SignInState | null {
  if (!cookie || !callbackState) return null;
  let s: SignInState;
  try {
    s = JSON.parse(decrypt(cookie)) as SignInState;
  } catch {
    return null;
  }
  if (typeof s.state !== "string" || typeof s.codeVerifier !== "string" || typeof s.expiresAt !== "number") return null;
  if (s.expiresAt < nowMs) return null;
  if (!timingSafeEqualStrings(s.state, callbackState)) return null;
  return { ...s, returnTo: safeReturnTo(s.returnTo), purpose: s.purpose === "install" ? "install" : "signin" };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** The GitHub authorize URL for this sign-in. No scope: a GitHub App's user token gets the app's permissions. */
export function authorizeUrl(input: { clientId: string; redirectUri: string; state: SignInState }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state.state);
  url.searchParams.set("code_challenge", codeChallenge(input.state.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** The callback's error query, mapped to a short code the page can show. Pure. */
export type CallbackFailure =
  | "access_denied"
  | "bad_state"
  | "bad_code"
  | "no_code"
  | "github_error"
  | "not_configured";

export function callbackFailureFromQuery(query: URLSearchParams): CallbackFailure | null {
  const error = query.get("error");
  if (!error) return null;
  return error === "access_denied" ? "access_denied" : "github_error";
}
