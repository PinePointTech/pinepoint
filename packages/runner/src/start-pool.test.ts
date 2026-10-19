import { test } from "node:test";
import assert from "node:assert/strict";
import { runStartPool, type StartOutcome } from "./start-pool";

const noSleep = async () => undefined;

test("runStartPool starts every item and never runs more than `concurrency` at once", async () => {
  let active = 0;
  let peak = 0;
  const seen: number[] = [];
  const res = await runStartPool([1, 2, 3, 4, 5, 6, 7], async (n): Promise<StartOutcome> => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(n);
    active -= 1;
    return "started";
  }, { concurrency: 3, gapMs: 0, sleep: noSleep });
  assert.equal(res.started, 7);
  assert.deepEqual(res.notLaunched, []);
  assert.equal(peak, 3);
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});

test("runStartPool stops launching after a stop and returns the items never sent", async () => {
  const sent: number[] = [];
  const res = await runStartPool([1, 2, 3, 4, 5, 6], async (n): Promise<StartOutcome> => {
    sent.push(n);
    return n === 2 ? "stop" : "started";
  }, { concurrency: 1, gapMs: 0, sleep: noSleep });
  assert.deepEqual(sent, [1, 2]);
  assert.equal(res.started, 1);
  assert.deepEqual(res.notLaunched, [3, 4, 5, 6]);
});

test("runStartPool counts failed starts as not started but keeps going", async () => {
  const res = await runStartPool([1, 2, 3], async (n): Promise<StartOutcome> => (n === 2 ? "failed" : "started"), {
    concurrency: 2,
    gapMs: 0,
    sleep: noSleep,
  });
  assert.equal(res.started, 2);
  assert.deepEqual(res.notLaunched, []);
});

test("runStartPool staggers the workers by gapMs", async () => {
  const sleeps: number[] = [];
  await runStartPool([1, 2, 3], async () => "started", {
    concurrency: 3,
    gapMs: 300,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.deepEqual(sleeps.sort((a, b) => a - b), [300, 600]);
});
