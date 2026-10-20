# GitHub access: validation matrix and pilot gate (VI-36)

Status: **gate not passed.** This document lists what must be shown before private organization
runs are enabled for a pilot, what the code already proves by automated test, and what a person
must still do in an isolated test organization. The GitHub App is not registered, `db/008` is not
applied to production, and no pilot is authorized by this document.

Companion: [github-access-contract.md](github-access-contract.md) (the rules), section 12 (the gates).

Legend: **auto** = covered by a unit test in this repository (file named); **manual** = to run in
the test organization and record here; **code** = enforced by code without a unit test (the route
or module is named; it is exercised by the manual case).

## 1. Test organization setup (manual, once)

| # | Step | Done |
|---|------|------|
| S1 | Create organization `pinepoint-qa-test-a` and `pinepoint-qa-test-b`, each with one public and one private repository with a Vercel preview and a `qa.md`. | |
| S2 | Register one GitHub App per `.env.example` (callback, setup URL with redirect on update, webhook URL, permissions, events). Record the app id, slug, client id. Store the client secret and private key in Vercel env only. | |
| S3 | Accounts: `a-admin` (org A admin), `a-maint` (maintain on A/private), `a-write` (push on A/private), `a-read` (pull), `a-triage` (triage), `a-outside` (outside collaborator with push), `b-write` (org B member with push), `nobody` (no relation), `sso-user` (in an org with SAML SSO enforced). | |
| S4 | Apply `db/008_github_access.sql` on a Neon branch of production (not on main) and point the preview deployment at it. | |
| S5 | Install the app on A and B with selected repositories; leave one repository of each unselected. Have `a-write` request (not install) on a third org to produce `setup_action=request`. | |

## 2. Acceptance matrix

### 2.1 Eligibility (gate 1)

| # | Case | Expected | How | Evidence |
|---|------|----------|-----|----------|
| E1 | Member with push | preflight `access.canLaunch=true`, level `write`; Run QA enabled | auto `packages/github/src/access.test.ts`; manual | |
| E2 | Member with maintain / admin | level `configure`; settings PUT succeeds | auto access.test; manual `PUT /api/repositories/:id/settings` | |
| E3 | Member with pull / triage | state `read_only`; repository hidden from history and pickers; status/shots 404 | auto access.test; manual | |
| E4 | Outside collaborator with push | state `not_member`; cannot launch or view | auto access.test ("Outside collaborators"); manual | |
| E5 | Non-member with no access | 404 on every private route; repository not listed | code `apps/web/lib/access.ts` (`notFound`); manual | |
| E6 | Unselected repository | state `not_selected`; not in `/api/workspaces/:id/repositories` | auto access.test; code `listWorkspaceRepositories` (`selected`); manual | |
| E7 | Installation approval pending (`setup_action=request`) | callback redirects with `?install=requested`; nothing created | code `app/api/github/install/callback/route.ts`; manual | |
| E8 | Personal account: owner may launch, others may not | auto access.test | | |
| E9 | Membership check fails (unknown) | state `unknown`, denied | auto access.test | |

### 2.2 Isolation between organizations (gate 2)

With `b-write` signed in, using ids taken from org A's runs:

| # | Route | Expected | How | Evidence |
|---|-------|----------|-----|----------|
| I1 | `GET /api/runs` | only B's runs | code `listRecentRuns({kind:"repositories"})` + `viewableRepositoryIds`; manual | |
| I2 | `GET /api/runs/:A/status` | 404, `cache-control: private, no-store` | code `authorizeRun`; manual | |
| I3 | `GET /api/shots/:A` | 404 | code `shotOwner` + `authorizeRun`; manual | |
| I4 | `POST /api/missions/:A/desktop`, `desktop-token`, `control` | 404 | code `guardMission`; manual | |
| I5 | `POST /api/findings/:A/decision`, `fix`, `post-fix` | 404; no GitHub write, no DB change | code `authorizeFinding`; manual (check PR A has no new comment) | |
| I6 | `POST /api/runs {repositoryId: A-repo}` | 404 | code `authorizeRepository`; manual | |
| I7 | `GET /api/repositories/:A/pulls`, `preflight`, `settings` | 404 | code `authorizeRepository`; manual | |
| I8 | Shared link `/app?run=A` opened by `b-write` | "No run with this id." | manual | |
| I9 | Legacy demo run opened by `b-write` and by `nobody` | works as before | manual | |

