# PinePoint pitch script (3 minutes)

Owner: Vi and Chris. Source: PinePoint Master Plan (STE), sections 1, 2, 3, 10, 11, 12 and 13.

Fill the eval slots before you go on stage. Use the numbers from `eval/results.json`. If a number is not ready, say "We do not have this number yet." Do not guess a number.

## Eval slots

| Slot | What it is | Value |
| --- | --- | --- |
| [CAUGHT x/3] | Planted PR runs that report the coupon Bug | [CAUGHT x/3] |
| [FALSE ALARMS y] | Bug findings on the 3 clean PR runs | [FALSE ALARMS y] |
| [MINUTES m] | Median minutes from Run to the PR review | [MINUTES m] |
| [COST $c] | Mean cost per PR run (Pine usage and Anthropic usage) | [COST $c] |
| [TOKEN COST $t] | The same token counts at the Claude Opus 5.5 list price | [TOKEN COST $t] |

## Script

### 0:00-0:20 Problem

Say:

"AI writes a lot of our code now. A developer ships an AI-written PR in minutes. Then the PR waits. Someone must test it.

In Chris's past job, QA took weeks. And when QA finds a bug, the developer often cannot reproduce it. The bug report says 'the total is wrong'. The developer opens the preview, and the bug is gone."

Screen: the title slide. PinePoint logo and one line: "QA for AI-written PRs."

### 0:20-0:40 Lead user and solution

Say:

"Our user is a developer who ships AI-written PRs. PinePoint tests each PR on its Vercel preview. Ten simulated users run on Pine computers in parallel. When one of them finds a bug, PinePoint posts it on the PR. The post has a screenshot, short steps, and a link to the broken browser. The browser is still open, at the bug."

Screen: the How it works slide. Find, Show, Decide, Fix, Prove.

### 0:40-1:50 Live demo

Say each line as you click. The shot list is in `docs/demo-script.md`.

1. "This PR adds free shipping. Claude wrote it. I paste the PR URL and click Run."
2. "Ten missions start. Each mission is one simulated user with one goal."
3. "One tile turns red. A coupon abuser applied SAVE10 two times. The total is $19.44. Production shows $21.60."
4. "PinePoint posts the bug on the PR, on the line that broke. Here are the screenshot and the steps."
5. "I click the session link. This is the live browser. The cart is still full. I take control. I can see the bug myself."
6. "I click Bug. PinePoint replies in the thread with the time."
7. "Claude Opus 5.5 proposes one fix. I post it to the PR as a suggestion. I commit it."
8. "Vercel builds a new preview. I click Re-run. The mission passes."

Screen: the app at https://pinepoint-rho.vercel.app/app and PR #10 on GitHub.

If the live demo fails, say: "We recorded this loop at 5:00 PM. Here it is." Play the backup video. Do not debug on stage.

### 1:50-2:10 The difference

Say:

"Two things make PinePoint different. First, the live broken session. You do not read a report and try to reproduce it. You open the bug and take control. Second, less time to a fix. PinePoint finds the bug, shows it, proposes the fix, and proves the fix. The fix loop belongs to PinePoint. Pine gives us the computers. PinePoint gives you the loop."

Screen: the session panel with the desktop at full width.

### 2:10-2:25 Playwright point

Say:

"You can ask Claude Code to test with Playwright MCP. That runs one browser on one laptop, one user at a time. When the session ends, the broken state ends too. PinePoint runs many clean users in parallel in the cloud. The broken state stays open for the developer."

Screen: a two-column slide. Left: "Claude Code with Playwright MCP: one browser, one laptop, one user, the state ends." Right: "PinePoint: many clean users, in parallel, in the cloud, the state stays open."

### 2:25-2:45 Numbers

Say:

"We ran our eval today. We ran the planted PR 3 times. PinePoint caught the coupon bug in [CAUGHT x/3] runs. We ran a clean PR 3 times. PinePoint gave [FALSE ALARMS y] false alarms. Our limit is 1 false alarm in 10 missions. From Run to the PR review took [MINUTES m] minutes. One PR run cost [COST $c]. As a token price comparison, the same tokens at the Claude Opus 5.5 list price cost [TOKEN COST $t]."

Screen: the numbers slide with the five values.

Rule: call the last number "a token price comparison" only. Do not show Pine's benchmark numbers as our numbers.

### 2:45-2:55 Market and pricing

Say:

"We price per PR run. You pay when a PR gets tested. Our first user is the developer who ships AI-written PRs. The same loop helps solo founders, distributed teams, and companies with QA teams."

Screen: the market slide. One line: "Solo founders. Distributed teams. Companies with QA teams." Under it: "Price: per PR run."

### 2:55-3:00 Close and security note

Say:

"One note on security. In this MVP, anyone with the session link can open the session. GitHub login comes next. PinePoint. Find the bug, open it, fix it, prove it. Thank you."

Screen: the closing slide with the repo URL https://github.com/vihuynh72/pinepoint and the app URL https://pinepoint-rho.vercel.app/app.

## Rules for the speaker

1. Keep each part inside its time. Cut the Playwright part first if you run late.
2. Say "Bug" and "Not a bug" with the same words as the buttons.
3. Do not say a number that is not in `eval/results.json`.
4. Always say the session link note. Plan section 13 requires it.
5. Do not show any key, token or `.env` file on screen.
