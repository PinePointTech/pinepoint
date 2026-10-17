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

`--pr` loads `packages/ai/fixtures/<owner>-<repo>-pr-<number>.diff` when a saved diff exists, else it reads the live PR from GitHub (`GITHUB_TOKEN` first, then the `gh` CLI) and takes `qa.md` and the changed files from the PR head. The SAVE10 check runs only for the planted PR in `eval/planted.json`. Both commands read `ANTHROPIC_API_KEY` and `PLANNER_MODEL` from `.env.local`.

## Deploy

Vercel builds every pushed branch as a preview and `main` as production. The project settings are Root Directory `apps/web` and framework Next.js. `engines` in `package.json` pins Node.js 22.x.
