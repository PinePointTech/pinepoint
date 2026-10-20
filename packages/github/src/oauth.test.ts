import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { authorizeUrl, callbackFailureFromQuery, codeChallenge, DEFAULT_RETURN_TO, newSignInState, openSignInState, safeReturnTo, sealSignInState, STATE_TTL_MS } =
  await import("./oauth");

test("safeReturnTo keeps /app paths with their query and hash", () => {
  assert.equal(safeReturnTo("/app"), "/app");
  assert.equal(safeReturnTo("/app?run=abc&finding=def#x"), "/app?run=abc&finding=def#x");
  assert.equal(safeReturnTo("/app/settings"), "/app/settings");
});

test("safeReturnTo allows the install flow's own routes and nothing else outside /app", () => {
  assert.equal(safeReturnTo("/api/github/install?return_to=%2Fapp"), "/api/github/install?return_to=%2Fapp");
  assert.equal(safeReturnTo("/api/github/install/callback?installation_id=1"), "/api/github/install/callback?installation_id=1");
  assert.equal(safeReturnTo("/api/auth/logout"), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo("/"), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo("/application"), DEFAULT_RETURN_TO);
});

test("safeReturnTo refuses open redirects and odd values", () => {
  for (const bad of [
    null,
    "",
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "/app\u0000",
    "javascript:alert(1)",
    "/app:x",
    "app",
    "x".repeat(3000),
  ]) {
    assert.equal(safeReturnTo(bad), DEFAULT_RETURN_TO, `value ${JSON.stringify(bad)}`);
  }
});

test("a sealed state opens with the matching callback state and keeps its fields", () => {
  const s = newSignInState("/app?run=1", "install", 1_000_000);
  const cookie = sealSignInState(s);
  assert.notEqual(cookie, JSON.stringify(s));
  const back = openSignInState(cookie, s.state, 1_000_000 + 1000);
  assert.deepEqual(back, s);
  assert.equal(back?.purpose, "install");
});

test("a state does not open when it is missing, forged, mismatched or expired", () => {
  const s = newSignInState("/app", "signin", 1_000_000);
  const cookie = sealSignInState(s);
  assert.equal(openSignInState(null, s.state), null);
  assert.equal(openSignInState(cookie, null), null);
  assert.equal(openSignInState(cookie, s.state + "x"), null);
  assert.equal(openSignInState(cookie, "", 1_000_000), null);
  assert.equal(openSignInState("not-a-cookie", s.state), null);
  assert.equal(openSignInState(cookie, s.state, 1_000_000 + STATE_TTL_MS + 1), null);
});

test("each state is random and the verifier is long", () => {
  const a = newSignInState("/app");
  const b = newSignInState("/app");
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.codeVerifier, b.codeVerifier);
  assert.ok(a.codeVerifier.length >= 43);
  assert.ok(a.state.length >= 20);
});

test("authorizeUrl carries the client id, the redirect, the state and an S256 challenge, and no scope", () => {
  const state = newSignInState("/app");
  const url = new URL(authorizeUrl({ clientId: "Iv1.abc", redirectUri: "https://pinepoint.example/api/auth/github/callback", state }));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv1.abc");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pinepoint.example/api/auth/github/callback");
  assert.equal(url.searchParams.get("state"), state.state);
  assert.equal(url.searchParams.get("code_challenge"), codeChallenge(state.codeVerifier));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), null);
  assert.ok(!url.toString().includes(state.codeVerifier), "the verifier never leaves the server");
});

test("callbackFailureFromQuery maps GitHub's error codes", () => {
  assert.equal(callbackFailureFromQuery(new URLSearchParams("code=abc&state=x")), null);
  assert.equal(callbackFailureFromQuery(new URLSearchParams("error=access_denied")), "access_denied");
  assert.equal(callbackFailureFromQuery(new URLSearchParams("error=server_error")), "github_error");
});
