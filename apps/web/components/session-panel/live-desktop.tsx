"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionFromDelegation, type DelegatedConnection } from "@pinesandbox/computer-web";
import { PineDesktop } from "@pinesandbox/computer-web/react";
import type { DesktopStatus } from "./types";

type Props = {
  missionId: string;
  control: "view" | "drive";
  onInput: () => void;
  // "live" when the desktop connects. "ended" when the desktop request fails,
  // the connection never becomes ready, or the reconnects stop.
  onStatus: (status: Exclude<DesktopStatus, "starting">) => void;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; url: string; token: string };

// The desktop must connect in this time, or the panel shows the last screen.
const READY_MS = 30_000;

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

export default function LiveDesktop({ missionId, control, onInput, onStatus }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  // Keep the latest callback without restarting the effects below.
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);

  const connected = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadyTimer = useCallback(() => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    readyTimer.current = null;
  }, []);

  const end = useCallback(() => {
    clearReadyTimer();
    statusRef.current("ended");
  }, [clearReadyTimer]);

  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    connected.current = false;

    // No Pine computer, or a computer that does not answer: stop waiting.
    readyTimer.current = setTimeout(() => {
      if (live && !connected.current) {
        abort.abort();
        statusRef.current("ended");
      }
    }, READY_MS);

    (async () => {
      try {
        const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/desktop`, {
          method: "POST",
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const delegation = readDelegation(await res.json());
        if (!delegation) throw new Error("bad delegation");
        const conn = connectionFromDelegation(delegation);
        if (live) setState({ kind: "ready", url: conn.url, token: conn.token });
      } catch {
        if (!live) return;
        setState({ kind: "error" });
        end();
      }
    })();

    return () => {
      live = false;
      abort.abort();
      clearReadyTimer();
    };
  }, [missionId, end, clearReadyTimer]);

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

  const handleConnected = useCallback(() => {
    connected.current = true;
    clearReadyTimer();
    statusRef.current("live");
  }, [clearReadyTimer]);

  // The parent shows the last screen when the desktop fails.
  if (state.kind === "error") return null;

  if (state.kind === "loading") {
    return (
      <div
        className="flex aspect-video w-full items-center justify-center rounded-2xl bg-surface-2 px-4 text-center text-sm text-muted"
        aria-busy="true"
      >
        The desktop is starting.
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black"
      onPointerDown={onInput}
      onKeyDown={onInput}
      onWheel={onInput}
    >
      <PineDesktop
        url={state.url}
        token={tokenSource}
        control={control}
        reconnectMaxAttempts={5}
        onConnected={handleConnected}
        onReconnectExhausted={end}
        onError={() => undefined}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
