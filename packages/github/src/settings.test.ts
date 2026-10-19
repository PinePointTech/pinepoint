import { test } from "node:test";
import assert from "node:assert/strict";
import { toQaConfig, validateProjectName, validateQaPath, validateSettings } from "./settings";

test("validateQaPath accepts repository-relative paths and refuses escapes", () => {
  assert.deepEqual(validateQaPath("qa.md"), { ok: true, value: "qa.md" });
  assert.deepEqual(validateQaPath(" apps/web/QA.md "), { ok: true, value: "apps/web/QA.md" });
  for (const bad of ["", "/qa.md", "../qa.md", "docs/../../x", "a//b", "a\\b", "a\u0000b", "x".repeat(201), 42, null]) {
    assert.equal(validateQaPath(bad).ok, false, JSON.stringify(bad));
  }
});

test("validateProjectName allows empty and Vercel-shaped names", () => {
  assert.deepEqual(validateProjectName(""), { ok: true, value: null });
  assert.deepEqual(validateProjectName(null), { ok: true, value: null });
  assert.deepEqual(validateProjectName("my-app_2.0"), { ok: true, value: "my-app_2.0" });
  assert.equal(validateProjectName("has space").ok, false);
  assert.equal(validateProjectName("-leading").ok, false);
  assert.equal(validateProjectName(7).ok, false);
});

test("validateSettings applies the URL policy to the production URL and fills the default path", () => {
  const ok = validateSettings({ previewProjectName: "shop", productionUrl: "https://shop.example.com/#x" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { qa_md_path: "qa.md", preview_project_name: "shop", production_url: "https://shop.example.com/" });
  assert.equal(validateSettings({ productionUrl: "http://shop.example.com" }).ok, false);
  assert.equal(validateSettings({ productionUrl: "https://10.0.0.1" }).ok, false);
  assert.equal(validateSettings({ qaMdPath: "../x" }).ok, false);
  const none = validateSettings({ productionUrl: "" });
  assert.ok(none.ok && none.value.production_url === null);
});

test("toQaConfig maps columns to the context config", () => {
  assert.deepEqual(toQaConfig({ qa_md_path: "docs/qa.md", preview_project_name: null, production_url: "https://x.example" }), {
    qaMdPath: "docs/qa.md",
    previewProjectName: null,
    productionUrl: "https://x.example",
  });
});
