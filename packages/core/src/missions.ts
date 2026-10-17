// Zod schemas for the planner output (plan section 8.1).
// The planner in @pinepoint/ai validates the model's JSON with `PlanSchema`.
// The shape matches the missions table in plan section 4.3.

import { z } from "zod";

/** The five QA areas. The diff aims the lenses (plan section 3). */
export const LENSES = ["Flow", "UI", "Abuse", "Access", "Safety"] as const;
export const LensSchema = z.enum(LENSES);
export type Lens = z.infer<typeof LensSchema>;

/** How many missions the planner writes for each PR. */
export const MISSIONS_PER_RUN = 10;

/** One exact check. `expected` is literal text the agent can read on the screen, for example "$21.60". */
export const CheckSchema = z.object({
  name: z.string().trim().min(1, "A check needs a name."),
  expected: z.string().trim().min(1, "A check needs the expected text."),
});
export type Check = z.infer<typeof CheckSchema>;

/** One added or changed line on the right side of the diff. */
export const TargetSchema = z.object({
  path: z.string().trim().min(1, "A target needs a path."),
  line: z.number().int().positive("A target line is a positive integer."),
});
export type Target = z.infer<typeof TargetSchema>;

export const MissionSchema = z.object({
  lens: LensSchema,
  persona: z.string().trim().min(1, "A mission needs a persona."),
  goal: z.string().trim().min(1, "A mission needs a goal."),
  checks: z.array(CheckSchema).min(1, "A mission needs 1 to 3 checks.").max(3, "A mission needs 1 to 3 checks."),
  target: TargetSchema.nullable(),
  newFeature: z.boolean(),
});
export type Mission = z.infer<typeof MissionSchema>;

export const PlanSchema = z.object({
  missions: z
    .array(MissionSchema)
    .length(MISSIONS_PER_RUN, `The plan needs exactly ${MISSIONS_PER_RUN} missions.`),
});
export type Plan = z.infer<typeof PlanSchema>;
