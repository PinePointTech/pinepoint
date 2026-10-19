"use client";

// The sign-in control in the /app header (VI-30). "Continue with GitHub" starts the OAuth flow
// and returns to the current page. Signed in: the avatar, the login and Sign out. Sign out ends
// the PinePoint session only; the GitHub authorization stays until revoked on GitHub.

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { getMe, logout, signInHref } from "@/lib/app-api";
import type { MeResponse } from "@/lib/app-types";

/** The GitHub mark. lucide-react no longer ships brand icons. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function AuthMenu() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    getMe()
      .then((m) => {
        if (!stop) setMe(m);
      })
      .catch(() => {
        if (!stop) setMe({ user: null, signInAvailable: false });
      });
    return () => {
      stop = true;
    };
  }, []);

  if (!me) return <span className="size-9" aria-hidden />;

  // Return to the page as it is, minus a stale ?auth_error=.
  const q = new URLSearchParams(params.toString());
  q.delete("auth_error");
  q.delete("install");
  const here = q.size > 0 ? `${pathname}?${q}` : pathname;

  if (!me.user) {
    if (!me.signInAvailable) return null;
    return (
      <a
        href={signInHref(here)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:border-accent hover:text-accent"
      >
        <GithubMark className="size-4" />
        Continue with GitHub
      </a>
    );
  }

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
      window.location.assign("/app");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-2 text-sm" title={me.user.name ?? me.user.login}>
        {me.user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.user.avatarUrl} alt="" width={24} height={24} className="size-6 rounded-full" />
        ) : (
          <GithubMark className="size-4" />
        )}
        <span className="hidden font-semibold sm:inline">{me.user.login}</span>
      </span>
      <button
        type="button"
        onClick={onLogout}
        aria-disabled={busy}
        title="Sign out of PinePoint. The GitHub authorization stays until you revoke it on GitHub."
        className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:text-fg aria-disabled:opacity-60"
      >
        <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Sign out</span>
      </button>
    </div>
  );
}
