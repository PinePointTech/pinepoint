import { test } from "node:test";
import assert from "node:assert/strict";
import { shotIdFromPath, shotPath } from "./shots";

const ID = "0b9a4c6e-2f1d-4e8a-9c3b-7d5e6f708192";

test("shotIdFromPath reads the id back from shotPath", () => {
  assert.equal(shotIdFromPath(shotPath(ID)), ID);
  assert.equal(shotIdFromPath(`/api/shots/${ID.toUpperCase()}`), ID.toUpperCase());
});

test("shotIdFromPath gives null for other values", () => {
  assert.equal(shotIdFromPath(null), null);
  assert.equal(shotIdFromPath(undefined), null);
  assert.equal(shotIdFromPath(""), null);
  assert.equal(shotIdFromPath("/api/shots/not-a-uuid"), null);
  assert.equal(shotIdFromPath(`https://app.example/api/shots/${ID}`), null, "an absolute URL is not a path");
  assert.equal(shotIdFromPath(`/api/shots/${ID}/extra`), null);
  assert.equal(shotIdFromPath("https://blob.example/fail.png"), null);
});
