// The mission goal the runner sends to session.agent.run (plan section 6).
// qa.md goes to the session as an attachment, not into the goal text.

export interface GoalInput {
  persona: string;
  lens: string;
  url: string;
  goal: string;
  checks: Array<{ name: string; expected: string }>;
}

/** The most actions one mission may take (plan section 3). */
export const MAX_ACTIONS = 12;

/** The result.json shape the agent must write. Also the example in the goal text. */
export const RESULT_SHAPE_EXAMPLE =
  '{"checks":[{"name":"","expected":"","saw":"","passed":true}],"steps":["Open the store."],"errors":[],"notes":[],"blocked":false}';

export function buildGoal(input: GoalInput): string {
  const checkLines = input.checks.map((c, i) => `${i + 1}. ${c.name}: expected "${c.expected}"`).join("\n");
  return [
    `You are a simulated user. Persona: ${input.persona}. Lens: ${input.lens}.`,
    `Open ${input.url}.`,
    `Goal: ${input.goal}`,
    "Rules:",
    "1. Do not sign in. Do not enter real payment data.",
    `2. Stop after ${MAX_ACTIONS} actions.`,
    "3. Check each item in the check list. Write what you see.",
    "4. When a check fails, save a screenshot of the screen as fail.png.",
    "5. If a page blocks you (for example a CAPTCHA or a login wall), stop and ask for help.",
    "6. If something looks wrong and no check covers it, write it in notes.",
    "7. Read the attachment qa.md first. Use only the test data in it.",
    "Check list:",
    checkLines,
    "At the end, write result.json in this shape:",
    RESULT_SHAPE_EXAMPLE,
    "Name result.json and fail.png in your final answer.",
  ].join("\n");
}
