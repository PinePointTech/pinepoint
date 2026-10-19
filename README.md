# PinePoint

**QA agents for every pull request.** PinePoint sends 10 simulated users through your Vercel preview, each on its own Pine Computer with a real browser, and posts what broke as a review on the PR.

![Next.js 16](https://img.shields.io/badge/Next.js-16-black) ![Node 22](https://img.shields.io/badge/Node-22-339933) ![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220) ![Pine Computers](https://img.shields.io/badge/runs%20on-Pine%20Computers-2f6f4f) ![Vercel](https://img.shields.io/badge/deploy-Vercel-000)

**Live:** [pinepoint-rho.vercel.app](https://pinepoint-rho.vercel.app) (app at [`/app`](https://pinepoint-rho.vercel.app/app)) · Demo store: [pinepoint-demo-store.vercel.app](https://pinepoint-demo-store.vercel.app)

## How a run works

```mermaid
flowchart LR
  PR["Pull request"] --> P["Planner (Claude) reads diff + qa.md"]
  P --> M["10 missions: Flow, UI, Abuse, Access, Safety"]
  M --> C["Pine Computers test the preview"]
  C --> F["Failures: flake re-run + production check"]
  F --> B["Findings: Bug, Possible, Old bug (STE text)"]
  B --> R["Review posted on the PR"]
```

Watch it live in `/app`: mission cards by lens, the live desktop (take control, full screen), screenshots of each step, and the real cost.

## Cost

Pine reports tokens and cost for each mission. On 60 real missions, Pine charged about **$0.012 per mission** and **$0.14 to $0.16 per run**. The run page compares the same tokens at six model list prices, cache rates included.

## Demo PRs

Draft PRs with a planted bug. Never merge them.

| PR | Bug | Expected | Preview shows |
| --- | --- | --- | --- |
| [#10](https://github.com/vihuynh72/pinepoint/pull/10) | Coupon applies two times | $21.60 | $19.44 |
| [#29](https://github.com/vihuynh72/pinepoint/pull/29) | Remove one goes below zero | Empty cart | $-20.00 |
| [#31](https://github.com/vihuynh72/pinepoint/pull/31) | Express shipping turns free | $36.00 | $24.00 |
| [#33](https://github.com/vihuynh72/pinepoint/pull/33) | Two coupons stack | $44.10 | $37.49 |
| [#34](https://github.com/vihuynh72/pinepoint/pull/34) | Saved cart doubles on reload | $24.00 | $48.00 |
| [#11](https://github.com/vihuynh72/pinepoint/pull/11) | None (clean control) | | |

The list is in [`eval/planted.json`](eval/planted.json).

## Quick start

Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm -r build     # build everything
pnpm dev          # apps/web on http://localhost:3000
pnpm dev:store    # apps/demo-store on http://localhost:3001
```

Copy `.env.example` to `apps/web/.env.local` and fill it in. Never commit a value: the repo is public. `GET /api/health` shows which variables a deployment has, as `true` or `false`.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js app: landing at `/`, app at `/app`, API under `app/api` |
| `apps/demo-store` | The demo store that the planted PRs change |
| `packages/core` | Types, zod schemas, database, encryption |
| `packages/runner` | Pine Computer wrapper and run orchestration |
| `packages/github` | PR context, review posting, webhook checks |
| `packages/ai` | Planner and other Claude calls |
| `db/` | Postgres schema (Neon) |

## Database and tests

```sh
pnpm --filter @pinepoint/core db:migrate   # apply db/*.sql; safe to run twice
pnpm --filter core test
pnpm --filter ai test
pnpm --filter ai test:findings -- --run RUN_ID   # build or show a finished run's findings
pnpm --filter @pinepoint/runner test
pnpm --filter @pinepoint/github test
pnpm --filter web test
```

## GitHub webhook

When a demo store preview deploys for an open PR that changes `apps/demo-store/`, PinePoint starts a run by itself, drives it with nobody on `/app`, and posts the review.

1. Make a secret: `openssl rand -hex 32`.
2. Vercel project `pinepoint`: add `GITHUB_WEBHOOK_SECRET`, check `APP_BASE_URL` is `https://pinepoint-rho.vercel.app`, then redeploy.
3. GitHub repo Settings, Webhooks: payload URL `https://pinepoint-rho.vercel.app/api/github/webhook`, content type `application/json`, the same secret, events "Pull requests" and "Deployment statuses".
4. The ping in Recent Deliveries shows 200.

Optional: `PINEPOINT_WEBHOOK_PATHS` (default `apps/demo-store/`).

The auto-start applies to the public demo repositories only (`PINEPOINT_DEMO_REPOS`, default `vihuynh72/pinepoint`). A connected organization repository never starts a run from a webhook.

## GitHub sign-in and organization access

People sign in with GitHub and run QA on pull requests of repositories their organization connected. The rules are in [docs/github-access-contract.md](docs/github-access-contract.md) and the release gate in [docs/github-access-validation.md](docs/github-access-validation.md). In short:

- One GitHub App does both: user sign-in (OAuth, tokens encrypted at rest, refreshed on the server) and installation on an organization or account with selected repositories.
- A person may see and launch QA on a repository when they have write access on GitHub and are a member of the owning organization (outside collaborators cannot). Maintainers and admins can also change the repository's QA settings.
- Every launch, review post, fix and desktop action on a connected repository uses the acting person's own GitHub token. There is no fallback to an installation token or the shared `GITHUB_TOKEN`, which stays for the public demo alone.
- Runs on connected repositories start from the Run QA button only, after a preflight that checks the access, the preview, the QA file and the quota. Nothing starts from a push or a webhook.
- A run's status, pictures and desktop are visible to people with access to its repository and answer 404 to everyone else. Legacy demo runs stay public.

Setup: register the GitHub App as described in `.env.example` (callback, setup and webhook URLs; permissions; events), set the `GITHUB_APP_*` variables, and apply `db/008_github_access.sql` (`pnpm --filter @pinepoint/core db:migrate`). Without the variables, sign-in is off and `/app` works as the public demo.
