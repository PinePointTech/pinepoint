"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectionFromDelegation, type DelegatedConnection } from "@pinesandbox/computer-web";
import { PineDesktop } from "@pinesandbox/computer-web/react";

type Props = {
  missionId: string;
  control: "view" | "drive";
  onInput: () => void;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; url: string; token: string };

// The desktop route can send the delegation as the body or as { delegation }.
function readDelegation(body: unknown): DelegatedConnection | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const d = (b.delegation ?? b) as Partial<DelegatedConnection>;
  if (typeof d.computer_host !== "string" || !d.transports?.desktop_token?.token) return null;
  return d as DelegatedConnection;
}

// The token route can send { token }, { desktop_token } or a full delegation.
function readToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token === "string") return b.token;
  if (typeof b.desktop_token === "string") return b.desktop_token;
  return readDelegation(body)?.transports.desktop_token.token ?? null;
}

export default function LiveDesktop({ missionId, control, onInput }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/desktop`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(String(res.status));
        const delegation = readDelegation(await res.json());
        if (!delegation) throw new Error("bad delegation");
        const conn = connectionFromDelegation(delegation);
        if (live) setState({ kind: "ready", url: conn.url, token: conn.token });
      } catch {
        if (live) setState({ kind: "error", message: "The desktop is not ready." });
      }
    })();
    return () => {
      live = false;
    };
  }, [missionId]);

  // A desktop token lasts 120 seconds. The SDK calls this on each reconnect.
  const getToken = useCallback(async () => {
    const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/desktop-token`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(String(res.status));
    const token = readToken(await res.json());
    if (!token) throw new Error("bad token");
    return token;
  }, [missionId]);

  // The first connect uses the token from the delegation. Reconnects get a new token.
  const tokenSource = useMemo(() => {
    let first: string | null = state.kind === "ready" ? state.token : null;
    return () => {
      if (first) {
        const t = first;
        first = null;
        return t;
      }
      return getToken();
    };
  }, [state, getToken]);

  if (state.kind === "loading") {
    return <DesktopMessage text="The desktop is starting." />;
  }
  if (state.kind === "error") {
    return <DesktopMessage text={state.message} />;
  }

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"
      onPointerDown={onInput}
      onKeyDown={onInput}
      onWheel={onInput}
    >
      <PineDesktop
        url={state.url}
        token={tokenSource}
        control={control}
        reconnectMaxAttempts={5}
        onConnected={() => setLost(false)}
        onReconnectExhausted={() => setLost(true)}
        onError={() => undefined}
        style={{ width: "100%", height: "100%" }}
      />
      {lost && (
        <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-sm text-white">
          The connection to the desktop stopped. Close the panel and open it again.
        </div>
      )}
    </div>
  );
}

export function DesktopMessage({ text }: { text: string }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-zinc-200 px-4 text-center text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {text}
    </div>
  );
}
