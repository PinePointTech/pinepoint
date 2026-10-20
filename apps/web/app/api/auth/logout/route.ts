// POST /api/auth/logout: end the PinePoint session (VI-30). It does not revoke the GitHub
// authorization: that is done on GitHub (Settings, Applications), and the UI says so.

import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/lib/auth/csrf";
import { clearSessionCookie, cookieValue, revokeSession, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  await revokeSession(cookieValue(request.headers.get("cookie"), SESSION_COOKIE));
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  clearSessionCookie(res);
  return res;
}
