-- GitHub webhook: one claim per PR head SHA, so two deliveries at the same time start one run.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

create table if not exists webhook_claims (
  -- owner/repo#pr@sha
  key text primary key,
  -- Null while the planner runs. Set when the run exists.
  run_id uuid references runs(id),
  claimed_at timestamptz not null default now()
);
