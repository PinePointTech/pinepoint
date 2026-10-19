import { test } from "node:test";
import assert from "node:assert/strict";
import { isUndefinedColumn, withRunErrorColumn } from "./run-error";

const undefinedColumn = Object.assign(new Error('column "error" of relation "runs" does not exist'), { code: "42703" });

test("isUndefinedColumn matches only 42703", () => {
  assert.equal(isUndefinedColumn(undefinedColumn), true);
  assert.equal(isUndefinedColumn(Object.assign(new Error("x"), { code: "42P01" })), false);
  assert.equal(isUndefinedColumn(new Error("x")), false);
  assert.equal(isUndefinedColumn(null), false);
});

test("withRunErrorColumn runs the query once when it works", async () => {
  let calls = 0;
  let ensured = 0;
  const value = await withRunErrorColumn(
    async () => {
      calls += 1;
      return "ok";
    },
    async () => {
      ensured += 1;
    },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 1);
  assert.equal(ensured, 0);
});

test("withRunErrorColumn adds the column on 42703 and runs the query again", async () => {
  let calls = 0;
  let ensured = 0;
  const value = await withRunErrorColumn(
    async () => {
      calls += 1;
      if (ensured === 0) throw undefinedColumn;
      return calls;
    },
    async () => {
      ensured += 1;
    },
  );
  assert.equal(value, 2);
  assert.equal(ensured, 1);
});

test("withRunErrorColumn passes every other error on and does not add the column", async () => {
  let ensured = 0;
  await assert.rejects(
    withRunErrorColumn(
      async () => {
        throw new Error("connection reset");
      },
      async () => {
        ensured += 1;
      },
    ),
    /connection reset/,
  );
  assert.equal(ensured, 0);
});

test("withRunErrorColumn tries one time only after the column is added", async () => {
  let calls = 0;
  await assert.rejects(
    withRunErrorColumn(
      async () => {
        calls += 1;
        throw undefinedColumn;
      },
      async () => undefined,
    ),
    /does not exist/,
  );
  assert.equal(calls, 2);
});
