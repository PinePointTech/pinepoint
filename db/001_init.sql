-- PinePoint schema. Copied from the Master Plan (STE), section 4.3.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

create table runs (
  id uuid primary key default gen_random_uuid(),
  pr_url text not null,
  owner text not null,
  repo text not null,
  pr_number int not null,
  head_sha text,
  author text,
  preview_url text,
  production_url text,
  status text not null default 'planning', -- planning, running, reporting, done, failed, no_preview
  review_id bigint,
  review_posted_at timestamptz,
  cost_usd numeric,
  started_at timestamptz default now(),
  finished_at timestamptz
);

create table missions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id),
  kind text not null default 'preview', -- preview, flake, production, rerun
  parent_id uuid references missions(id),
  lens text,
  persona text,
  goal text,
  checks jsonb,
  target_path text,
  target_line int,
  new_feature boolean default false,
  url text,
  status text not null default 'queued', -- queued, running, passed, failed, blocked, needs_you, error
  result jsonb,
  screenshot_url text,
  usage jsonb,
  pine_enc text, -- encrypted JSON: credentials, binding, session name, session token, computer id, turn id
  started_at timestamptz,
  finished_at timestamptz
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id),
  mission_ids uuid[],
  level text, -- bug, possible, old_bug
  title text,
  steps jsonb,
  expected text,
  saw text,
  production_saw text,
  screenshot_url text,
  path text,
  line int,
  comment_id bigint,
  decision text, -- bug, not_bug
  decided_at timestamptz,
  fix jsonb,
  fix_comment_id bigint,
  rerun_status text
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  repo text,
  finding_id uuid references findings(id),
  note text,
  created_at timestamptz default now()
);
