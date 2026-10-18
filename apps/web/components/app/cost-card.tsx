"use client";

import { useMemo } from "react";
import type { Mission, Run } from "@/lib/app-types";
import {
  costAt,
  MEASURED_PER_MISSION,
  MODEL_PRICES,
  PRICE_SOURCES,
  PRICES_AS_OF,
  totalTokens,
  usageFromMissions,
  type ModelPrice,
} from "@/lib/model-prices";

const RUN_LABEL = "This run on Pine";

// Bars: this run in the brand green, every model in a soft warm gray.
// The gray is below 3:1 on the surface by design (de-emphasis), so every
// bar carries a visible value label and the table below has all values.
const MODEL_BAR = "bg-[#cbc3b3] dark:bg-[#5a554c]";
const RUN_BAR = "bg-accent";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function toNumber(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

function formatUsd(v: number): string {
  if (v > 0 && v < 0.001) return "<$0.001";
  // Runs cost cents, so show a third decimal below one dollar.
  return v > 0 && v < 1 ? usdSmall.format(v) : usd.format(v);
}

// $4, $0.10, $0.125, $12.50: at least two decimals, a third only when the price has one.
function formatPrice(v: number): string {
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(3).replace(/0$/, "")}`;
}

type Row = {
  key: string;
  label: string;
  value: number;
  isRun: boolean;
  estimate?: boolean;
  price?: ModelPrice;
};

export function CostCard({ run, missions }: { run: Run; missions: Mission[] }) {
  const usage = useMemo(() => usageFromMissions(missions), [missions]);
  // runs.cost_usd wins when the runner writes it. Else the sum of what Pine charged for each mission.
  const actual = toNumber(run.cost_usd) ?? usage.pineCost;
  const actualValue = actual ?? 0;

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      { key: "run", label: RUN_LABEL, value: actualValue, isRun: true, estimate: usage.estimate },
      ...MODEL_PRICES.map((price) => ({
        key: price.modelId,
        label: price.model,
        value: costAt(price, usage),
        isRun: false,
        price,
      })),
    ];
    // Cheapest first. Array sort is stable, so ties keep list order.
    return all.sort((a, b) => a.value - b.value);
  }, [actualValue, usage]);

  const max = Math.max(0, ...rows.map((r) => r.value));
  const notes = MODEL_PRICES.filter((p) => p.note);

  return (
    <section
      aria-labelledby="cost-card-title"
      className="rounded-[20px] border border-border bg-surface p-5 text-fg sm:p-6"
    >
      <h2 id="cost-card-title" className="text-sm font-semibold text-muted">
        Cost of this run
      </h2>
      <p className="mt-1 text-5xl font-semibold tracking-tight">
        {formatUsd(actualValue)}
      </p>
      <p className="mt-1 text-sm text-muted">
        {actual === null
          ? "Pine did not price these turns."
          : usage.estimate
            ? "Estimated from what Pine charged on real missions."
            : `What Pine charged for the agent's model use on ${usage.missions} ${usage.missions === 1 ? "mission" : "missions"}. Pine does not price the Computer time yet.`}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TokenFigure label="Cache reads" value={usage.cacheRead} />
        <TokenFigure label="Cache writes" value={usage.cacheWrite} />
        <TokenFigure label="Other input" value={usage.input} />
        <TokenFigure label="Output" value={usage.output} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        {int.format(totalTokens(usage))} tokens in total. Pine reports them for each mission.
        The planner call to Claude is not in these numbers.
      </p>

      {usage.estimate && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/40 dark:text-amber-200">
            Estimate
          </span>
          <span>No mission has reported usage yet.</span>
        </div>
      )}

      {usage.estimate && (
        <details className="mt-2 text-xs text-muted">
          <summary className="w-fit cursor-pointer rounded-xl py-1 underline decoration-border underline-offset-2 hover:text-fg">
            How we estimate
          </summary>
          <p className="mt-1 rounded-2xl bg-surface-2/60 px-3 py-2 leading-relaxed">
            We measured {MEASURED_PER_MISSION.sample} real missions. One mission used{" "}
            {int.format(MEASURED_PER_MISSION.cacheRead)} cache reads,{" "}
            {int.format(MEASURED_PER_MISSION.cacheWrite)} cache writes,{" "}
            {int.format(MEASURED_PER_MISSION.input)} other input tokens and{" "}
            {int.format(MEASURED_PER_MISSION.output)} output tokens on average, and Pine
            charged {usdSmall.format(MEASURED_PER_MISSION.pineCost)}. The estimate is that
            average times 10 missions.
          </p>
        </details>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">The same tokens at list prices</h3>
        <p className="mt-0.5 text-xs text-muted">
          Each bar shows the cost of these tokens on one model, with its cache rates.
        </p>

        <div className="@container mt-4">
          <ul aria-hidden="true" className="space-y-1">
            {rows.map((row) => (
              <BarRow key={row.key} row={row} max={max} />
            ))}
          </ul>

          {/* A table ignores width: 1px, so the wrapper carries sr-only. */}
          <div className="sr-only">
            <table>
              <caption>
                Cost of this run and of the same tokens at list prices, cheapest
                first. Cache reads: {int.format(usage.cacheRead)} tokens. Cache
                writes: {int.format(usage.cacheWrite)} tokens. Other input:{" "}
                {int.format(usage.input)} tokens. Output: {int.format(usage.output)} tokens.
                {usage.estimate ? " The token numbers are an estimate." : ""}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Input price per 1M tokens</th>
                  <th scope="col">Cache hit price per 1M tokens</th>
                  <th scope="col">Output price per 1M tokens</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      {row.price ? `${row.price.provider} ${row.label}` : row.label}
                    </th>
                    <td>{row.price ? row.price.tier : usage.estimate ? "Estimate" : "Actual cost"}</td>
                    <td>{row.price ? formatPrice(row.price.inputPerMTok) : "Not applicable"}</td>
                    <td>{row.price ? formatPrice(row.price.cacheReadPerMTok) : "Not applicable"}</td>
                    <td>{row.price ? formatPrice(row.price.outputPerMTok) : "Not applicable"}</td>
                    <td>{formatUsd(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 space-y-1 text-xs leading-relaxed text-muted">
          <p>
            List prices per 1M tokens, standard tier, as of {PRICES_AS_OF}. Cache
            writes and cache hits use each provider&apos;s cache rates.
            Sources:{" "}
            {PRICE_SOURCES.map((s, i) => (
              <span key={s.provider}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm underline decoration-border underline-offset-2 hover:text-fg"
                >
                  {s.provider}
                </a>
                {i < PRICE_SOURCES.length - 1 ? ", " : "."}
              </span>
            ))}
          </p>
          {notes.map((p) => (
            <p key={p.modelId}>
              {p.model}: {p.note}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function TokenFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold break-words">{int.format(value)}</dd>
    </div>
  );
}

function BarRow({ row, max }: { row: Row; max: number }) {
  const frac = max > 0 ? row.value / max : 0;
  // Reserve 5rem after the bar for the value label, so the longest bar
  // and its label always fit. A small non-zero value keeps a visible nub.
  // A zero value has no bar.
  const width = `max(6px, calc((100% - 5rem) * ${frac.toFixed(4)}))`;

  return (
    <li className="group -mx-2 grid gap-1.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2/60 @lg:grid-cols-[15rem_minmax(0,1fr)] @lg:items-center @lg:gap-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-sm ${row.isRun ? "font-semibold" : ""}`}>
          {row.label}
        </span>
        {row.price ? (
          <>
            <span className="rounded-full border border-border px-1.5 text-[11px] leading-4 text-muted">
              {row.price.tier}
            </span>
            <span className="text-[11px] text-muted tabular-nums @lg:basis-full">
              {formatPrice(row.price.inputPerMTok)} in / {formatPrice(row.price.cacheReadPerMTok)} cached / {formatPrice(row.price.outputPerMTok)} out
            </span>
          </>
        ) : (
          <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 text-[11px] leading-4 text-fg">
            {row.estimate ? "estimate" : "actual"}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {row.value > 0 && (
          <div
            className={`h-3.5 shrink-0 rounded-full transition-[filter] group-hover:brightness-95 dark:group-hover:brightness-125 ${
              row.isRun ? RUN_BAR : MODEL_BAR
            }`}
            style={{ width }}
          />
        )}
        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatUsd(row.value)}
        </span>
      </div>
    </li>
  );
}
