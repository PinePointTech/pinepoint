// GET /api/auth/me: the signed-in person, or null. Also tells the page whether sign-in is possible
// on this deployment (the GitHub App is configured). Never returns a token.

import { githubAppConfigured } from "@pinepoint/github/app";
import { sessionOf } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await sessionOf(request);
  return Response.json(
    { user: session?.public ?? null, signInAvailable: githubAppConfigured() },
    { headers: { "cache-control": "private, no-store" } },
  );
}
