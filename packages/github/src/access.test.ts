import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFromFacts, permissionFromRepo, type AccessFacts } from "./access";

const base: AccessFacts = {
  repoSelected: true,
  installationStatus: "active",
  permission: "push",
  member: true,
  accountType: "Organization",
  repoIdMatches: true,
};

test("an organization member with push may view and launch, not configure", () => {
  const a = accessFromFacts(base);
  assert.equal(a.state, "ok");
  assert.equal(a.level, "write");
  assert.deepEqual([a.canView, a.canLaunch, a.canConfigure], [true, true, false]);
});

test("maintain and admin may configure", () => {
  for (const permission of ["maintain", "admin"] as const) {
    const a = accessFromFacts({ ...base, permission });
    assert.equal(a.level, "configure");
    assert.ok(a.canConfigure);
  }
});

test("read-only people see nothing: viewing needs write in v1", () => {
  for (const permission of ["pull", "triage"] as const) {
    const a = accessFromFacts({ ...base, permission });
    assert.equal(a.state, "read_only");
    assert.equal(a.level, "read");
    assert.deepEqual([a.canView, a.canLaunch, a.canConfigure], [false, false, false]);
  }
});

test("an outside collaborator with write is denied: members only", () => {
  const a = accessFromFacts({ ...base, member: false });
  assert.equal(a.state, "not_member");
  assert.equal(a.canLaunch, false);
  assert.match(a.reason, /Outside collaborators/);
});

test("unknown membership fails closed", () => {
  const a = accessFromFacts({ ...base, member: "unknown" });
  assert.equal(a.state, "unknown");
  assert.equal(a.canView, false);
});

test("a personal account: the owner may launch, others may not", () => {
  const owner = accessFromFacts({ ...base, accountType: "User", member: true, permission: "admin" });
  assert.equal(owner.state, "ok");
  const other = accessFromFacts({ ...base, accountType: "User", member: false });
  assert.equal(other.state, "not_member");
  assert.match(other.reason, /owner of this account/);
});

test("installation and selection state come before GitHub permission", () => {
  assert.equal(accessFromFacts({ ...base, repoSelected: false }).state, "not_selected");
  assert.equal(accessFromFacts({ ...base, installationStatus: "suspended" }).state, "installation_suspended");
  assert.equal(accessFromFacts({ ...base, installationStatus: "deleted" }).state, "installation_deleted");
  assert.equal(accessFromFacts({ ...base, installationStatus: null }).state, "installation_deleted");
  assert.equal(accessFromFacts({ ...base, repoIdMatches: false }).state, "repo_mismatch");
  assert.equal(accessFromFacts({ ...base, permission: "none" }).state, "no_github_access");
  for (const f of [{ repoSelected: false }, { installationStatus: "suspended" as const }, { repoIdMatches: false }, { permission: "none" as const }]) {
    const a = accessFromFacts({ ...base, ...f });
    assert.equal(a.level, "none");
    assert.equal(a.canView, false);
  }
});

test("reasons never carry a token or an id", () => {
  for (const f of [base, { ...base, member: false }, { ...base, permission: "pull" as const }, { ...base, repoSelected: false }]) {
    const a = accessFromFacts(f);
    assert.doesNotMatch(a.reason, /gh[pousr]_|[0-9a-f]{8}-[0-9a-f]{4}/i);
  }
});

test("permissionFromRepo picks the highest capability", () => {
  assert.equal(permissionFromRepo({ admin: true, maintain: true, push: true, pull: true }), "admin");
  assert.equal(permissionFromRepo({ maintain: true, push: true, pull: true }), "maintain");
  assert.equal(permissionFromRepo({ push: true, pull: true }), "push");
  assert.equal(permissionFromRepo({ triage: true, pull: true }), "triage");
  assert.equal(permissionFromRepo({ pull: true }), "pull");
  assert.equal(permissionFromRepo({}), "none");
  assert.equal(permissionFromRepo(null), "none");
});
