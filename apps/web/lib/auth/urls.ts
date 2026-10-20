// URL helpers for the sign-in and install flows. Pure.

/** The callback URL registered on the GitHub App ("Callback URL" in its settings). */
export function callbackUrl(origin: string): string {
  return `${origin}/api/auth/github/callback`;
}

/** The setup URL registered on the GitHub App ("Setup URL", with "Redirect on update" on). */
export function installCallbackUrl(origin: string): string {
  return `${origin}/api/github/install/callback`;
}

/** Adds query parameters to a relative path. */
export function withQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, "https://pinepoint.invalid");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}${url.hash}`;
}
