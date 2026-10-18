import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSuggestionPayload, fenceFor, proposedFixReply, suggestionBody, type SuggestedFix } from "./fix";

const REF = { owner: "vihuynh72", repo: "pinepoint", number: 10 };

const fix: SuggestedFix = {
  path: "apps/demo-store/lib/cart.ts",
  startLine: 35,
  endLine: 37,
  replacement: "  if (a) {\n    return b;\n  }\n",
  explanation: "The change removed the check. The fix puts it back.",
};

test("suggestionBody has the explanation and a suggestion block without a final newline", () => {
  assert.equal(
    suggestionBody(fix),
    ["Proposed fix: The change removed the check. The fix puts it back.", "", "```suggestion", "  if (a) {", "    return b;", "  }", "```"].join(
      "\n",
    ),
  );
});

test("fenceFor grows when the replacement has backticks", () => {
  assert.equal(fenceFor("plain"), "```");
  assert.equal(fenceFor("a ```js b"), "````");
  assert.equal(fenceFor("a ````` b"), "``````");
  assert.ok(suggestionBody({ ...fix, replacement: "```" }).startsWith("Proposed fix: The change removed the check. The fix puts it back.\n\n````suggestion\n```\n````"));
});

test("buildSuggestionPayload sets start_line and line on the right side", () => {
  const payload = buildSuggestionPayload(REF, "abc123", fix);
  assert.equal(payload.owner, "vihuynh72");
  assert.equal(payload.pull_number, 10);
  assert.equal(payload.commit_id, "abc123");
  assert.equal(payload.path, fix.path);
  assert.equal(payload.start_line, 35);
  assert.equal(payload.start_side, "RIGHT");
  assert.equal(payload.line, 37);
  assert.equal(payload.side, "RIGHT");
  assert.equal(payload.body, suggestionBody(fix));
});

test("buildSuggestionPayload leaves start_line out for a one-line range", () => {
  const payload = buildSuggestionPayload(REF, "abc123", { ...fix, startLine: 36, endLine: 36 });
  assert.equal(payload.line, 36);
  assert.equal("start_line" in payload, false);
  assert.equal("start_side" in payload, false);
});

test("proposedFixReply", () => {
  assert.equal(proposedFixReply("https://github.com/x/y/pull/1#discussion_r1"), "Proposed fix: https://github.com/x/y/pull/1#discussion_r1");
});
