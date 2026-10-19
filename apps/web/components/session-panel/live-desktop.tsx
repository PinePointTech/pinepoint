"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { connectionFromDelegation, type DelegatedConnection } from "@pinesandbox/computer-web";
import { PineDesktop } from "@pinesandbox/computer-web/react";
import { LoadingScreen } from "./loading-screen";
import type { DesktopPhase } from "./types";

type Props = {
  missionId: string;
  control: "view" | "drive";
  // True while the mission runs. Then a missing Computer is one that still starts.
  running: boolean;
  // The last known picture. It shows dimmed while the screen connects.
  poster: string | null;
  onInput: () => void;
  onPhase: (phase: DesktopPhase) => void;
  // The newest frame of the screen, as a JPEG data URL. Sent when the desktop goes away.
  onLastFrame: (dataUrl: string) => void;
};

// While the Computer starts, ask again every 3 seconds, for at most 2 minutes.
const RETRY_MS = 3000;
const WAIT_MS = 2 * 60 * 1000;
// The screen must connect in this time after the delegation, or the panel offers Try again.
const CONNECT_MS = 45_000;
const RECONNECTS = 5;
// Keep the newest frame of the live screen this often.
const FRAME_MS = 3000;

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

// Seconds from a Retry-After header or a { retryAfter } body, else null.
function retryAfterMs(res: Response, body: unknown): number | null {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const fromBody = Number((body as { retryAfter?: unknown } | null)?.retryAfter);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody * 1000 : null;
}

// 410 computer_stopped: the Computer is gone and will not come back.
function isGone(status: number, body: unknown): boolean {
  return status === 410 || (body as { code?: unknown } | null)?.code === "computer_stopped";
}

