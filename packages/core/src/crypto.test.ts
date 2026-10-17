import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// The crypto tests do not need a real key. Use a throwaway one when the env has none.
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { encrypt, decrypt } = await import("./crypto");

test("encrypt then decrypt returns the same value", () => {
  const plain = JSON.stringify({ sessionToken: "ps_secret", credentials: "ct_secret" });
  assert.equal(decrypt(encrypt(plain)), plain);
});

test("the token hides the plaintext and differs on each call", () => {
  const plain = "ps_secret_token";
  const a = encrypt(plain);
  const b = encrypt(plain);
  assert.ok(!a.includes(plain));
  assert.notEqual(a, b);
  assert.match(a, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/);
});

test("a changed token does not decrypt", () => {
  const token = encrypt("hello");
  const parts = token.split(".");
  const ct = Buffer.from(parts[2]!, "base64url");
  ct[0] = ct[0]! ^ 0xff;
  parts[2] = ct.toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
  assert.throws(() => decrypt("not-a-token"));
});

test("a different key does not decrypt", () => {
  const token = encrypt("hello");
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    assert.throws(() => decrypt(token));
  } finally {
    process.env.ENCRYPTION_KEY = original;
  }
});