### 2.3 Revocation (gate 3)

Each case: perform the change on GitHub, then within 60 s (cache) the read is denied; the next
act (`fresh: true`) is denied at once; a run in `running` fails with `Access to owner/repo was lost: …`
before its next Computer start (`setRunAccessHook` in `apps/web/lib/run-hooks.ts`, hook call in
`packages/runner/src/orchestrate.ts fillSlots`).

| # | Change | Expected state | How | Evidence |
|---|--------|----------------|-----|----------|
| R1 | Remove `a-write` from org A | `not_member` | manual | |
| R2 | Downgrade `a-write` to pull | `read_only` | manual | |
| R3 | Deselect the repository in the installation | `installation_repositories` webhook → `selected=false`; `not_selected` | auto `installations.test.ts` (parse); code `applyLifecycleEvent`; manual | |
| R4 | Suspend the installation | `installation_suspended` | auto parse; manual | |
| R5 | Uninstall the app | `installation_deleted`; repositories deselected | auto parse; manual | |
| R6 | User revokes the app authorization on GitHub | `github_app_authorization revoked` → credential marked revoked → `reauthorize`; session still valid but every GitHub-backed route answers 403 `reauthorize` | auto parse; code `markCredentialRevokedByGithubId`; manual | |
| R7 | Active run when R1 happens | run fails before next Computer start; audit `access_lost` row | code; manual | |
| R8 | Open desktop when R1 happens | next `desktop-token` (120 s) → 404; viewer loses the stream | code `guardMission`; manual | |
| R9 | Sign out | `pp_session` cleared; `sessions.revoked_at` set; replayed cookie → 401 | code `revokeSession`; manual | |

### 2.4 Protocol hardening (gate 4)

| # | Case | Expected | How | Evidence |
|---|------|----------|-----|----------|
| P1 | Callback with wrong or missing `state`, or expired cookie | redirect `?auth_error=bad_state`, no session | auto `oauth.test.ts` (`openSignInState`); manual | |
| P2 | Replay of a used callback URL | state cookie cleared on first use → `bad_state` | code (`clearStateCookie` on every path); manual | |
| P3 | `return_to` outside `/app` or absolute | falls back to `/app` | auto oauth.test (`safeReturnTo`) | |
| P4 | Install callback with a forged `installation_id` | `not_found` or `not_visible_to_user`; nothing connected | auto `installations.test.ts` (`verifyInstallationForUser`); manual | |
| P5 | Install callback signed out | redirected through sign-in and back to the same callback | code; manual | |
| P6 | Webhook with bad signature | 401 | auto `webhook.test.ts` | |
| P7 | Duplicate lifecycle delivery (same `X-GitHub-Delivery`) | second answers `skipped: applied before`; rows unchanged | code `recordDelivery` (PK); manual (GitHub "Redeliver") | |
| P8 | Token refresh near expiry | one refresh under CAS; second caller reuses | code `user-tokens.ts`; manual (set `access_expires_at` to now+1m) | |
| P9 | Dead refresh token | `ReauthorizeError` → 403 `reauthorize` | code; manual (revoke then wait for expiry) | |
| P10 | SSO-enforced org without an authorized token | `sso_required` state with the instruction | code `isSsoRequired`; manual with `sso-user` | |
| P11 | Cross-site POST (no `Sec-Fetch-Site: same-origin`, foreign `Origin`) to runs, findings, missions, settings, logout | 403 | auto `apps/web/components/app/access-helpers.test.ts` (`isSameOriginRequest`); manual via curl | |
| P12 | Access cache does not leak between users | per-(user, repo) key, 60 s | code `resolveRepositoryAccess`; manual (two users, same repo, different roles) | |

### 2.5 Realistic manual runs (gate 5)

