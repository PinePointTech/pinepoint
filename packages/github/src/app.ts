// The GitHub App: its configuration, the app JWT, and the OAuth token endpoints.
// docs/github-access-contract.md sections 4 and 10. Server code only.
//
// Env (all read on first use, never at import):
//   GITHUB_APP_ID             the numeric app id
//   GITHUB_APP_SLUG           the URL name, for https://github.com/apps/<slug>/installations/new
//   GITHUB_APP_CLIENT_ID      OAuth client id of the app
//   GITHUB_APP_CLIENT_SECRET  OAuth client secret
//   GITHUB_APP_PRIVATE_KEY    the PEM. "\n" escapes and base64 of the whole PEM are both accepted.
//
// The shared GITHUB_TOKEN in client.ts is for legacy demo runs only (contract section 4).

import { createSign } from "node:crypto";
import { Octokit } from "@octokit/rest";

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
}

/** The fields the app has set. Used by /api/health and by githubAppConfigured. */
export function githubAppEnvStatus(env: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    GITHUB_APP_ID: Boolean(env.GITHUB_APP_ID),
    GITHUB_APP_SLUG: Boolean(env.GITHUB_APP_SLUG),
    GITHUB_APP_CLIENT_ID: Boolean(env.GITHUB_APP_CLIENT_ID),
    GITHUB_APP_CLIENT_SECRET: Boolean(env.GITHUB_APP_CLIENT_SECRET),
    GITHUB_APP_PRIVATE_KEY: Boolean(env.GITHUB_APP_PRIVATE_KEY),
  };
}

/** True when sign-in can work: the client id and secret are set. The private key is only needed for installation checks. */
export function githubAppConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_APP_SLUG);
}

/** Turns the env value into a PEM: unescapes "\n", or decodes base64 when it is not a PEM already. */
export function normalizePrivateKey(raw: string): string {
  const unescaped = raw.replace(/\\n/g, "\n").trim();
  if (unescaped.startsWith("-----BEGIN")) return unescaped;
  const decoded = Buffer.from(unescaped, "base64").toString("utf8").trim();
  if (decoded.startsWith("-----BEGIN")) return decoded;
  throw new Error("GITHUB_APP_PRIVATE_KEY is not a PEM or the base64 of one.");
}

export function githubAppConfig(env: Readonly<Record<string, string | undefined>> = process.env): GitHubAppConfig {
  const missing = Object.entries(githubAppEnvStatus(env))
    .filter(([, set]) => !set)
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`GitHub App env is not set: ${missing.join(", ")}.`);
  return {
    appId: env.GITHUB_APP_ID!,
    slug: env.GITHUB_APP_SLUG!,
    clientId: env.GITHUB_APP_CLIENT_ID!,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET!,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY!),
  };
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/**
 * A JWT that authenticates as the app (RS256, 10 minutes, issued 60 seconds in the past for clock
 * skew). Used only for read-only app endpoints such as GET /app/installations/{id}. No installation
 * token is minted in v1 (contract section 4).
 */
export function appJwt(config: Pick<GitHubAppConfig, "appId" | "privateKey">, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: config.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

// ---------- OAuth token endpoint ----------

export interface UserTokenSet {
  accessToken: string;
  /** ISO time, or null when GitHub gave no expiry (expiring user tokens are off on the app). */
  accessExpiresAt: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
  tokenType: string;
  scope: string | null;
}

/** An error from the token endpoint. `code` is GitHub's error string, for example bad_verification_code. */
export class OAuthTokenError extends Error {
  constructor(
    readonly code: string,
    description: string,
  ) {
    super(`GitHub token endpoint: ${code}${description ? ` (${description})` : ""}`);
    this.name = "OAuthTokenError";
  }
}

/** Errors after which the refresh token is useless and the person must sign in again. */
export const REAUTHORIZE_CODES: ReadonlySet<string> = new Set(["bad_refresh_token", "unauthorized_client", "incorrect_client_credentials"]);

type TokenEndpointBody = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/** Parses the token endpoint JSON into a token set, with absolute expiry times. Pure. */
export function parseTokenResponse(body: TokenEndpointBody, nowMs = Date.now()): UserTokenSet {
  if (body.error || !body.access_token) {
    throw new OAuthTokenError(body.error ?? "no_access_token", body.error_description ?? "");
  }
  const at = (seconds: number | undefined) =>
    typeof seconds === "number" && Number.isFinite(seconds) ? new Date(nowMs + seconds * 1000).toISOString() : null;
  return {
    accessToken: body.access_token,
    accessExpiresAt: at(body.expires_in),
    refreshToken: body.refresh_token ?? null,
    refreshExpiresAt: at(body.refresh_token_expires_in),
    tokenType: body.token_type ?? "bearer",
    scope: body.scope ?? null,
  };
}

export const TOKEN_URL = "https://github.com/login/oauth/access_token";

async function postTokenEndpoint(params: Record<string, string>, fetchFn: typeof fetch): Promise<UserTokenSet> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "pinepoint" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  let body: TokenEndpointBody;
  try {
    body = (await res.json()) as TokenEndpointBody;
  } catch {
    throw new OAuthTokenError("bad_response", `HTTP ${res.status}`);
  }
  return parseTokenResponse(body);
}

/** Exchanges the callback code for a user token set. `codeVerifier` is sent for PKCE (contract section 10). */
export function exchangeCode(
  config: Pick<GitHubAppConfig, "clientId" | "clientSecret">,
  input: { code: string; redirectUri: string; codeVerifier?: string },
  fetchFn: typeof fetch = fetch,
): Promise<UserTokenSet> {
  const params: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  };
  if (input.codeVerifier) params.code_verifier = input.codeVerifier;
  return postTokenEndpoint(params, fetchFn);
}

/** Refreshes an expiring user token. Throws OAuthTokenError with a REAUTHORIZE_CODES code when the refresh token is dead. */
export function refreshUserToken(
  config: Pick<GitHubAppConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<UserTokenSet> {
  return postTokenEndpoint(
    { client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken },
    fetchFn,
  );
}

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/** GET /user with a fresh access token, right after the exchange. The token is used once here and then stored encrypted. */
export async function fetchProfile(accessToken: string): Promise<GithubProfile> {
  const gh = new Octokit({ auth: accessToken, userAgent: "pinepoint" });
  const { data } = await gh.users.getAuthenticated();
  return { id: data.id, login: data.login, name: data.name ?? null, avatar_url: data.avatar_url ?? null };
}

/** The page where an organization owner or admin installs the app and selects repositories. */
export function installUrl(slug: string, state?: string): string {
  const url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
