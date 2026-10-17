import { MonitorPause } from "lucide-react";

// A static mock of the inline review comment PinePoint posts on a PR.
export function PrCommentCard() {
  return (
    <figure
      aria-label="Example PinePoint review comment on a pull request"
      className="w-full overflow-hidden rounded-2xl border border-border bg-surface text-left shadow-[0_18px_40px_-24px_rgb(23_61_42/0.35)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5 font-mono text-xs text-muted">
        <span className="truncate">app/cart/shipping.ts · line 42</span>
        <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 font-sans font-bold text-danger">
          Bug found
        </span>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm font-bold">
          Mission 4 of 10 failed: free shipping does not apply at $50.
        </p>

        <div className="relative aspect-[16/9] overflow-hidden rounded-xl border border-border bg-bg">
          <div className="absolute inset-x-0 top-0 flex h-6 items-center gap-1.5 border-b border-border bg-surface-2 px-3">
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
          </div>
          <div className="absolute inset-x-4 top-10 space-y-2">
            <div className="h-2.5 w-1/3 rounded-full bg-border" />
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <span>Subtotal</span>
              <span className="tabular-nums">$50.00</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border-2 border-danger bg-surface px-3 py-2 text-xs">
              <span>Shipping</span>
              <span className="font-bold tabular-nums text-danger">$5.99</span>
            </div>
          </div>
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-fg/80 px-2 py-0.5 text-[11px] font-medium text-bg">
            <MonitorPause className="size-3" strokeWidth={2} aria-hidden />
            Paused
          </span>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted marker:text-muted">
          <li>Add one item for $50.00 to the cart.</li>
          <li>Open the checkout page.</li>
          <li>Shipping shows $5.99. Expected: free.</li>
        </ol>

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-accent px-3 py-1 font-bold text-accent-fg">
            Open session
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-muted">
            Bug
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-muted">
            Not a bug
          </span>
        </div>
      </div>
    </figure>
  );
}
