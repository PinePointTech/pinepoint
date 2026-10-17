# Plan B: saved run and screenshots (VI-21)

Plan B is a recorded video and a saved run. This folder makes the saved run.
The saved run is one finished PinePoint run for the planted PR #10
(https://github.com/vihuynh72/pinepoint/pull/10). It shows in the dashboard like a real run.

## What the saved run contains

- 1 run. Status `done`. Cost `$0.42` (a fake placeholder, not a measured cost).
- 10 preview missions across the lenses Flow, UI, Abuse, Access and Safety:
  8 passed, 1 possible issue (UI, "Careful reader"), 1 failed (Abuse, "Coupon abuser").
- 2 child missions: a flake rerun of the possible issue (passed) and a production check of the bug (passed).
  The dashboard counts only `kind = 'preview'` missions as the 10 users.
- 1 bug finding: "Coupon applies two times". Expected `$21.60`. Saw `$19.44`. Production saw `$21.60`.
  Target: `apps/demo-store/lib/cart.ts` line 35 (the `applyCoupon` change).
- 1 possible finding: "Coupon message may stay after the cart is empty".
- No GitHub review and no PR comments. The script does not post to GitHub.

The ids are fixed. The run id is `5a7ed000-0000-4000-8000-000000000001`.
If you run the script again, it deletes the old saved run and inserts it again.

## When to run it

Run it before 5:00 PM PT (before the backup video). Run it again only if someone deletes the run.

## Before you run it

1. `.env.local` in the repo root has `DATABASE_URL` (Neon) and `APP_BASE_URL` (the pinepoint-web URL).
2. The Neon database has the tables from `db/001_init.sql`.
3. pinepoint-web is deployed with the files in `apps/web/public/demo/`. The screenshot links use `APP_BASE_URL/demo/...`.
4. Run `pnpm install` one time.

## Insert the saved run

Run this from the repo root:

```sh
pnpm --filter @pinepoint/core exec node --env-file-if-exists=../../.env.local --import tsx ../../scripts/seed/saved-run.ts
```

The script prints the run id and the dashboard link.

## Open the saved run

Print the link (this changes nothing in the database):

```sh
pnpm --filter @pinepoint/core exec node --env-file-if-exists=../../.env.local --import tsx ../../scripts/seed/saved-run.ts --print
```

Open `{APP_BASE_URL}/app?run=5a7ed000-0000-4000-8000-000000000001` in the browser.

## Remove the saved run

```sh
pnpm --filter @pinepoint/core exec node --env-file-if-exists=../../.env.local --import tsx ../../scripts/seed/saved-run.ts --delete
```

This removes the run, its missions, its findings and any lessons for those findings.

## Screenshots

The files in `apps/web/public/demo/` are 1280x800 PNGs:

- `store-home.png`: the planted preview store before any action.
- `coupon-bug.png`: the planted preview after SAVE10 two times. Total `$19.44`.
- `coupon-production.png`: production after SAVE10 two times. Total `$21.60`, message "Coupon already applied."

To capture them again, run this from the repo root:

```sh
node scripts/seed/capture.mjs
```

The script stops with an error if a total is wrong or a file is larger than 400 KB.
Set `CHROMIUM_PATH` if Chromium is not in `/opt/pw-browsers`.
