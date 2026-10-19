import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLifecycleEvent, verifyInstallationForUser, type InstallationFacts } from "./installations";

const installation = {
  id: 501,
  account: { id: 77, login: "acme", type: "Organization" },
  repository_selection: "selected",
  permissions: { contents: "read", pull_requests: "write", metadata: "read" },
  suspended_at: null,
};
const repo = (id: number, name: string) => ({ id, full_name: `acme/${name}`, name, private: true });

test("installation created carries the account, the selection and the repositories", () => {
  const e = parseLifecycleEvent("installation", { action: "created", installation, sender: { id: 9, login: "alice" }, repositories: [repo(1, "web"), repo(2, "api")] });
  assert.equal(e.kind, "installation");
  if (e.kind !== "installation") return;
  assert.equal(e.action, "created");
  assert.equal(e.facts.installationId, 501);
  assert.deepEqual(e.facts.account, { id: 77, login: "acme", type: "Organization" });
  assert.equal(e.facts.repositorySelection, "selected");
  assert.equal(e.facts.suspended, false);
  assert.equal(e.facts.installedByGithubUserId, 9);
  assert.deepEqual(
    e.repositories.map((r) => r.fullName),
    ["acme/web", "acme/api"],
  );
});

test("suspend, unsuspend and deleted map to their actions and the suspended flag", () => {
  const s = parseLifecycleEvent("installation", { action: "suspend", installation: { ...installation, suspended_at: "2026-01-01T00:00:00Z" } });
  assert.equal(s.kind === "installation" && s.facts.suspended, true);
  const u = parseLifecycleEvent("installation", { action: "unsuspend", installation: { ...installation, suspended_at: "2026-01-01T00:00:00Z" } });
  assert.equal(u.kind === "installation" && u.facts.suspended, false);
  const d = parseLifecycleEvent("installation", { action: "deleted", installation });
  assert.equal(d.kind === "installation" && d.action, "deleted");
});

test("installation_repositories lists added and removed", () => {
  const e = parseLifecycleEvent("installation_repositories", {
    action: "added",
    installation,
    repositories_added: [repo(3, "docs")],
    repositories_removed: [repo(2, "api")],
  });
  assert.equal(e.kind, "installation_repositories");
  if (e.kind !== "installation_repositories") return;
  assert.equal(e.installationId, 501);
  assert.deepEqual(
    e.added.map((r) => [r.id, r.fullName, r.ownerLogin]),
    [[3, "acme/docs", "acme"]],
  );
  assert.deepEqual(e.removed, [2]);
});

test("github_app_authorization revoked names the user; other shapes are ignored", () => {
  const r = parseLifecycleEvent("github_app_authorization", { action: "revoked", sender: { id: 9, login: "alice" } });
  assert.deepEqual(r, { kind: "authorization_revoked", githubUserId: 9 });
  assert.equal(parseLifecycleEvent("github_app_authorization", { action: "other", sender: { id: 9 } }).kind, "ignored");
  assert.equal(parseLifecycleEvent("installation", { action: "created" }).kind, "ignored");
  assert.equal(parseLifecycleEvent("installation", { action: "renamed", installation }).kind, "ignored");
  assert.equal(parseLifecycleEvent("pull_request", { action: "opened", installation }).kind, "ignored");
  assert.equal(parseLifecycleEvent(null, null).kind, "ignored");
});

test("verifyInstallationForUser needs the app to know it and the person to see it", async () => {
  const facts: InstallationFacts = {
    installationId: 501,
    account: { id: 77, login: "acme", type: "Organization" },
    repositorySelection: "selected",
    permissions: {},
    suspended: false,
    installedByGithubUserId: null,
  };
  const known = async (id: number) => (id === 501 ? facts : null);
  const ok = await verifyInstallationForUser(501, { readInstallation: known, userInstallationIds: async () => new Set([501, 502]) });
  assert.deepEqual(ok, { ok: true, facts });
  const invisible = await verifyInstallationForUser(501, { readInstallation: known, userInstallationIds: async () => new Set([502]) });
  assert.deepEqual(invisible, { ok: false, reason: "not_visible_to_user" });
  const unknown = await verifyInstallationForUser(999, { readInstallation: known, userInstallationIds: async () => new Set([999]) });
  assert.deepEqual(unknown, { ok: false, reason: "not_found" });
});
