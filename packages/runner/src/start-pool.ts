// Starts Computers a few at a time instead of one after another. Pure: the start function is passed in.

/** What one start did. "stop" means Pine refused more creates for now (rate limit or capacity). */
export type StartOutcome = "started" | "failed" | "stop";

export interface PoolResult<T> {
  started: number;
  /** Items that were never sent because a start answered "stop". They go back to the queue. */
  notLaunched: T[];
}

/**
 * Runs `start` over `items` with at most `concurrency` starts at the same time. Each worker begins
 * `gapMs` after the one before it, so the creates do not all land in the same instant. After a
 * "stop", no new start begins; the starts already in flight finish.
 */
export async function runStartPool<T>(
  items: T[],
  start: (item: T) => Promise<StartOutcome>,
  opts: { concurrency: number; gapMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<PoolResult<T>> {
  const wait = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let next = 0;
  let stopped = false;
  let started = 0;
  const worker = async (w: number) => {
    if (w > 0) await wait(opts.gapMs * w);
    while (!stopped && next < items.length) {
      const outcome = await start(items[next++]!);
      if (outcome === "started") started += 1;
      if (outcome === "stop") stopped = true;
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
  return { started, notLaunched: stopped ? items.slice(next) : [] };
}
