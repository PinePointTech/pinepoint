// PinePoint sessions (docs/github-access-contract.md decision 7 and section 10). Server code only.
//
// The cookie holds a random 256-bit token. The sessions table holds SHA-256 of it, the user, and
// the expiry. A session is idle-expired after SESSION_IDLE_DAYS without a request and absolutely
// after SESSION_MAX_DAYS. Logout sets revoked_at. Nothing here ever reads a GitHub token.

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { sql, toPublicUser, type PublicUser, type SessionRow, type UserRow } from "@pinepoint/core";

export const SESSION_COOKIE = "pp_session";
/** The short-lived cookie of a sign-in or install flow in progress (packages/github/src/oauth.ts). */
export const STATE_COOKIE = "pp_oauth";

export const SESSION_IDLE_DAYS = 30;
export const SESSION_MAX_DAYS = 90;

/** True on Vercel and any https deployment: the cookie gets the Secure flag. */
export function secureCookies(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.VERCEL) return true;
  const base = env.APP_BASE_URL ?? "";
  return base.startsWith("https://");
}

const cookieBase = () => ({ httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: "/" });

/** Reads one cookie from a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  session: SessionRow;
  user: UserRow;
  public: PublicUser;
}

/** Creates a session for the user. Returns the cookie token (shown once) and the row. */
export async function createSession(userId: string): Promise<{ token: string; session: SessionRow }> {
  const token = randomBytes(32).toString("base64url");
  const rows = (await sql()`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${hashToken(token)}, now() + make_interval(days => ${SESSION_IDLE_DAYS}))
    returning *
  `) as SessionRow[];
  return { token, session: rows[0]! };
}

/**
 * The session and user for a cookie token, or null. Also slides the idle expiry (at most once a
 * minute, so polling does not write on every call) within the absolute maximum.
 */
export async function loadSession(token: string | null): Promise<SessionUser | null> {
  if (!token || token.length < 20) return null;
  const hash = hashToken(token);
  const rows = (await sql()`
    select s.id as session_id, s.user_id, s.token_hash, s.created_at as session_created_at, s.last_seen_at as session_last_seen_at,
           s.expires_at, s.revoked_at,
           u.id, u.github_user_id, u.login, u.name, u.avatar_url, u.created_at, u.last_seen_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hash} and s.revoked_at is null and s.expires_at > now()
  `) as Array<
    UserRow & { session_id: string; user_id: string; token_hash: string; session_created_at: string; session_last_seen_at: string; expires_at: string; revoked_at: string | null }
  >;
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.session_last_seen_at).getTime() > 60_000) {
    // Slide the idle expiry, within the absolute maximum. Best effort.
    void sql()`
      update sessions set last_seen_at = now(),
        expires_at = least(now() + make_interval(days => ${SESSION_IDLE_DAYS}), created_at + make_interval(days => ${SESSION_MAX_DAYS}))
      where token_hash = ${hash} and revoked_at is null
    `.catch(() => undefined);
  }
  const user: UserRow = {
    id: r.id,
    github_user_id: r.github_user_id,
    login: r.login,
    name: r.name,
    avatar_url: r.avatar_url,
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
  };
  const session: SessionRow = {
    id: r.session_id,
    user_id: r.user_id,
    token_hash: r.token_hash,
    created_at: r.session_created_at,
    last_seen_at: r.session_last_seen_at,
    expires_at: r.expires_at,
    revoked_at: r.revoked_at,
  };
  return { session, user, public: toPublicUser(user) };
}

/** The session of a request, from its Cookie header. Null without one. */
export function sessionOf(request: Request): Promise<SessionUser | null> {
  return loadSession(cookieValue(request.headers.get("cookie"), SESSION_COOKIE));
}

export async function revokeSession(token: string | null): Promise<void> {
  if (!token) return;
  await sql()`update sessions set revoked_at = coalesce(revoked_at, now()) where token_hash = ${hashToken(token)}`;
}

/** Ends every session of a person: used when their GitHub authorization is revoked. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await sql()`update sessions set revoked_at = coalesce(revoked_at, now()) where user_id = ${userId} and revoked_at is null`;
}

// ---------- cookies on responses ----------

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_IDLE_DAYS * 86_400 });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

export function setStateCookie(res: NextResponse, sealed: string, maxAgeSeconds: number): void {
  res.cookies.set(STATE_COOKIE, sealed, { ...cookieBase(), maxAge: maxAgeSeconds });
}

export function clearStateCookie(res: NextResponse): void {
  res.cookies.set(STATE_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

// ---------- users ----------

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/** Finds or makes the user for a GitHub profile. The GitHub id is the key; login and name refresh. */
export async function upsertUser(profile: GithubProfile): Promise<UserRow> {
  const rows = (await sql()`
    insert into users (github_user_id, login, name, avatar_url)
    values (${profile.id}, ${profile.login}, ${profile.name}, ${profile.avatar_url})
    on conflict (github_user_id) do update set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, last_seen_at = now()
    returning *
  `) as UserRow[];
  return rows[0]!;
}
