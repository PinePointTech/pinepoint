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

## Deploy

Vercel builds every pushed branch as a preview and `main` as production. The project settings are Root Directory `apps/web` and framework Next.js. `engines` in `package.json` pins Node.js 22.x.
