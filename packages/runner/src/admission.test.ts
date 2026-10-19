import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "@pinepoint/core";
import { admissionDeniedText, admissionKeys, dayKey } from "./admission";
import { ownershipColumns } from "./create";

const scope = { userId: "u1", repositoryId: "r1", workspaceId: "w1" };

test("admissionKeys gives one key per scope with the contract's limits", () => {
  const keys = admissionKeys(scope, Date.UTC(2026, 9, 19, 23, 30));
  assert.deepEqual(
    keys.map((k) => [k.name, k.key, k.limit, k.releases]),
    [
      ["user", "user:u1", LIMITS.userConcurrent, true],
      ["repository", "repo:r1", LIMITS.repositoryConcurrent, true],
      ["workspace", "ws:w1", LIMITS.workspaceConcurrent, true],
      ["workspace_day", "ws:w1:day:2026-10-19", LIMITS.workspaceDaily, false],
    ],
  );
});

test("the day key is the UTC day, so the daily quota resets at midnight UTC", () => {
  assert.equal(dayKey(Date.UTC(2026, 0, 1, 0, 0, 0)), "2026-01-01");
  assert.equal(dayKey(Date.UTC(2025, 11, 31, 23, 59, 59)), "2025-12-31");
});

test("admissionDeniedText names the scope and the limit", () => {
  assert.match(admissionDeniedText({ admitted: false, scope: "workspace_day", limit: 20 }), /20/);
  assert.match(admissionDeniedText({ admitted: false, scope: "user", limit: 2 }), /2/);
});

test("ownershipColumns: legacy without an owner, manual with all three ids, and no half owner", () => {
  assert.deepEqual(ownershipColumns(null), { workspace_id: null, repository_id: null, initiated_by_user_id: null, trigger: "legacy" });
  assert.deepEqual(ownershipColumns(undefined).trigger, "legacy");
  assert.deepEqual(ownershipColumns({ workspaceId: "w", repositoryId: "r", initiatedByUserId: "u" }), {
    workspace_id: "w",
    repository_id: "r",
    initiated_by_user_id: "u",
    trigger: "manual",
  });
  assert.throws(() => ownershipColumns({ workspaceId: "w", repositoryId: "", initiatedByUserId: "u" }), /needs workspaceId, repositoryId and initiatedByUserId/);
});
