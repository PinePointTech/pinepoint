# Submission text

Copy each block into the submission form. Replace each placeholder in square brackets before you submit. Submit by 5:45 PM PT.

## Name

PinePoint

## Tagline

Simulated users test each AI-written PR and hand you the live broken browser.

## Problem

AI writes PRs fast. Testing does not keep up. A PR waits for QA, and in Chris's past job QA took weeks. When QA finds a bug, the developer often cannot reproduce it. The bug report says what went wrong, but the broken state is gone. The developer loses time before the fix can start.

## Solution

PinePoint tests each PR on its Vercel preview with 10 simulated users on Pine computers. When a simulated user finds a bug, PinePoint posts the bug on the PR. The post has a screenshot, short repro steps in Simplified Technical English (STE), and a link to the paused browser at the bug. The developer opens the browser, takes control, and decides: Bug or Not a bug. For a bug, PinePoint proposes one fix as a GitHub suggestion. After the developer commits the fix, PinePoint runs the failed mission again to prove the fix.

## How it works

1. Find. The planner reads the diff and qa.md and writes 10 missions. Pine computers run the missions on the preview in parallel.
2. Show. A failed computer stays paused at the broken state. PinePoint posts an inline review comment with the screenshot, the steps and the session link.
3. Decide. The developer opens the session, takes control, and clicks Bug or Not a bug. The bot replies in the thread with the decision and the time.
4. Fix. For Bug, the fix agent reads the diff, the steps, the screenshot, the errors and the repo files. It returns one fix. The developer reads it and posts it to the PR as a suggestion.
5. Prove. The developer commits the suggestion. Vercel builds a new preview. The developer clicks Re-run. PinePoint runs the failed mission again and replies with the result.

## How we built it

* A pnpm monorepo with a web app, a demo store, and four packages (core, runner, github, ai).
* Next.js on Vercel for the app and the API routes. The demo store is a second Vercel project.
* Neon Postgres for runs, missions, findings and lessons. Pine handles are encrypted with AES-256-GCM.
* Vercel Blob for the failure screenshots. GitHub needs a public image URL.
* Pine computers through `@pinesandbox/computer`. One ephemeral computer per mission. A failed computer stays paused so the developer can open it.
* Claude Sonnet 5.5 for the planner and the STE rewrite of the repro steps.
* Claude Opus 5.5 for the fix.
* Octokit for the PR review, the inline comments, the thread replies and the suggestion.

## Challenges

* Vercel Hobby stops a function at 300 seconds. No route waits for a whole batch. The dashboard polls the status route, and each poll advances the run.
* Pine limits the number of concurrent computers. PinePoint queues missions, stops passed computers, and keeps few paused computers.
* Two open tabs can poll at the same time. A database lock makes sure that PinePoint posts one review per run.
* A false alarm costs the developer's trust. A failed mission runs once more before it becomes a Bug. Production runs mark old bugs.
* Repro steps must be short and exact. One STE rewrite call and a lint check keep each step to one action and 8 words or fewer.

## What is next

* A GitHub webhook trigger, so each PR runs without the Run button.
* GitHub login for session links. In the MVP, anyone with the link can open the session.
* More preview providers than Vercel.

## Team

* Vi: scaffold, demo store, GitHub side, dashboard, session panel, landing page.
* Chris: Pine runner, planner, findings, fix agent, re-run, cost.

## Links

* Repo: https://github.com/vihuynh72/pinepoint
* App: https://pinepoint-rho.vercel.app/app
* Video: [VIDEO URL]

## Eval

We ran the eval on 17 October 2026.

* Planted bugs caught: [CAUGHT x/3] runs on the planted PR reported the coupon Bug.
* False alarms on the clean PR: [FALSE ALARMS y] Bug findings in 3 runs.
* Minutes to report: [MINUTES m] minutes from Run to the PR review (median).
* Cost per PR: [COST $c] per run, from Pine usage and Anthropic usage.
* Token price comparison: the same token counts at the Claude Opus 5.5 list price cost [TOKEN COST $t].
