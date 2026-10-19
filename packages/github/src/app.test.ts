import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { appJwt, exchangeCode, githubAppConfigured, githubAppEnvStatus, installUrl, normalizePrivateKey, OAuthTokenError, parseTokenResponse } from "./app";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

test("parseTokenResponse keeps both tokens and computes expiries", () => {
  const now = 1_700_000_000_000;
  const t = parseTokenResponse(
    { access_token: "ghu_a", expires_in: 28800, refresh_token: "ghr_b", refresh_token_expires_in: 15897600, token_type: "bearer" },
    now,
  );
  assert.equal(t.accessToken, "ghu_a");
  assert.equal(t.refreshToken, "ghr_b");
  assert.equal(t.accessExpiresAt, new Date(now + 28800 * 1000).toISOString());
  assert.equal(t.refreshExpiresAt, new Date(now + 15897600 * 1000).toISOString());
});

test("parseTokenResponse accepts a non-expiring token and throws on an error body", () => {
  const t = parseTokenResponse({ access_token: "ghu_a", token_type: "bearer" }, 5);
  assert.equal(t.accessExpiresAt, null);
  assert.equal(t.refreshToken, null);
  assert.throws(() => parseTokenResponse({ error: "bad_verification_code", error_description: "The code passed is incorrect." }), (err: unknown) => {
    assert.ok(err instanceof OAuthTokenError);
    assert.equal(err.code, "bad_verification_code");
    return true;
  });
  assert.throws(() => parseTokenResponse({}), OAuthTokenError);
});

test("appJwt is an RS256 token for the app id with a short life, verifiable with the public key", () => {
  const now = 1_700_000_000;
  const jwt = appJwt({ appId: "12345", privateKey: PEM }, now);
  const [h, p, sig] = jwt.split(".");
  assert.ok(h && p && sig);
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, now - 60);
  assert.equal(payload.exp, now + 9 * 60);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  assert.ok(verifier.verify(createPublicKey(privateKey), Buffer.from(sig, "base64url")));
});

test("normalizePrivateKey turns a one-line env value with \\n into PEM", () => {
  const oneLine = PEM.replace(/\n/g, "\\n");
  assert.equal(normalizePrivateKey(oneLine), PEM.trim());
  assert.equal(normalizePrivateKey(PEM), PEM.trim());
  assert.equal(normalizePrivateKey(Buffer.from(PEM).toString("base64")), PEM.trim());
  assert.throws(() => normalizePrivateKey("not a key"), /not a PEM/);
});

test("githubAppEnvStatus reports each field and sign-in is configured only with id, secret and slug", () => {
  const env = { GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "pinepoint", GITHUB_APP_CLIENT_ID: "Iv1.x" };
  const status = githubAppEnvStatus(env);
  assert.equal(status.GITHUB_APP_CLIENT_SECRET, false);
  assert.equal(status.GITHUB_APP_PRIVATE_KEY, false);
  assert.equal(status.GITHUB_APP_CLIENT_ID, true);
  assert.equal(githubAppConfigured(env), false);
  assert.equal(githubAppConfigured({ ...env, GITHUB_APP_CLIENT_SECRET: "s" }), true);
  assert.equal(githubAppConfigured({}), false);
});

test("installUrl points at the app's installation page with the state", () => {
  assert.equal(installUrl("pinepoint-qa", "abc"), "https://github.com/apps/pinepoint-qa/installations/new?state=abc");
  assert.equal(installUrl("pinepoint-qa"), "https://github.com/apps/pinepoint-qa/installations/new");
});

test("exchangeCode posts the client secret in the body, never in the URL, and parses the answer", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ access_token: "ghu_x", expires_in: 100, refresh_token: "ghr_y", refresh_token_expires_in: 1000, token_type: "bearer" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const config = { appId: "1", slug: "s", clientId: "Iv1.c", clientSecret: "shh", privateKey: PEM };
  const tokens = await exchangeCode(config, { code: "c0de", redirectUri: "https://x.example/cb", codeVerifier: "v" }, fetchFn);
  assert.equal(tokens.accessToken, "ghu_x");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://github.com/login/oauth/access_token");
  assert.equal(calls[0]!.init.method, "POST");
  const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, string>;
  assert.equal(body.client_secret, "shh");
  assert.equal(body.code, "c0de");
  assert.equal(body.code_verifier, "v");
  assert.equal(body.redirect_uri, "https://x.example/cb");
  assert.ok(!calls[0]!.url.includes("shh"));
});
