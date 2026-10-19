import { test } from "node:test";
import assert from "node:assert/strict";
import type { MissionStatus } from "@/lib/app-types";
import { KEPT_MS, screenFor, type Screen } from "./screen";

const NOW = Date.parse("2026-10-19T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Row = {
  name: string;
  status?: MissionStatus;
  kept?: boolean;
  hasComputer?: boolean;
  finishedAt?: string | null;
  fake?: boolean;
  gone?: boolean;
  want: Screen;
};

const rows: Row[] = [
  { name: "queued: no desktop request", status: "queued", want: { kind: "queued" } },
  { name: "queued sample data", status: "queued", fake: true, want: { kind: "queued" } },
  { name: "running, no Computer yet", status: "running", hasComputer: false, want: { kind: "starting" } },
  { name: "running with a Computer", status: "running", hasComputer: true, want: { kind: "live" } },
  { name: "running, older API without has_computer", status: "running", want: { kind: "live" } },
  { name: "needs you, with a Computer", status: "needs_you", hasComputer: true, want: { kind: "live" } },
  { name: "older caller with no status", want: { kind: "live" } },
  {
    name: "kept, ended 1 hour ago",
    status: "failed",
    kept: true,
    hasComputer: true,
    finishedAt: ago(60 * 60 * 1000),
    want: { kind: "live" },
  },
  { name: "kept, no finish time yet", status: "failed", kept: true, hasComputer: true, want: { kind: "live" } },
  {
    name: "kept, ended over 24 hours ago",
    status: "failed",
    kept: true,
    hasComputer: true,
    finishedAt: ago(KEPT_MS + 1000),
    want: { kind: "last", reason: "ended" },
  },
  {
    name: "ended and not kept",
    status: "passed",
    kept: false,
    hasComputer: true,
    finishedAt: ago(5000),
    want: { kind: "last", reason: "ended" },
  },
  {
    name: "gone after the user finished",
    status: "failed",
    kept: true,
    hasComputer: true,
    finishedAt: ago(5000),
    gone: true,
    want: { kind: "last", reason: "ended" },
  },
  {
    name: "gone while running",
    status: "running",
    hasComputer: true,
    gone: true,
    want: { kind: "last", reason: "gone" },
  },
  {
    name: "ended, the Computer never started",
    status: "error",
    hasComputer: false,
    finishedAt: ago(5000),
    want: { kind: "last", reason: "no_computer" },
  },
  {
    name: "needs you without a Computer",
    status: "needs_you",
    hasComputer: false,
    want: { kind: "last", reason: "not_started" },
  },
  {
    name: "sample data that ended",
    status: "failed",
    kept: true,
    hasComputer: true,
    finishedAt: ago(5000),
    fake: true,
    want: { kind: "last", reason: "sample" },
  },
  {
    name: "sample data that runs",
    status: "running",
    hasComputer: true,
    fake: true,
    want: { kind: "last", reason: "sample" },
  },
];

for (const r of rows) {
  test(`screenFor: ${r.name}`, () => {
    const got = screenFor(
      { status: r.status, kept: r.kept, hasComputer: r.hasComputer, finishedAt: r.finishedAt, fake: r.fake ?? false },
      r.gone ?? false,
      NOW,
    );
    assert.deepEqual(got, r.want);
  });
}
