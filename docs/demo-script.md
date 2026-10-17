# Backup video shot list (record at 5:00 PM PT)

Goal: one full loop on the planted PR, in one video of 3 minutes or less. The loop is Run, the red tile, the PR comment, the session, Take control, Bug, the fix, the commit, Re-run.

Plan B: if the live demo fails on stage, play this video. If a step fails during the recording, use the saved run (see "Saved run" below) and record that step from it.

## URLs

| Name | URL |
| --- | --- |
| App | https://pinepoint-rho.vercel.app/app |
| Planted PR #10 (FREESHIP, coupon bug) | https://github.com/vihuynh72/pinepoint/pull/10 |
| Clean PR #11 (footer text) | https://github.com/vihuynh72/pinepoint/pull/11 |
| Demo store production | https://pinepoint-demo-store.vercel.app |
| Planted preview | https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app |

Expected values:

* Production: the Sage linen apron with SAVE10 two times shows $21.60 and "Coupon already applied."
* Planted preview: the same steps show $19.44.

## Pre-recording checklist

Do these steps at 4:50 PM PT.

1. Open these tabs in one browser window, in this order:
   1. The app: https://pinepoint-rho.vercel.app/app
   2. PR #10, Files changed tab: https://github.com/vihuynh72/pinepoint/pull/10/files
   3. The demo store production: https://pinepoint-demo-store.vercel.app
   4. The planted preview: https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app
   5. The run URL of the best saved run (`/app?run=<runId>`). This is the fallback tab.
2. Sign in to GitHub as vihuynh72 in the same browser. Make sure that you can commit a suggestion on PR #10.
3. Set the browser zoom to 125% on all tabs. Make sure that the full tile grid fits on the screen at 125%. If it does not fit, use 110%.
4. Pick one theme and keep it for the full video. Use light mode for the app and GitHub. Light mode is easier to read on a projector. Set GitHub to the same theme.
5. Close all other tabs, apps and notifications. Turn on Do Not Disturb.
6. Hide the bookmarks bar. Hide all browser extensions.
7. Make sure that no `.env` file, key or token is on screen. Do not open Vercel or Neon settings during the recording.
8. Confirm that the planted preview is up. Open tab 4 and check that the store loads.
9. Confirm that no other run is active. Pine allows a limited number of computers.
10. Start the screen recorder at 1080p. Record the browser window only. Record the voice with the mic close to you.
11. Do one test of 10 seconds. Play it back. Check the sound and the text size.

## Shot list

Each shot has: Click, Say, Screen (what the screen must show), and Fallback.

### Shot 1. The bug on production and on the preview (0:00-0:20)

Click: tab 3 (production). Add the Sage linen apron. Enter SAVE10. Click Apply. Enter SAVE10 again. Click Apply. Then do the same steps on tab 4 (planted preview).

Say: "This is the demo store. On production, SAVE10 two times gives $21.60 and the message 'Coupon already applied.' Now the PR preview. The same steps give $19.44. The coupon applies two times."

Screen: production shows $21.60 and "Coupon already applied." The preview shows $19.44.

Fallback: skip this shot. Say the two totals over the PR #10 Files changed tab.

### Shot 2. Run (0:20-0:35)

Click: tab 1 (the app). Paste https://github.com/vihuynh72/pinepoint/pull/10 into the PR URL box. Click Run.

Say: "Claude wrote this PR. It adds free shipping. I paste the PR URL and click Run. The planner reads the diff and qa.md and writes 10 missions."

Screen: the mission list with 10 missions (lens, persona, goal). The tile grid with 10 tiles in the queued or running state.

Fallback: if Run fails or no preview is found, open tab 5 (the saved run). Say: "This is a run from earlier today."

### Shot 3. The red tile (0:35-0:55)

Click: nothing. Wait for the tiles to finish. Cut the wait in the edit if it is longer than 20 seconds.

Say: "The missions run in parallel on Pine computers. Most tiles pass. One tile turns red. The coupon abuser on the Abuse lens saw $19.44. The check expected $21.60."

Screen: one tile with a soft red border and the label Bug. Other tiles show Passed. The line "Cost of this run: $X.XX" under the grid.

Fallback: if no tile turns red, or a tile stays at Running after 6 minutes, open tab 5 (the saved run). Show the red tile there.

### Shot 4. The PR comment (0:55-1:15)

