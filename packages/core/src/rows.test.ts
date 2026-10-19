import { test } from "node:test";
import assert from "node:assert/strict";
import { toPublicMission, type MissionRow } from "./rows";

const mission: MissionRow = {
  id: "m1",
  run_id: "r1",
  kind: "preview",
  parent_id: null,
  lens: "Flow",
  persona: "Visitor",
  goal: "Buy one apron.",
  checks: [],
  target_path: null,
  target_line: null,
  new_feature: false,
  url: "https://preview.example",
  status: "failed",
  result: null,
  screenshot_url: null,
  usage: null,
  pine_enc: "v1:secret",
  kept: true,
  started_at: null,
  finished_at: null,
};

test("toPublicMission drops pine_enc and sets has_computer when a handle is stored", () => {
  const row = toPublicMission(mission);
  assert.equal("pine_enc" in row, false);
  assert.equal(row.has_computer, true);
  assert.equal(row.kept, true);
  assert.equal(row.id, "m1");
});

test("toPublicMission sets has_computer to false when there is no handle", () => {
  assert.equal(toPublicMission({ ...mission, pine_enc: null }).has_computer, false);
  const { pine_enc: _drop, ...noColumn } = mission;
  assert.equal(toPublicMission(noColumn as MissionRow).has_computer, false);
});
