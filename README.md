# pinepoint
Your automated QA/Code Review agents built on Pine Computers

## Layout

pnpm workspace (plan section 4.1):

| Path | What |
| --- | --- |
| `apps/web` | Next.js App Router app. Landing page at `/`, app at `/app`, API routes under `app/api`. Vercel project `pinepoint`. |
| `apps/demo-store` | Next.js demo store. It gets its own Vercel project (VI-6). |
| `packages/core` | Shared types, zod schemas, database access, encryption. |
| `packages/runner` | Pine Computer wrapper. Server code only. |
| `packages/github` | Octokit helpers. |
| `packages/ai` | Anthropic calls: planner, STE rewrite, STE lint, fix. |

The packages ship TypeScript source. `apps/web` compiles them through `transpilePackages` in `next.config.ts`.

## Run

Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm -r build          # the acceptance build
pnpm dev               # apps/web on http://localhost:3000
pnpm dev:store         # apps/demo-store on http://localhost:3001
```

## Environment

Copy `.env.example` to `apps/web/.env.local` and fill it in. Never commit a value. The repo is public.

On Vercel the values live in the project settings. Blob and Neon come from the Storage integrations. Variables apply only to deployments built after you save them, so redeploy after a change.

`GET /api/health` shows which variables a deployment has, as `true` or `false`. It never shows a value.

## Database

Neon Postgres. The schema lives in `db/*.sql` (plan section 4.3). `packages/core` owns the access code:

```sh
pnpm --filter @pinepoint/core db:migrate   # apply db/*.sql in order; safe to run twice
pnpm --filter core test                    # crypto round trip and the handle store round trip
```

Both read `DATABASE_URL` and `ENCRYPTION_KEY` from `.env.local` at the repo root. `sql()` from `@pinepoint/core` is the query function. `saveHandle` and `loadHandle` keep Pine handles in `missions.pine_enc`, encrypted with AES-256-GCM. Local and Vercel share one database, so they must share one `ENCRYPTION_KEY`.

## Planner

`planMissions({ diff, qaMd, changedFiles })` in `@pinepoint/ai` turns a PR into 10 missions (plan section 8.1). It calls `PLANNER_MODEL`, validates the JSON with `PlanSchema` from `@pinepoint/core`, retries one time with the error text, and sets a target to null when its line is not an added or changed line on the right side of the diff.

```sh
pnpm --filter ai test                                                          # unit tests with a fake model, no network
pnpm --filter ai test:planner -- --pr https://github.com/vihuynh72/pinepoint/pull/6   # the acceptance check on the planted PR
pnpm --filter ai test:planner -- --diff path/to/file.diff                      # any saved diff
```

Until issue 07 reads the live diff, `--pr` loads `packages/ai/fixtures/<owner>-<repo>-pr-<number>.diff`. Both commands read `ANTHROPIC_API_KEY` and `PLANNER_MODEL` from `.env.local`.

## Deploy

Vercel builds every pushed branch as a preview and `main` as production. The project settings are Root Directory `apps/web` and framework Next.js. `engines` in `package.json` pins Node.js 22.x.

## GitHub webhook

When a PR that changes `apps/demo-store/` is opened or updated, PinePoint starts a run by itself and posts its review on the PR. Nobody needs to press Run in `/app`.

`POST /api/github/webhook` checks `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET`. It takes `pull_request` (opened, reopened, synchronize, ready_for_review; drafts too) and `deployment_status` (success, a demo store preview, not Production). The preview is usually not ready at `pull_request` time, so the `deployment_status` event is the one that starts most runs. A PR that changes no file under `PINEPOINT_WEBHOOK_PATHS` (default `apps/demo-store/`) is skipped. One run per PR head SHA: a second event for the same commit is skipped. With no preview yet, the webhook answers 202 and waits for the next event; it does not post "No preview. No test.".

The run drives itself in `after()`: about 240 seconds per function call, then a signed call to `POST /api/runs/[id]/drive` for the next slice, for at most 40 minutes from the run's start. When every mission has ended, the review posts on the PR (the same happens for runs started from `/app`).

Setup:

1. Make a secret: `openssl rand -hex 32`.
2. Vercel, project `pinepoint`, Settings, Environment Variables: add `GITHUB_WEBHOOK_SECRET` with that value. Check that `APP_BASE_URL` is `https://pinepoint-rho.vercel.app`. Optional: `PINEPOINT_WEBHOOK_PATHS`. Redeploy production.
3. Apply the schema: `pnpm --filter @pinepoint/core db:migrate` (adds `webhook_claims`).
4. GitHub, `vihuynh72/pinepoint`, Settings, Webhooks, Add webhook:
   - Payload URL: `https://pinepoint-rho.vercel.app/api/github/webhook`
   - Content type: `application/json`
   - Secret: the same value
   - Events: "Let me select individual events", then "Pull requests" and "Deployment statuses" only
5. GitHub sends a ping. Recent Deliveries shows 200. `GET /api/health` shows `GITHUB_WEBHOOK_SECRET: true`.

Each delivery's response body says what happened (`skipped`, `waiting` or `starting`). Redeliver from Recent Deliveries to try again.