export default function LiveDesktop({ missionId, control, running, poster, onInput, onPhase, onLastFrame }: Props) {
  // A new attempt (Try again) asks for the desktop from the start.
  const [attempt, setAttempt] = useState(0);
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [phase, setPhase] = useState<DesktopPhase>("waiting");
  const [reconnect, setReconnect] = useState(0);
  const [since, setSince] = useState(() => Date.now());

  // Keep the latest props without restarting the effects below.
  const runningRef = useRef(running);
  const phaseRef = useRef(onPhase);
  const lastFrameRef = useRef(onLastFrame);
  useEffect(() => {
    runningRef.current = running;
    phaseRef.current = onPhase;
    lastFrameRef.current = onLastFrame;
  }, [running, onPhase, onLastFrame]);

  const wasLive = useRef(false);
  // True once the screen was live in this panel, also after a reconnect reset: it picks the wording.
  const everLive = useRef(false);
  const phaseNow = useRef(phase);
  const frame = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The start of this try (the mount or the last Try again) and of its first connect.
  // An automatic retry keeps both, so the 2 minute and 45 second limits count the whole try.
  const tryStart = useRef(Date.now());
  const connectStart = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    phaseNow.current = phase;
    phaseRef.current(phase);
    if (phase === "gone" && frame.current) lastFrameRef.current(frame.current);
  }, [phase]);

  // Ask for the desktop. A Computer that still starts answers 404, 409 or 429: wait and ask again.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const started = tryStart.current;
    setConn(null);
    setPhase("waiting");
    setReconnect(0);
    setSince(started);

    const later = (ms: number) => {
      if (Date.now() - started + ms > WAIT_MS) {
        setPhase("stalled");
        return;
      }
      timer = setTimeout(ask, ms);
    };

    async function ask() {
      let res: Response;
      try {
        res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/desktop`, {
          method: "POST",
          signal: abort.signal,
        });
      } catch {
        if (live) later(RETRY_MS);
        return;
      }
      if (!live) return;
      const body: unknown = await res.json().catch(() => null);
      if (!live) return;
      if (res.ok) {
        const delegation = readDelegation(body);
        let c: { url: string; token: string } | null = null;
        try {
          c = delegation ? connectionFromDelegation(delegation) : null;
        } catch {
          // A delegation the SDK cannot read. Ask again.
        }
        if (c) {
          connectStart.current ??= Date.now();
          setConn({ url: c.url, token: c.token });
          setPhase("connecting");
          return;
        }
        later(RETRY_MS);
        return;
      }
      if (isGone(res.status, body)) {
        setPhase("gone");
        return;
      }
      // No handle and the mission no longer runs: there is no Computer to wait for.
      if (res.status === 404 && !runningRef.current) {
        setPhase("gone");
        return;
      }
      later(Math.max(RETRY_MS, retryAfterMs(res, body) ?? 0));
    }

    void ask();
    return () => {
      live = false;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [missionId, attempt]);

  // The screen must connect in 45 seconds from the first connect of this try. A late connect
  // still turns the screen live.
  useEffect(() => {
    if (phase !== "connecting") return;
    const left = (connectStart.current ?? Date.now()) + CONNECT_MS - Date.now();
    const t = setTimeout(() => setPhase((p) => (p === "connecting" ? "stalled" : p)), Math.max(0, left));
    return () => clearTimeout(t);
  }, [phase, attempt]);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const tryAgain = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    tryStart.current = Date.now();
    connectStart.current = null;
    setAttempt((n) => n + 1);
  }, []);

  // While live, keep the newest frame of the screen. The SDK replaces the canvas on reconnect.
  useEffect(() => {
    if (phase !== "live") return;
    const grab = () => {
      try {
        const el = box.current?.querySelector("pine-desktop") ?? document.querySelector("pine-desktop");
        const canvas = el?.shadowRoot?.querySelector<HTMLCanvasElement>('[part="screen"] canvas');
        if (!canvas || canvas.width === 0 || canvas.height === 0) return;
        frame.current = canvas.toDataURL("image/jpeg", 0.7);
      } catch {
        // The canvas is gone or cannot be read. Keep the frame from before.
      }
    };
    const first = setTimeout(grab, 1000);
    const t = setInterval(grab, FRAME_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [phase]);

  // The panel shows the last screen after the desktop. Give it the newest frame.
  useEffect(
    () => () => {
      if (frame.current) lastFrameRef.current(frame.current);
    },
    [],
  );

  // A desktop token lasts 120 seconds. The SDK calls this on each reconnect.
  const getToken = useCallback(async () => {
    const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/desktop-token`, {
      method: "POST",
    });
    const body: unknown = await res.json().catch(() => null);
    if (isGone(res.status, body)) {
      setPhase("gone");
      throw new Error("computer_stopped");
    }
    if (!res.ok) throw new Error(String(res.status));
    const token = readToken(body);
    if (!token) throw new Error("bad token");
    return token;
  }, [missionId]);

  // The first connect uses the token from the delegation. Reconnects get a new token.
  const tokenSource = useMemo(() => {
    let first: string | null = conn?.token ?? null;
    return () => {
      if (first) {
        const t = first;
        first = null;
        return t;
      }
      return getToken();
    };
  }, [conn, getToken]);

  const handleConnected = useCallback(() => {
    wasLive.current = true;
    setReconnect(0);
    setPhase("live");
  }, []);

  // A live screen that drops starts the reconnect clock. A connect that fails keeps its clock.
  const handleDisconnected = useCallback(() => {
    if (phaseNow.current !== "live") return;
    setPhase("reconnecting");
    setSince(Date.now());
  }, []);

  const handleReconnecting = useCallback(({ attempt: n }: { attempt: number }) => {
    setReconnect(n);
    setPhase((p) => (p === "gone" || p === "stalled" ? p : wasLive.current ? "reconnecting" : "connecting"));
  }, []);

  // Running out of reconnects does not prove the Computer is gone: a laptop that wakes from sleep
  // or a network switch fails all 5 in a few seconds. After a live screen, start the bounded ask
  // loop again, so the desktop route decides (410 means gone). Before a live screen, the screen
  // service can still be starting: ask for a new delegation in 3 seconds, until the 45 seconds are over.
  const handleExhausted = useCallback(() => {
    if (wasLive.current) {
      // Show the newest frame under the loading overlay while the panel asks again.
      if (frame.current) lastFrameRef.current(frame.current);
      wasLive.current = false;
      everLive.current = true;
      tryStart.current = Date.now();
      connectStart.current = null;
      setAttempt((n) => n + 1);
      return;
    }
    if (Date.now() - (connectStart.current ?? Date.now()) >= CONNECT_MS) {
      setPhase("stalled");
      return;
    }
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
  }, []);

  const stage =
    phase === "waiting"
      ? everLive.current
        ? "Reconnecting to the screen"
        : "Waiting for the computer"
      : phase === "reconnecting"
        ? reconnect > 0
          ? `Reconnecting, attempt ${reconnect} of ${RECONNECTS}`
          : "Reconnecting"
        : phase === "stalled"
          ? "The screen did not connect."
          : // Before the first live screen the panel retries by itself, so it shows no count.
            "Connecting to the screen";

  const showOverlay = phase !== "live";

  return (
    <div
      ref={box}
      className="relative aspect-video min-h-52 w-full overflow-hidden rounded-2xl bg-black"
      onPointerDown={onInput}
      onKeyDown={onInput}
      onWheel={onInput}
      data-desktop-phase={phase}
    >
      {conn && phase !== "gone" && (
        <PineDesktop
          key={attempt}
          url={conn.url}
          token={tokenSource}
          control={control}
          reconnectMaxAttempts={RECONNECTS}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onReconnecting={handleReconnecting}
          onReconnectExhausted={handleExhausted}
          onError={() => undefined}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {showOverlay && (
        <LoadingScreen
          overlay
          stage={stage}
          since={since}
          poster={poster}
          busy={phase !== "stalled" && phase !== "gone"}
          detail={
            phase === "waiting"
              ? everLive.current
                ? "The connection dropped. PinePoint asks for the screen again."
                : "The computer is still starting. This can take a minute."
              : null
          }
          action={
            phase === "stalled" ? (
              <button
                type="button"
                onClick={tryAgain}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <RotateCw className="h-4 w-4" aria-hidden />
                Try again
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
