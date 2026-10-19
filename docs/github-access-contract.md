# GitHub sign-in and organization PR access: the manual-first contract

Linear: [VI-28](https://linear.app/vihuynh72/issue/VI-28/plan-github-sign-in-and-organization-pr-access) (plan),
[VI-29](https://linear.app/vihuynh72/issue/VI-29/define-the-manual-github-qa-access-and-release-contract) (this contract).
The implementation issues VI-30 to VI-36 build what this document specifies. Where the code and this
document disagree, the code is wrong.

## 1. Scope of the first release

- **Manual runs only.** A run starts when a signed-in, eligible person clicks **Run QA** or submits
  `POST /api/runs` with a session. Opening a page, polling status, GitHub `pull_request` and
  `deployment_status` events, and installation webhooks never create a run for a connected repository.
  Automatic runs stay in [VI-37](https://linear.app/vihuynh72/issue/VI-37/explore-opt-in-automatic-qa-after-the-manual-release).
- **One GitHub App.** Its OAuth web flow signs people in; its installations give PinePoint access to
  selected repositories. Both grants must hold for every private operation.
- **The legacy demo stays separate.** Runs that exist today, and runs on the public demo repository
  started without a session, are *legacy* runs (`runs.workspace_id is null`). They keep their public
  behavior. No legacy run is ever assigned to an organization.

## 2. Decisions

| # | Question | Decision | Rationale |
| -- | -- | -- | -- |
| 1 | Outside collaborators with write access | **Not eligible in v1.** Launch requires repository write capability **and** membership of the organization that owns the repository (for a personal-account workspace: being that account). | The confirmed rule is "organization members with write access". Broadening it is a product change, not a default. The check is one extra call; the policy is a constant (`MEMBERSHIP_POLICY`) so it can change deliberately. |
| 2 | Read-only access to findings | **Writer-only throughout v1.** Viewing a private run, its findings, screenshots and desktops needs the same capability as launching. | Keeps one access level in the first release. A viewer role can be added by lowering `VIEW_LEVEL` once sharing is designed. |
| 3 | Attribution of GitHub writes | **The acting person.** Reviews, thread replies, suggestions and the no-preview comment are posted with the GitHub App *user* token of the person who launched the run or clicked the action. Every body ends with a PinePoint signature line. | No installation token exists for user-initiated work, so the write cannot be attributed to the app. The signature keeps the origin visible. |
| 4 | Protected Vercel previews | **Not supported in v1.** Preflight reports `protected` and blocks the launch. PinePoint never disables protection or sends a bypass secret to a customer preview. | GitHub access is not Vercel access. A scoped integration is a separate design (see VI-34 boundary). |
| 5 | Repository settings and limits | Settings are editable by people with **maintain or admin** on the repository. Limits (section 8) are constants in v1. | Admin-only would block many teams; write-only would let any contributor change spend-relevant settings. |
| 6 | Personal accounts | **Supported by the same model.** A workspace is any GitHub account (organization or user) that installed the app. For a user account the membership rule is "you are that account". | The GitHub App installation model is identical; refusing it would only add code. |
| 7 | Session library | **No new dependency.** Opaque server-side sessions in Postgres (`sessions`), a random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie, SHA-256 of the token stored. | Auth.js' GitHub provider models an OAuth App identity, not installations, and keeps its own schema; iron-session cannot revoke a session server-side. A table on the existing Neon database gives revocation, listing and expiry with ~150 lines. |
| 8 | Evidence retention | Step pictures: 14 days after the run ends (existing `pruneShots`). Finding and mission pictures: kept while the run exists. A workspace whose installation is deleted keeps its data for **30 days**, inaccessible, then it is purgeable. | Matches the current retention and gives a reinstall window. |

## 3. Model

```
users ─┬─ user_credentials (encrypted GitHub user token + refresh token)
       └─ sessions

workspaces (github_account_id, the stable tenant)
  └─ installations (github_installation_id, replaceable connection; status active/suspended/deleted)
        └─ repositories (github_repo_id, selected?)  ── repository_settings

runs (+ workspace_id, repository_id, initiated_by_user_id, trigger)
  ├─ missions ── mission_shots
  ├─ findings
  └─ run_actions (audit: who did what)

run_admissions (concurrency and daily quota slots)
webhook_deliveries (idempotency for lifecycle events)
```

Rules:

- **Immutable IDs are the keys.** `github_user_id`, `github_account_id`, `github_installation_id` and
  `github_repo_id` identify things. Logins and names are display data and are refreshed, never trusted.
- **Workspace ≠ installation.** A reinstall gets a new installation row under the *same* workspace. A
  repository transferred to another account gets a new repository row under the new workspace; its old
  runs stay with the old workspace.
- **Every private row has one owner.** New runs with a session carry `workspace_id`, `repository_id`,
  `initiated_by_user_id` and `trigger = 'manual'`. Missions, findings and shots inherit ownership through
  `run_id`. Rows with `workspace_id is null` are legacy.
- **Actions record their actor.** Launch, decision, fix request, fix post and review post write a
  `run_actions` row with the user id. No credential is ever stored there.

## 4. Credential boundary

| Work | Credential | Notes |
| -- | -- | -- |
| Sign-in, listing installations, repositories, PRs | User token | `GET /user/installations`, `GET /user/installations/{id}/repositories`, `GET /repos/.../pulls` |
| Reading a PR for a private run (diff, files, deployments, qa file) | User token of the initiator | Loaded by `githubForRun(run)`; refreshed when expiring |
| Planner, Computers, findings for a private run | Initiator context from the stored run | Jobs never read ownership from request parameters |
| Review, replies, suggestions, no-preview comment on a private run | User token of the acting person | Access is rechecked right before the write |
| Verifying an installation callback or webhook | App JWT (`GET /app/installations/{id}`) | Read-only; no installation token is minted in v1 |
| Legacy demo runs | `GITHUB_TOKEN` (shared PAT) | Only when `runs.workspace_id is null`; never a fallback for a private run |
| Drive chaining between function calls | HMAC under `GITHUB_WEBHOOK_SECRET` | Unchanged; the job reloads the run from the database |

Hard rules: no installation-token or PAT fallback for private work; tokens, the client secret and the
app private key never appear in responses, logs, AI prompts, Pine tasks or PR text. The browser gets
only the session cookie.

**Rechecks.** The initiator's repository access is resolved again (not from cache older than 60 s):

1. when **Run QA** is submitted (with the PR head and preview re-read);
2. before each batch of Computer starts (`fillSlots`), because that is where money is spent;
3. before each GitHub write (review, reply, suggestion, comment);
4. on each desktop delegation, token mint and control change;
5. on each private read (status, shots, run list). A read may use the 60 s cache.

Access loss at 2 fails the run with `runs.error = "Access to <repo> was lost."` and stops nothing already
running (missions end on their own budget, at most 4 minutes). Access loss at 3 to 5 denies the request.

## 5. Eligibility

`resolveRepositoryAccess(user, repository)` returns one of:

| Level | Meaning | Derived from |
| -- | -- | -- |
| `none` | Cannot see the repository in PinePoint | Repository not selected in an active installation, or the user cannot see it on GitHub |
| `read` | GitHub read/triage, or write without organization membership | `GET /repos/{o}/{r}/collaborators/{user}/permission` → `pull`/`triage`; or `push`+ without membership |
| `write` | May view and launch | `push` or `maintain` or `admin` **and** member (`GET /orgs/{org}/members/{user}` → 204) |
| `configure` | `write` plus repository settings | `maintain` or `admin` |

Custom roles map by their effective permission (`permission` field), not by name. Policy constants:
`VIEW_LEVEL = "write"`, `LAUNCH_LEVEL = "write"`, `CONFIGURE_LEVEL = "configure"`,
`MEMBERSHIP_POLICY = "members_only"`.

A failed or ambiguous check (rate limit, 5xx, missing app permission) is **not** access: the state is
`unknown` with a reason, and every write path treats it as denied.

## 6. Endpoint to permission matrix

GitHub App permissions requested (repository): **Metadata read, Contents read, Pull requests write,
Deployments read, Commit statuses read**. Organization: **Members read**. Account: **none** beyond the
user profile that the OAuth flow gives.

| Endpoint / step | GitHub calls | App permission |
| -- | -- | -- |
| Sign-in callback | `GET /user` | (OAuth identity) |
| List workspaces | `GET /user/installations` | Metadata |
| List repositories | `GET /user/installations/{id}/repositories` | Metadata |
| Access level | `GET /repos/{o}/{r}/collaborators/{u}/permission`, `GET /orgs/{org}/members/{u}` | Metadata (collaborator permission is readable by any collaborator), Members read |
| Open PRs, PR by number | `GET /repos/{o}/{r}/pulls` | Pull requests read |
| Preflight and run intake | `GET .../pulls/{n}` (+diff), `GET .../pulls/{n}/files`, `GET .../contents/{qa path}`, `GET .../deployments`, `GET .../deployments/{id}/statuses`, `GET .../commits/{sha}/status`, `GET .../issues/{n}/comments` | Pull requests read, Contents read, Deployments read, Commit statuses read, (comments via Pull requests) |
| Review post, review comment lookup | `POST .../pulls/{n}/reviews`, `GET .../pulls/{n}/reviews/{id}/comments` | Pull requests write |
| Decision reply, fix suggestion, no-preview comment | `POST .../pulls/{n}/comments/{id}/replies`, `POST .../pulls/{n}/comments`, `POST .../issues/{n}/comments` | Pull requests write (issue comments on a PR are covered) |
| Fix agent (reads) | `GET .../pulls/{n}` (diff), `GET .../contents/{path}` | Pull requests read, Contents read |
| Install callback, lifecycle webhooks | `GET /app/installations/{id}` (JWT), `GET /user/installations` (user) | (app identity) |

Not requested: Contents write, Administration, Issues write, Workflows, any organization permission
other than Members read. Each must show a concrete endpoint before it is added.

## 7. Entry point inventory and enforcement

| Route | Check | Credential | On access loss |
| -- | -- | -- | -- |
| `GET /api/auth/github/start`, `/callback`, `POST /api/auth/logout`, `GET /api/auth/me` | state cookie, same-origin (logout) | OAuth | n/a |
| `GET /api/github/install`, `/api/github/install/callback` | session; installation verified with app JWT and the user's installations | user + app JWT | pending approval / denied |
| `GET /api/workspaces`, `GET /api/workspaces/{id}/repositories` | session; intersection only | user | empty list, state per item |
| `GET /api/repositories/{id}/pulls`, `POST /api/repositories/{id}/preflight` | session, `write` | user | 403 with state |
| `GET/PUT /api/repositories/{id}/settings` | session, `configure` (GET: `write`), same-origin | user | 403 |
| `POST /api/runs` (session) | `write`, head and preview re-read, admission slot, same-origin | user | 403 / 409 states |
| `POST /api/runs` (no session) | PR repository in `PINEPOINT_DEMO_REPOS` only | PAT | 401 otherwise |
| `GET /api/runs` | session: scoped to accessible repositories; no session: legacy only | user / none | hidden |
| `GET /api/runs/{id}/status` | private run: session + `write`; legacy: public | — | 404 (no metadata leak) |
| `GET /api/shots/{id}` | private: session + `write`, `Cache-Control: private, no-store`; legacy: public, immutable | — | 404 |
| `POST /api/findings/{id}/decision`, `/fix`, `/post-fix` | private: session + `write`, same-origin; legacy: open as today | user (private) / PAT (legacy) | 403 |
| `POST /api/missions/{id}/desktop`, `/desktop-token`, `/control` | private: session + `write`, same-origin; legacy: open | Pine | 403; existing desktop tokens expire in 120 s |
| `POST /api/runs/{id}/drive` | HMAC token | internal | the run itself is gated at `fillSlots` |
| `POST /api/github/webhook` | signature; lifecycle events idempotent by delivery id; PR/deployment events only for legacy demo repos | PAT (legacy) / none | n/a |

A private resource that the caller may not see answers **404** with no body details, the same as a
missing id, so an attacker cannot tell the two apart. A caller who may see it but may not act gets 403.

**CSRF.** Mutating browser routes require `Sec-Fetch-Site: same-origin` (or `same-site`/`none` for
top-level navigations such as the OAuth start), or an `Origin` header equal to the app origin. The
session cookie is `SameSite=Lax`. The drive and webhook routes are exempt: they authenticate by HMAC.

## 8. Limits, quotas and idempotency

| Scope | Limit | Enforcement |
| -- | -- | -- |
| Concurrent live runs per user | 2 | `run_admissions` slot, key `user:<id>` |
| Concurrent live runs per repository | 2 | key `repo:<id>` |
| Concurrent live runs per workspace | 4 | key `ws:<id>` |
| Runs per workspace per UTC day | 20 | key `ws:<id>:day:<yyyy-mm-dd>`, never released |
| Duplicate submission | one live run per PR head | existing live claim (`webhook_claims`) |

A slot is one row with a unique `(scope_key, slot)`; the insert either wins a free slot number or
returns nothing, so parallel clicks cannot exceed a limit. Slots release when the run leaves the live
states. A failed admission answers 429 with the scope that is full.

## 9. States the product must show

no session · no connected workspace · installation pending owner approval (`setup_action=request`) ·
repository not selected · read-only (cannot launch) · not an organization member · SSO / reauthorization
required (GitHub 403 with `X-GitHub-SSO`) · GitHub rate limited · installation suspended · access
revoked (`github_app_authorization.revoked`) · no open PRs · preview building / missing / failed /
protected · PR head moved since preflight · quota exhausted.

## 10. Sessions and tokens

- Sign-in: `state` (random, bound to an encrypted short-lived cookie that also holds the PKCE verifier
  and the return path) → GitHub → callback checks the state, exchanges the code server-side, reads
  `GET /user`, upserts `users` by `github_user_id`, stores the tokens encrypted with `ENCRYPTION_KEY`,
  creates a session (new token, old session untouched), redirects to the validated return path.
- Return paths must be relative (`/app?...`) and must not start with `//` or contain a scheme.
- Session lifetime: 30 days idle, 90 days absolute. Logout revokes the row and clears the cookie. Logout
  does not revoke the GitHub authorization and the UI says so.
- Token refresh: when the access token expires within 5 minutes, refresh with a compare-and-set on
  `access_expires_at`; the loser re-reads the row. A `bad_refresh_token` marks the credential revoked
  and the next request answers 401 `reauthorize`.
- GitHub does not currently honor PKCE for GitHub Apps; the parameters are sent anyway and the
  `state` cookie binding is the effective protection.

## 11. Migration and legacy quarantine

`db/008_github_access.sql` adds tables and nullable columns only. Existing runs keep
`workspace_id = null` and remain public legacy data; nothing assigns them to a workspace. Rollback is
`drop` of the new tables and columns; no existing column changes. Previously public picture URLs stay
public: a cache cannot be recalled, which is why private evidence never uses the public path semantics.

## 12. Release gates (VI-36)

The manual release is enabled for a pilot only when, in an isolated test organization:

1. member write/maintain/admin can launch; read/triage, outside collaborator and non-member write
   cannot;
2. two organizations cannot read or control each other's runs, shots, findings, desktops or fixes by
   guessing ids;
3. deselection, suspension, uninstall, revoked authorization and lost membership deny the next request
   and fail a run before its next Computer start;
4. forged `installation_id`, replayed state, duplicate webhook deliveries and external return URLs are
   rejected;
5. a protected or missing preview blocks the launch before any Computer starts;
6. concurrent launches respect the limits and create no duplicate paid work;
7. no token appears in any response body, log line, prompt or PR comment (grep of the logs and fixtures);
8. the legacy demo still works without a session for the demo repository only.

The evidence is recorded in `docs/github-access-validation.md` and linked from VI-28.