| # | Case | Expected | How | Evidence |
|---|------|----------|-----|----------|
| M1 | Current head | 202 `planning`; run has `workspace_id`, `repository_id`, `initiated_by_user_id`, `trigger='manual'` | code `ownershipColumns`; auto `admission.test.ts`; manual | |
| M2 | Stale head (push after preflight) | 409 `head_moved`; card refreshes; no run row | code `prepareRun expectHeadSha`; manual | |
| M3 | Fork PR | QA file read at base SHA; preview from base repo deployments; marked in the card | auto `context.test.ts` (fork case); manual | |
| M4 | Repository renamed | `GET /repos` id matches → works; a reused name with a different id → `repo_mismatch` | auto access.test; manual | |
| M5 | Repository transferred to another org, app reinstalled | new installation row; old deselected; history stays with the repository id | manual | |
| M6 | Protected preview (Vercel Authentication) | preflight `preview.state=protected`; Run QA disabled; no run | auto `preview.test.ts` (`looksProtected`); manual | |
| M7 | Missing / building / failed preview | matching state; Run QA disabled | auto preview.test; manual | |
| M8 | Preview URL to a private IP or http | `unsafe`; settings PUT rejects such a production URL | auto preview.test, `settings.test.ts`; manual | |
| M9 | GitHub secondary rate limit during preflight | state `rate_limited`, 403 with next step; no run | code `isRateLimited`; manual (hard to force; accept a code review of the path) | |
| M10 | Legacy demo PR URL while signed in | 403 `not_connected` with the hint to connect | code `POST /api/runs`; manual | |
| M11 | Demo PR URL signed out | legacy run as before | manual | |

### 2.6 Concurrency, audit, retention, secrecy (gate 6 and 7)

| # | Case | Expected | How | Evidence |
|---|------|----------|-----|----------|
| C1 | 3 simultaneous launches by one user | 2 admitted, 1 → 429 `user`; refused run row deleted | code `admitRun` (PK gate), `discardPlanningRun`; manual (parallel curl) | |
| C2 | Workspace at 4 live runs | 5th → 429 `workspace` | manual | |
| C3 | 21st run of the UTC day | 429 `workspace_day`; day slot never releases | auto admission.test (keys); manual | |
| C4 | Run ends (done/failed) | live slots released (`freeSlotsOf`) | code; manual (`select * from run_admissions`) | |
| C5 | Double click Run QA | live claim: one run, second answers `existing` | existing claim logic; manual | |
| C6 | Audit | rows for `sign_in`, `workspace_connect`, `launch`, `decision`, `fix_request`, `fix_post`, `review_post`, `settings_update`, `access_lost` with user ids | code `recordAction`; manual (`select action, count(*) from run_actions group by 1`) | |
| C7 | No credential anywhere | grep Vercel logs, `GET /api/auth/me`, `/api/workspaces`, status payloads, Pine task text, PR comments for `ghu_`, `ghr_`, `ghp_`, the client secret, `BEGIN RSA` | manual; code review: tokens only in `user_credentials.*_enc`, `.env`, and `Authorization` headers | |
| C8 | Retention | shots pruned per `SHOT_RETENTION_DAYS`; disconnected workspaces after `DISCONNECTED_RETENTION_DAYS` (30) — **not yet automated**, see defects | manual | |

### 2.7 Nothing starts unrequested (gate 8)

| # | Case | Expected | How | Evidence |
|---|------|----------|-----|----------|
| N1 | Open `/app`, poll status for an hour | zero new runs | manual | |
| N2 | `pull_request` / `deployment_status` webhook for an org A repository | 200 `skipped: Runs on connected repositories start from the app` | code `isDemoRepo` guard in webhook route; auto `access-helpers.test.ts` (`isDemoRepo`); manual (GitHub "Redeliver") | |
| N3 | Same events for the demo repository | behave as today | manual | |
| N4 | Legacy rows | `workspace_id is null`, `trigger='legacy'`; never assigned to a workspace | code `db/008` default; manual (`select count(*) from runs where workspace_id is not null and trigger='legacy'` = 0) | |

## 3. Automated coverage summary

Run `pnpm -r --filter '!demo-store' test` (246 tests at the time of writing; the one core test that
needs Neon is skipped without `DATABASE_URL`).

