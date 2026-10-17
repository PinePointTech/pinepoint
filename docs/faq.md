# Judge FAQ

Short answers for likely judge questions. Keep each answer under 30 seconds.

## 1. How is this different from Claude Code with Playwright MCP?

Claude Code with Playwright MCP runs one browser on one laptop, one user at a time. When the session ends, the broken state ends too. PinePoint runs many clean users in parallel in the cloud. The broken state stays open, and the developer can take control of it. PinePoint also owns the full loop: find, show, decide, fix and prove.

## 2. What does a run cost?

One PR run cost [COST $c] in our eval. That includes Pine usage and Anthropic usage. As a token price comparison, the same token counts at the Claude Opus 5.5 list price cost [TOKEN COST $t]. We price per PR run.

## 3. How do you control false alarms?

A failed mission runs once more on the preview before it becomes a Bug. A Bug needs a failed exact check, for example a total that is not "$21.60". LLM judgment alone gives only a Possible issue, and Possible issues stay in a collapsed block. On the clean PR we got [FALSE ALARMS y] false alarms in 3 runs. Our limit is 1 in 10. The developer can click Not a bug, and PinePoint stores the lesson.

## 4. How do you keep tokens and session links safe?

All keys live only in the Vercel settings. The repo is public and has no keys. The Pine project key and the session tokens stay on the server. Only a short desktop token goes to the browser, and it lasts 120 seconds. Pine handles in the database are encrypted with AES-256-GCM. The GitHub token works only on one repo. In the MVP, anyone with the session link can open the session. GitHub login for session links comes next.

## 5. Why Pine?

Pine gives each mission a clean cloud computer with a browser, and it can pause that computer at the broken state. That pause is our main difference. Pine also lets the developer take control of the same live desktop. Pine gives us the computers. The loop belongs to PinePoint.

## 6. Why Simplified Technical English (STE)?

A developer must follow the repro steps fast and without doubt. STE gives one action per step, 8 words or fewer, active voice, and the label text from the screen. A lint check after the rewrite enforces the rules. Short exact steps also work well as input for the fix model.

## 7. What happens when a mission gets stuck?

Each mission stops after 12 actions or 4 minutes. A mission that hits a CAPTCHA or a login wall asks for help. Its tile turns yellow with "Needs you" and a Take control button. The developer helps, then releases control, and the agent continues. A mission that does not finish is marked Blocked, not Bug.

## 8. What if the PR has no preview?

PinePoint needs a Vercel preview to test. If the preview build failed or no preview exists, the bot comments "No preview. No test." on the PR and stops. Other preview providers come later.

## 9. Do Dependabot PRs get tested?

Yes. Dependabot PRs go through the same loop. PinePoint writes 10 missions for each PR, also when the PR has no visible change. A dependency update can break a flow without a visible change.

## 10. Does PinePoint block the merge?

No. PinePoint has no merge gate and no severity labels. It posts one review with event COMMENT. The developer decides. The bot never pushes commits. The developer commits the fix from the GitHub suggestion.
