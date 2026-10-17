// Zod schema for result.json, the file the agent writes at the end of a mission (plan section 6).
// The runner parses the artifact with `MissionResultSchema` before it records the mission state.

import { z } from "zod";

export const CheckResultSchema = z.object({
  name: z.string(),
  expected: z.string(),
  saw: z.string().default(""),
  passed: z.boolean(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

/** Agents write notes and errors as strings most of the time. Accept any JSON value and keep it. */
const LooseList = z.array(z.unknown()).default([]);

export const MissionResultSchema = z.object({
  checks: z.array(CheckResultSchema).default([]),
  steps: z.array(z.string()).default([]),
  errors: LooseList,
  notes: LooseList,
  blocked: z.boolean().default(false),
});
export type MissionResult = z.infer<typeof MissionResultSchema>;

/** True when the agent wrote at least one check and every check passed. */
export function allChecksPassed(result: MissionResult): boolean {
  return result.checks.length > 0 && result.checks.every((check) => check.passed);
}
