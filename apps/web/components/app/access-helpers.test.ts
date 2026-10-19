// Pure helpers of the access work (VI-30, VI-33): the same-origin check, the demo repository
// list, and the PR URL parser. The route handlers themselves run against Next and the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOriginRequest, requestOrigin } from "../../lib/auth/csrf";
import { DEFAULT_DEMO_REPOS, demoRepos, isDemoRepo, parsePrUrl } from "../../lib/demo-repos";
import { cookieValue, hashToken, secureCookies } from "../../lib/auth/session";
import { withQuery } from "../../lib/auth/urls";

const ORIGIN = "https://pinepoint.example";
const h = (headers: Record<string, string>) => new Headers(headers);

test("a same-origin fetch passes by Sec-Fetch-Site or by Origin", () => {
  assert.ok(isSameOriginRequest(h({ "sec-fetch-site": "same-origin" }), ORIGIN));
  assert.ok(isSameOriginRequest(h({ origin: ORIGIN }), ORIGIN));
  assert.ok(isSameOriginRequest(h({ "sec-fetch-site": "cross-site", origin: ORIGIN }), ORIGIN));
});

test("a cross-site request is refused, with or without the fetch metadata headers", () => {
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }), ORIGIN), false);
  assert.equal(isSameOriginRequest(h({ origin: "https://evil.example" }), ORIGIN), false);
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "none" }), ORIGIN), false);
  assert.equal(isSameOriginRequest(h({}), ORIGIN), false);
  assert.equal(isSameOriginRequest(h({ referer: "https://evil.example/page" }), ORIGIN), false);
  assert.equal(isSameOriginRequest(h({ referer: "not a url" }), ORIGIN), false);
});

test("an old browser with only a same-origin Referer passes", () => {
  assert.ok(isSameOriginRequest(h({ referer: `${ORIGIN}/app?run=1` }), ORIGIN));
});

test("requestOrigin honors the proxy headers", () => {
  const r = new Request("http://localhost:3000/api/runs", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "pinepoint.example" } });
  assert.equal(requestOrigin(r), ORIGIN);
  assert.equal(requestOrigin(new Request("http://localhost:3000/api/runs")), "http://localhost:3000");
});

test("demoRepos defaults to the public demo and lower-cases the list", () => {
  assert.deepEqual([...demoRepos(undefined)], DEFAULT_DEMO_REPOS);
  assert.deepEqual([...demoRepos("")], DEFAULT_DEMO_REPOS);
  assert.deepEqual([...demoRepos("Acme/Shop, acme/docs ,bad")], ["acme/shop", "acme/docs"]);
  assert.ok(isDemoRepo("VIHUYNH72", "PinePoint"));
  assert.equal(isDemoRepo("acme", "shop"), false);
  assert.ok(isDemoRepo("acme", "shop", "acme/shop"));
});

test("parsePrUrl reads GitHub PR URLs and nothing else", () => {
  assert.deepEqual(parsePrUrl("https://github.com/acme/shop/pull/12"), { owner: "acme", repo: "shop", number: 12 });
  assert.deepEqual(parsePrUrl(" https://github.com/acme/shop/pull/12/files?x=1 "), { owner: "acme", repo: "shop", number: 12 });
  assert.equal(parsePrUrl("https://github.com/acme/shop/issues/12"), null);
  assert.equal(parsePrUrl("https://gitlab.com/acme/shop/pull/12"), null);
  assert.equal(parsePrUrl("http://github.com/acme/shop/pull/12"), null);
});

test("cookieValue reads one cookie from the header", () => {
  assert.equal(cookieValue("a=1; pp_session=tok%20en; b=2", "pp_session"), "tok en");
  assert.equal(cookieValue("a=1", "pp_session"), null);
  assert.equal(cookieValue(null, "pp_session"), null);
});

test("hashToken is a stable SHA-256 hex and never the token", () => {
  const t = "a".repeat(43);
  assert.equal(hashToken(t), hashToken(t));
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), t);
});

test("cookies are Secure on Vercel and behind an https base URL, not on plain local http", () => {
  assert.equal(secureCookies({ VERCEL: "1" }), true);
  assert.equal(secureCookies({ APP_BASE_URL: "https://pinepoint.example" }), true);
  assert.equal(secureCookies({ APP_BASE_URL: "http://localhost:3000" }), false);
  assert.equal(secureCookies({}), false);
});

test("withQuery adds parameters to a relative path", () => {
  assert.equal(withQuery("/app", { auth_error: "bad_state" }), "/app?auth_error=bad_state");
  assert.equal(withQuery("/app?run=1#x", { install: "connected" }), "/app?run=1&install=connected#x");
});