Click: tab 2 (PR #10, Files changed). Reload the page. Scroll to the inline comment on `apps/demo-store/lib/cart.ts`. Then click the Conversation tab to show the summary.

Say: "PinePoint posts one review on the PR. The bug is on the line that broke. Here are the screenshot, the steps in plain English, the expected total and the total it saw. The summary has the counts and a link to the run."

Screen: the inline comment that starts with "Bug:". The numbered steps. "Expected: $21.60". "Saw: $19.44". The failure screenshot. The link "Open the paused session".

Fallback: if the review did not post, show the PR comment from the saved run (an earlier review on PR #10). If no review exists, show the finding in the app and say: "PinePoint posts this text on the PR."

### Shot 5. The session (1:15-1:30)

Click: the "Open the paused session" link in the PR comment.

Say: "I click the session link. This is not a recording. It is the live browser where the bug happened. The cart is still full."

Screen: the app with the session panel open. The live desktop at full width shows the cart with $19.44. The steps as text below the desktop.

Fallback: if the desktop does not load in 20 seconds, reload one time. If it still fails, show the failure screenshot and the steps in the panel. Say: "The paused computer is gone. The screenshot and the steps stay on the PR."

### Shot 6. Take control (1:30-1:45)

Click: Take control. In the store, click Apply one more time, or move the mouse over the total.

Say: "I take control. Now I drive the browser. I can see the bug myself. I do not need to reproduce it."

Screen: the control state shows that the user drives. The store reacts to the click.

Fallback: if Take control fails, skip it. Say: "Take control lets the developer drive this browser." Go to shot 7.

### Shot 7. Bug (1:45-1:55)

Click: Release. Then click Bug.

Say: "I decide. This is a bug. I click Bug. PinePoint replies in the PR thread with the decision and the time."

Screen: the Bug button shows the selected state. Optional: switch to tab 2 and show the reply "Marked as Bug at {time} PT."

Fallback: if the click fails, show the reply from the saved run on PR #10.

### Shot 8. The fix (1:55-2:15)

Click: wait for the fix to show in the panel. Read it. Click Post to PR.

Say: "Claude Opus 5.5 reads the diff, the steps, the screenshot and the repo files. It proposes one fix. The fix brings back the 'already applied' check. I read it here. Then I post it to the PR as a suggestion."

Screen: the fix in the panel with the path, the lines, the replacement and the explanation. After the click, a link to the suggestion comment.

Fallback: if the fix takes more than 60 seconds or fails, show the fix from the saved run. If no fix exists, say: "The fix step proposes one GitHub suggestion." Cut to shot 10 only if a fixed preview exists. Else end the video after shot 7 and keep Find, Show and Decide (plan section 12 cut rule).

### Shot 9. The commit (2:15-2:30)

Click: tab 2. Reload. Find the suggestion comment. Click "Commit suggestion". Click "Commit changes".

Say: "I commit the suggestion from GitHub. Vercel builds a new preview."

Screen: the suggestion block. The commit dialog. After the commit, the PR shows the new commit.

Fallback: if the commit button does not show, check that you are signed in as vihuynh72. If it still fails, skip this shot and say: "I commit the suggestion. Vercel builds a new preview."

Note: this commit changes PR #10. After the video, the planted PR has no bug. Agree with Chris before you commit. If you need the bug for the live demo, record the commit last, and revert it after the video.

### Shot 10. Re-run (2:30-2:55)

Click: wait for the new Vercel preview (about 1 to 2 minutes, cut the wait in the edit). Go to tab 1. Click Re-run in the session panel.

Say: "The new preview is ready. I click Re-run. PinePoint runs the failed mission again. It passes. PinePoint replies on the PR with the result."

Screen: the re-run tile shows Passed. On tab 2, the reply "Re-run on the new preview: passed." with the new screenshot.

Fallback: if the re-run fails or the preview is not ready, show the re-run from the saved run. If the re-run says "still fails", stop the video at this shot and record shot 10 again later.

### Shot 11. Close (2:55-3:00)

Click: nothing. Stay on the PR thread.

Say: "Find, Show, Decide, Fix, Prove. That is PinePoint."

Screen: the full PR thread with the bug, the decision, the fix and the re-run result.

## Saved run

Before 5:00 PM, pick the best complete run on PR #10. Write its run URL here: [SAVED RUN URL].

The saved run must have: a red Bug tile, a posted review, a Bug decision, a fix, and a re-run result. Keep tab 5 open on it during the recording and on stage.

## After the recording

1. Watch the full video one time. Check that no key or token shows on screen.
2. Cut the long waits. Keep the video at 3 minutes or less.
3. Upload the video. Put the link in `docs/submission.md` in place of [VIDEO URL].
4. Keep a local copy on the laptop for stage use without Wi-Fi.
