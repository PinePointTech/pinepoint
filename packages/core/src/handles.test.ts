import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { PineHandle } from "./handles";

// Acceptance (VI-8): encrypt a handle, save it, load it and decrypt it to the same value.
// This test needs DATABASE_URL. The test script loads ../../.env.local when it exists.

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const hasDb = Boolean(process.env.DATABASE_URL);

test("saveHandle then loadHandle round-trips through missions.pine_enc", { skip: !hasDb && "DATABASE_URL is not set" }, async () => {
  const { sql } = await import("./db");
  const { saveHandle, loadHandle } = await import("./handles");
  const db = sql();

  const [run] = (await db`
    insert into runs (pr_url, owner, repo, pr_number, status)
    values ('https://github.com/vihuynh72/pinepoint/pull/0', 'vihuynh72', 'pinepoint', 0, 'failed')
    returning id
  `) as Array<{ id: string }>;
  const [mission] = (await db`
    insert into missions (run_id, goal) values (${run!.id}, 'VI-8 handle store test') returning id
  `) as Array<{ id: string }>;

  try {
    const handle: PineHandle = {
      credentials: "ct_" + randomBytes(8).toString("hex"),
      binding: "binding_" + randomBytes(8).toString("hex"),
      sessionName: "sessions/test",
      sessionToken: "ps_" + randomBytes(8).toString("hex"),
      computerId: "computer-1",
      turnId: "turn-1",
    };

    assert.equal(await loadHandle(mission!.id), null, "no handle before save");

    await saveHandle(mission!.id, handle);
    assert.deepEqual(await loadHandle(mission!.id), handle);

    const [row] = (await db`select pine_enc from missions where id = ${mission!.id}`) as Array<{ pine_enc: string }>;
    assert.ok(row!.pine_enc.startsWith("v1."));
    assert.ok(!row!.pine_enc.includes(handle.sessionToken), "the token is not stored in plain text");
    assert.ok(!row!.pine_enc.includes(handle.credentials), "the credentials are not stored in plain text");

    await assert.rejects(saveHandle("00000000-0000-0000-0000-000000000000", handle), /does not exist/);
    assert.equal(await loadHandle("00000000-0000-0000-0000-000000000000"), null);
  } finally {
    await db`delete from missions where id = ${mission!.id}`;
    await db`delete from runs where id = ${run!.id}`;
  }
});
