# Smoke check

Checks production and the two demo PR previews, prints a PASS/FAIL table and
exits 1 if any check fails. Needs Node 22 and the root devDependency
`playwright-core` (`pnpm install`).

```sh
node scripts/smoke/run.mjs              # everything
node scripts/smoke/run.mjs --only web   # pinepoint-rho.vercel.app: /, /app, /api/health
node scripts/smoke/run.mjs --only store # demo store production cart and coupons
node scripts/smoke/run.mjs --only prs   # PR #10 / #11 state and previews, guard line on main
```

What it checks:

- web: `/` and `/app` return 200; `/api/health` has `ok: true` and every env
  flag true (`DEMO_PRODUCTION_URL` may be false; false flags are printed).
- store: apron + SAVE10 applied twice gives `$21.60` and "Coupon already
  applied."; oven glove alone gives `$13.00`; FREESHIP gives "Coupon not valid.".
- prs: planted PR #10 and clean PR #11 are open and not merged; the #10 preview
  shows the planted bug (`$19.44`, FREESHIP gives `$9.00`); the #11 preview shows
  `$21.60`; `apps/demo-store/lib/cart.ts` on main still has
  `if (cart.coupons.includes(code)) {`.

Preview URLs come from the GitHub deployments API for the PR head SHA, with the
Vercel branch alias as a fallback.

Environment:

- `CHROME_PATH`: Chromium binary. Default: newest `/opt/pw-browsers/chromium-*/chrome-linux/chrome`.
- `GITHUB_TOKEN`: optional; a rejected token falls back to unauthenticated calls.
- Behind an HTTPS proxy, run with `NODE_USE_ENV_PROXY=1` (Node >= 22.21) so
  built-in `fetch` uses it.

Regression watch: `scripts/smoke/watch.sh` runs the check every 5 minutes
(`INTERVAL`, seconds) until `UNTIL` (epoch seconds) and exits 3 with the failing
lines as soon as a previously passing check fails.
