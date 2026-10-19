import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIpv4, looksProtected, probePreview, readinessFromResponse, validateTargetUrl } from "./preview";

const headers = (h: Record<string, string> = {}) => new Headers(h);

test("validateTargetUrl accepts a public https URL and drops the fragment", () => {
  const v = validateTargetUrl("https://my-app-git-feature-team.vercel.app/path?x=1#frag");
  assert.ok(v.ok);
  assert.equal(v.url, "https://my-app-git-feature-team.vercel.app/path?x=1");
});

test("validateTargetUrl refuses http, credentials, ports, IP literals and local hosts", () => {
  const bad = [
    "http://my-app.vercel.app",
    "https://user:pw@my-app.vercel.app",
    "https://my-app.vercel.app:8443",
    "https://10.0.0.1",
    "https://127.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://8.8.8.8",
    "https://[::1]",
    "https://localhost",
    "https://app.localhost",
    "https://intranet",
    "https://db.internal",
    "https://metadata.google.internal",
    "ftp://x.example",
    "not a url",
    "",
    null,
  ];
  for (const b of bad) {
    const v = validateTargetUrl(b);
    assert.equal(v.ok, false, `expected refusal for ${JSON.stringify(b)}`);
  }
});

test("isPrivateIpv4 knows the private, loopback, link-local and special ranges", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.1.1", "0.0.0.0", "100.64.0.1"]) {
    assert.ok(isPrivateIpv4(ip), ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1"]) assert.equal(isPrivateIpv4(ip), false, ip);
  assert.equal(isPrivateIpv4("example.com"), false);
});

test("looksProtected sees Vercel Deployment Protection", () => {
  assert.ok(looksProtected(401, headers()));
  assert.ok(looksProtected(403, headers()));
  assert.ok(looksProtected(307, headers({ location: "https://vercel.com/sso-api?url=..." })));
  assert.ok(looksProtected(302, headers({ location: "https://vercel.com/login?next=..." })));
  assert.ok(looksProtected(200, headers({ "x-vercel-protection": "1" })));
  assert.ok(looksProtected(200, headers({ "set-cookie": "_vercel_sso_nonce=abc; Path=/" })));
  assert.equal(looksProtected(200, headers()), false);
  assert.equal(looksProtected(302, headers({ location: "/login" })), false);
});

test("readinessFromResponse maps statuses", () => {
  assert.equal(readinessFromResponse(200, headers()), "ready");
  assert.equal(readinessFromResponse(302, headers({ location: "/home" })), "ready");
  assert.equal(readinessFromResponse(401, headers()), "protected");
  assert.equal(readinessFromResponse(404, headers()), "missing");
  assert.equal(readinessFromResponse(410, headers()), "missing");
  assert.equal(readinessFromResponse(500, headers()), "failed");
  assert.equal(readinessFromResponse(502, headers()), "failed");
});

test("probePreview refuses an unsafe URL without a request, and reports unreachable on a network error", async () => {
  let called = 0;
  const neverFetch = (async () => {
    called += 1;
    throw new Error("should not be called");
  }) as unknown as typeof fetch;
  const unsafe = await probePreview("https://10.0.0.5/", neverFetch);
  assert.equal(unsafe.state, "unsafe");
  assert.equal(called, 0);

  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const down = await probePreview("https://my-app.vercel.app/", failing);
  assert.equal(down.state, "unreachable");

  const ok = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
  const up = await probePreview("https://my-app.vercel.app/", ok);
  assert.equal(up.state, "ready");
  assert.equal(up.url, "https://my-app.vercel.app/");

  const sso = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
  const prot = await probePreview("https://my-app.vercel.app/", sso);
  assert.equal(prot.state, "protected");
});
