// Cross-site request protection for the browser's mutation routes (docs/github-access-contract.md
// section 7). The session cookie is SameSite=Lax, and every mutating route also requires that the
// request comes from this origin: Sec-Fetch-Site says so, or Origin equals the app's origin. The
// webhook and drive routes do not use this: they authenticate with an HMAC.

/** Pure check on the headers. `appOrigin` is the origin of this deployment (from the request URL). */
export function isSameOriginRequest(
  headers: { get(name: string): string | null },
  appOrigin: string,
  opts: { allowNavigation?: boolean } = {},
): boolean {
  const site = headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  // A top-level navigation (a link or a form post from an email) has sec-fetch-site "none" or
  // "cross-site". Only the sign-in start accepts it, and it carries no session-bound effect.
  if (opts.allowNavigation && (site === "none" || site === "same-site")) return true;
  const origin = headers.get("origin");
  if (origin && origin === appOrigin) return true;
  // Older browsers send neither header on a same-origin fetch. Then Referer is the last signal.
  if (!site && !origin) {
    const referer = headers.get("referer");
    if (referer) {
      try {
        return new URL(referer).origin === appOrigin;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** The origin this request was made to, behind Vercel's proxy. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** 403 for a request that is not from this origin, else null. Call it first in every mutating browser route. */
export function rejectCrossSite(request: Request): Response | null {
  if (isSameOriginRequest(request.headers, requestOrigin(request))) return null;
  return Response.json({ ok: false, error: "Cross-site request refused." }, { status: 403, headers: { "cache-control": "no-store" } });
}
