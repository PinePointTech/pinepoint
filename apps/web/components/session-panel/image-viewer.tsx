"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from "lucide-react";

export type ViewerItem = { url: string; title: string; at: string | null };

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })} PT`;
}

// A large view of one picture, with Prev and Next for the others. It is a native modal dialog
// on top of the session drawer, which is a dialog too. Esc, the close button and a click on the
// backdrop close only this viewer: its cancel, close, click and key events stop here, so the
// drawer's own handlers never see them.
export function ImageViewer({
  items,
  start,
  label,
  onClose,
}: {
  items: ViewerItem[];
  start: number;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), Math.max(items.length - 1, 0)));
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    closeButton.current?.focus();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  // Left and Right show the picture before and after. The viewer is the top modal, so every
  // key press in the page is meant for it.
  const count = items.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      setIndex((i) => Math.min(Math.max(i + step, 0), count - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count]);

  const item = items[index];
  if (!item) return null;
  const many = items.length > 1;
  const at = timeOf(item.at);
  const broken = brokenUrl === item.url;
  // Browsers block a new tab on a data: URL. The live frame is one.
  const canOpen = !item.url.startsWith("data:");

  const go = (step: number) => setIndex((i) => Math.min(Math.max(i + step, 0), items.length - 1));

  return (
    <dialog
      ref={ref}
      closedby="any"
      aria-label={label}
      data-testid="image-viewer"
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation();
        // A close event that arrives after a new showModal is stale.
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        // The content fills the dialog, so a click on the dialog itself is on the backdrop.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100%-2rem)] max-w-6xl overflow-hidden rounded-[20px] border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-fg/40"
    >
      <div className="flex h-full flex-col gap-3 p-3 sm:p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {many && (
              <p className="text-xs text-muted tabular-nums">
                Picture {index + 1} of {items.length}
              </p>
            )}
            <h2 className="font-semibold break-words text-fg">{item.title || "Picture"}</h2>
            {at && <p className="text-xs text-muted tabular-nums">{at}</p>}
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close the picture"
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS}`}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface-2">
          {broken ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
              <ImageOff className="h-6 w-6" aria-hidden />
              The picture did not load.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.url}
              src={item.url}
              alt={item.title || "Picture of the screen"}
              onError={() => setBrokenUrl(item.url)}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2">
          {many ? (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-disabled={index === 0}
              className={`inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${FOCUS}`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Prev
            </button>
          ) : (
            <span />
          )}
          {canOpen && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted underline-offset-2 hover:text-fg hover:underline ${FOCUS}`}
            >
              Open full size
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only"> (opens a new tab)</span>
            </a>
          )}
          {many ? (
            <button
              type="button"
              onClick={() => go(1)}
              aria-disabled={index === items.length - 1}
              className={`inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${FOCUS}`}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <span />
          )}
        </footer>
      </div>
    </dialog>
  );
}
