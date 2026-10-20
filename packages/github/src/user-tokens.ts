// Encrypted storage of GitHub App user tokens (user_credentials), refresh, and an Octokit for one
// person. docs/github-access-contract.md sections 4 and 10. Server code only.
//
// A token never leaves this module in plain text except inside the Octokit it builds. Callers get
// an Octokit, never a string.

import { Octokit } from "@octokit/rest";
import { decrypt, encrypt, sql, type UserCredentialRow } from "@pinepoint/core";
import { githubAppConfig, OAuthTokenError, REAUTHORIZE_CODES, refreshUserToken, type UserTokenSet } from "./app";

/** Refresh when the access token expires within this many ms. */
export const REFRESH_AHEAD_MS = 5 * 60 * 1000;

/** The person must sign in again: no credential, it is revoked, or the refresh token is dead. */
export class ReauthorizeError extends Error {
  constructor(
    readonly userId: string,
    readonly reason: "no_credential" | "revoked" | "refresh_failed" | "expired",
  ) {
    super(`GitHub authorization for user ${userId} needs a new sign-in (${reason}).`);
    this.name = "ReauthorizeError";
  }
}

/** Writes a token set for the user. Replaces the old one. */
export async function saveUserTokens(userId: string, tokens: UserTokenSet): Promise<void> {
  await sql()`
    insert into user_credentials (user_id, access_enc, access_expires_at, refresh_enc, refresh_expires_at, token_type, scope, updated_at, revoked_at)
    values (${userId}, ${encrypt(tokens.accessToken)}, ${tokens.accessExpiresAt}, ${tokens.refreshToken ? encrypt(tokens.refreshToken) : null},
            ${tokens.refreshExpiresAt}, ${tokens.tokenType}, ${tokens.scope}, now(), null)
    on conflict (user_id) do update set
      access_enc = excluded.access_enc, access_expires_at = excluded.access_expires_at,
      refresh_enc = excluded.refresh_enc, refresh_expires_at = excluded.refresh_expires_at,
      token_type = excluded.token_type, scope = excluded.scope, updated_at = now(), revoked_at = null
  `;
}

/** Marks the credential as revoked. The next request for this person answers "reauthorize". */
export async function markCredentialRevoked(userId: string): Promise<void> {
  await sql()`update user_credentials set revoked_at = coalesce(revoked_at, now()) where user_id = ${userId}`;
}

/** Marks the credential of a GitHub user id as revoked (the github_app_authorization webhook names GitHub ids). */
export async function markCredentialRevokedByGithubId(githubUserId: number | string): Promise<number> {
  const rows = await sql()`
    update user_credentials c set revoked_at = coalesce(c.revoked_at, now())
    from users u where u.id = c.user_id and u.github_user_id = ${String(githubUserId)}::bigint
    returning c.user_id
  `;
  return rows.length;
}

async function loadCredential(userId: string): Promise<UserCredentialRow | null> {
  const rows = (await sql()`select * from user_credentials where user_id = ${userId}`) as UserCredentialRow[];
  return rows[0] ?? null;
}

function expiresSoon(iso: string | null, nowMs: number): boolean {
  return iso !== null && new Date(iso).getTime() - nowMs < REFRESH_AHEAD_MS;
}

/** What decides whether a refresh is due. Pure, for the tests. */
export function needsRefresh(row: Pick<UserCredentialRow, "access_expires_at" | "refresh_enc" | "revoked_at">, nowMs = Date.now()): boolean {
  if (row.revoked_at) return false;
  if (!row.refresh_enc) return false;
  return expiresSoon(row.access_expires_at, nowMs);
}

/**
 * Refreshes the row with a compare-and-set on access_expires_at: of two callers that saw the same
 * expiring token, one writes and one re-reads. Returns the row to use.
 */
async function refreshRow(row: UserCredentialRow, deps: TokenDeps): Promise<UserCredentialRow> {
  let tokens: UserTokenSet;
  try {
    tokens = await deps.refresh(decrypt(row.refresh_enc!));
  } catch (err) {
    if (err instanceof OAuthTokenError && REAUTHORIZE_CODES.has(err.code)) {
      await markCredentialRevoked(row.user_id);
      throw new ReauthorizeError(row.user_id, "refresh_failed");
    }
    throw err;
  }
  const updated = (await sql()`
    update user_credentials set
      access_enc = ${encrypt(tokens.accessToken)}, access_expires_at = ${tokens.accessExpiresAt},
      refresh_enc = ${tokens.refreshToken ? encrypt(tokens.refreshToken) : row.refresh_enc},
      refresh_expires_at = ${tokens.refreshExpiresAt ?? row.refresh_expires_at},
      updated_at = now()
    where user_id = ${row.user_id} and access_expires_at is not distinct from ${row.access_expires_at}::timestamptz
    returning *
  `) as UserCredentialRow[];
  if (updated[0]) return updated[0];
  // Another caller refreshed first. Its row is the current one.
  const again = await loadCredential(row.user_id);
  if (!again || again.revoked_at) throw new ReauthorizeError(row.user_id, "revoked");
  return again;
}

export interface TokenDeps {
  refresh: (refreshToken: string) => Promise<UserTokenSet>;
}

const defaultDeps: TokenDeps = {
  refresh: (token) => refreshUserToken(githubAppConfig(), token),
};

/** The current access token for a person, refreshed when due. Internal: only octokitForUser calls it. */
async function accessTokenFor(userId: string, deps: TokenDeps): Promise<string> {
  let row = await loadCredential(userId);
  if (!row) throw new ReauthorizeError(userId, "no_credential");
  if (row.revoked_at) throw new ReauthorizeError(userId, "revoked");
  const now = Date.now();
  if (needsRefresh(row, now)) {
    row = await refreshRow(row, deps);
  } else if (row.access_expires_at && new Date(row.access_expires_at).getTime() <= now) {
    // Expired and no refresh token.
    throw new ReauthorizeError(userId, "expired");
  }
  return decrypt(row.access_enc);
}

/** True for GitHub's answer to a revoked or expired user token. */
export function isBadCredentials(err: unknown): boolean {
  return (err as { status?: number })?.status === 401;
}

/** True when GitHub asks for SAML SSO authorization for this organization (403 with X-GitHub-SSO). */
export function isSsoRequired(err: unknown): boolean {
  const e = err as { status?: number; response?: { headers?: Record<string, string> } };
  return e?.status === 403 && typeof e.response?.headers?.["x-github-sso"] === "string";
}

/** True for a primary or secondary rate limit answer. */
export function isRateLimited(err: unknown): boolean {
  const e = err as { status?: number; response?: { headers?: Record<string, string> } };
  if (e?.status === 429) return true;
  if (e?.status !== 403) return false;
  const h = e.response?.headers ?? {};
  return h["x-ratelimit-remaining"] === "0" || typeof h["retry-after"] === "string";
}

/**
 * An Octokit that acts as this person. Per call, not cached: the token can change on refresh, and a
 * cache keyed by anything but the user would leak between tenants (contract section 4). A 401 from
 * GitHub marks the credential revoked, so the next call asks for a new sign-in.
 */
export async function octokitForUser(userId: string, deps: TokenDeps = defaultDeps): Promise<Octokit> {
  const token = await accessTokenFor(userId, deps);
  const gh = new Octokit({ auth: token, userAgent: "pinepoint" });
  gh.hook.error("request", async (err) => {
    if (isBadCredentials(err)) {
      await markCredentialRevoked(userId).catch(() => undefined);
    }
    throw err;
  });
  return gh;
}