| Area | File | What it proves |
|------|------|----------------|
| OAuth state, return URLs | `packages/github/src/oauth.test.ts` | seal/open, replay, expiry, open-redirect refusal, PKCE challenge, no scope |
| App config and tokens | `packages/github/src/app.test.ts` | token parsing, RS256 JWT verifiable, PEM normalization, secret in body not URL |
| Access policy | `packages/github/src/access.test.ts` | every eligibility row of contract section 5; reasons carry no secret |
| Preview readiness and URL policy | `packages/github/src/preview.test.ts` | https-only, private IP and local host refusal, protection detection, state mapping |
| Lifecycle webhooks, install verification | `packages/github/src/installations.test.ts` | event parsing, forged installation id refusal |
| Repository settings | `packages/github/src/settings.test.ts` | path traversal refusal, project name shape, production URL policy |
| Fork QA file | `packages/github/src/context.test.ts` | QA read at base for a fork, configured path honored |
| Quota keys, ownership | `packages/runner/src/admission.test.ts` | scope keys and limits, UTC day, no half-owned run |
| CSRF, demo list, cookies | `apps/web/components/app/access-helpers.test.ts` | same-origin rule, demo repo matching, PR URL parsing, Secure cookie rule |

Not unit-tested (needs Postgres or GitHub): `admitRun` race, `resolveRepositoryAccess` cache,
token refresh CAS, session sliding, `applyLifecycleEvent` writes. These are the manual rows above.

## 4. Known gaps and defects to resolve before a pilot

| # | Gap | Severity | Plan |
|---|-----|----------|------|
| D1 | `db/008_github_access.sql` not applied to production; `pnpm db:migrate` must run after the PR merges and before any sign-in. | blocking | release step |
| D2 | GitHub App not registered; no `GITHUB_APP_*` in Vercel. Sign-in stays off until then (the app shows the demo form). | blocking | release step, done by the owner |
| D3 | No scheduled job deletes disconnected workspaces after 30 days or revoked credentials; rows stay (harmless, but the contract says 30 days). | low | follow-up issue |
| D4 | `GET /api/runs` with a session resolves access for every connected repository in series; fine for a pilot (tens of repositories), not for hundreds. | low | cache per user of the viewable list |
| D5 | The desktop stream token (`desktop-token`, 120 s) is not revoked on access loss before it expires. Bounded by the 120 s life. | low | accept for pilot |
| D6 | No UI for the settings of a repository the person cannot configure beyond read-only fields. | cosmetic | — |

## 5. Pilot enablement checklist

1. Merge the PR. Confirm `pnpm -r typecheck` and tests pass on main.
2. Apply `db/008_github_access.sql` to production (`pnpm --filter @pinepoint/core db:migrate`). Verify: `\d runs` shows the four new columns; `select count(*) from runs where workspace_id is not null` = 0.
3. Register the GitHub App (owner only). Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` in Vercel production; keep `GITHUB_WEBHOOK_SECRET` the same for the app's webhook. Redeploy.
4. `GET /api/health` shows the five `GITHUB_APP_*` keys true. `GET /api/auth/me` shows `signInAvailable: true`.
5. Run sections 2.1 to 2.7 in the test organizations; fill the Evidence column with a link (log line, screenshot, SQL output).
6. Resolve D1, D2; accept or fix D3 to D6 in writing.
7. Enable for one pilot organization by installing the app there. No code flag is needed: an organization without an installation sees nothing.

## 6. Rollback

Any of these, in order of how little they disturb:

1. **Stop new private runs**: suspend the app installation on the pilot organization (GitHub UI). The `installation` webhook marks it suspended; the next request of each person is denied; running runs fail before their next Computer start.
2. **Stop sign-in**: unset `GITHUB_APP_CLIENT_SECRET` in Vercel and redeploy. `/api/auth/me` answers `signInAvailable: false`; existing sessions still load but every GitHub-backed route fails closed. To end sessions: `update sessions set revoked_at = now() where revoked_at is null`.
3. **Revoke tokens**: `update user_credentials set revoked_at = now()`; or revoke the app's user tokens from the app's Advanced settings on GitHub.
4. **Schema**: `db/008` is additive (new tables, nullable columns with defaults). Legacy routes never read the new tables except through the guards, which treat `workspace_id is null` as legacy. Leave the schema in place; dropping it is not needed for rollback.
5. **Code**: revert the PR. The runs route returns to the PR-URL-only form; legacy rows are untouched.
