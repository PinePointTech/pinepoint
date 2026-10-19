-- GitHub sign-in, organization workspaces, installations, repository grants, run ownership, quotas and audit.
-- docs/github-access-contract.md sections 3, 8 and 11. Additive only: new tables and nullable columns.
-- Apply with: pnpm --filter @pinepoint/core db:migrate
--
-- Rollback: drop the new tables and the four new runs columns. No existing column changes.

-- A person who signed in with the GitHub App. github_user_id is the identity; login and name are display data.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  github_user_id bigint not null unique,
  login text not null,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- The GitHub App user token and refresh token, encrypted with ENCRYPTION_KEY (packages/core/src/crypto.ts).
-- revoked_at is set when GitHub reports the authorization as revoked or a refresh fails for good.
create table if not exists user_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  access_enc text not null,
  access_expires_at timestamptz,
  refresh_enc text,
  refresh_expires_at timestamptz,
  token_type text not null default 'bearer',
  scope text,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Opaque server-side sessions. The cookie holds a random token; only its SHA-256 is stored.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sessions_user_idx on sessions (user_id);

-- A GitHub account (organization or user) that installed the app. The stable tenant.
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  github_account_id bigint not null unique,
  account_login text not null,
  account_type text not null, -- Organization, User
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One installation of the app on a workspace. A reinstall makes a new row under the same workspace.
create table if not exists installations (
  id uuid primary key default gen_random_uuid(),
  github_installation_id bigint not null unique,
  workspace_id uuid not null references workspaces(id),
  status text not null default 'active', -- active, suspended, deleted
  repository_selection text not null default 'selected', -- selected, all
  permissions jsonb,
  installed_by_github_user_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  suspended_at timestamptz,
  deleted_at timestamptz
);
create index if not exists installations_workspace_idx on installations (workspace_id);

-- A repository the app may see through an installation. selected = false after it is removed from the installation.
create table if not exists repositories (
  id uuid primary key default gen_random_uuid(),
  github_repo_id bigint not null unique,
  workspace_id uuid not null references workspaces(id),
  installation_id uuid references installations(id),
  full_name text not null,
  name text not null,
  owner_login text not null,
  private boolean not null default true,
  default_branch text,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deselected_at timestamptz
);
create index if not exists repositories_workspace_idx on repositories (workspace_id);

-- Per-repository QA configuration (docs/github-access-contract.md, decision 5; VI-34).
create table if not exists repository_settings (
  repository_id uuid primary key references repositories(id) on delete cascade,
  qa_md_path text not null default 'qa.md',
  preview_project_name text,
  production_url text,
  updated_by_user_id uuid references users(id),
  updated_at timestamptz not null default now()
);

-- Run ownership. Null workspace_id marks a legacy run (public demo data). New private runs set all four.
alter table runs add column if not exists workspace_id uuid references workspaces(id);
alter table runs add column if not exists repository_id uuid references repositories(id);
alter table runs add column if not exists initiated_by_user_id uuid references users(id);
alter table runs add column if not exists trigger text not null default 'legacy'; -- legacy, manual
create index if not exists runs_repository_idx on runs (repository_id, started_at desc);
create index if not exists runs_workspace_idx on runs (workspace_id, started_at desc);

-- Who did what on a run or a finding. Never holds a credential.
create table if not exists run_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  finding_id uuid references findings(id) on delete cascade,
  user_id uuid references users(id),
  action text not null, -- launch, decision, fix_request, fix_post, review_post, access_lost, ...
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists run_actions_run_idx on run_actions (run_id, created_at);

-- Concurrency and daily quota slots (contract section 8). The unique key is the atomic gate: of two
-- inserts for the last free slot, one wins and one gets nothing. Slots of live runs release on run end.
create table if not exists run_admissions (
  scope_key text not null,
  slot int not null,
  run_id uuid not null references runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scope_key, slot)
);
create index if not exists run_admissions_run_idx on run_admissions (run_id);

-- GitHub delivery ids seen by the webhook, so a redelivered lifecycle event applies once.
create table if not exists webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  action text,
  received_at timestamptz not null default now()
);
