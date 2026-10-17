import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionReply, formatPtTime } from "./thread";

test("formatPtTime uses PDT in October", () => {
  // 23:32 UTC on 17 Oct 2026 is 4:32 PM PDT (UTC-7).
  assert.equal(formatPtTime(new Date("2026-10-17T23:32:00Z")), "4:32 PM");
});

test("formatPtTime uses PST in January", () => {
  // 17:05 UTC on 15 Jan 2026 is 9:05 AM PST (UTC-8).
  assert.equal(formatPtTime(new Date("2026-01-15T17:05:00Z")), "9:05 AM");
});

test("formatPtTime handles noon and midnight", () => {
  assert.equal(formatPtTime(new Date("2026-10-17T19:00:00Z")), "12:00 PM");
  assert.equal(formatPtTime(new Date("2026-10-17T07:00:00Z")), "12:00 AM");
});

test("decisionReply for bug", () => {
  assert.equal(
    decisionReply("bug", new Date("2026-10-17T23:32:00Z")),
    "Marked as Bug at 4:32 PM PT.",
  );
});

test("decisionReply for not_bug", () => {
  assert.equal(
    decisionReply("not_bug", new Date("2026-10-17T23:32:00Z")),
    "Marked as Not a bug at 4:32 PM PT. PinePoint stores this lesson.",
  );
});
