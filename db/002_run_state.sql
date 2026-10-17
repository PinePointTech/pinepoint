-- VI-10: state the runner needs to advance a run from the status route.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

-- After CreateRateLimitedError, no Computer starts for this run before this time.
alter table runs add column if not exists next_start_at timestamptz;

-- apps/demo-store/qa.md at the head SHA. Each mission Computer gets it as an attachment.
alter table runs add column if not exists qa_md text;

-- True while the mission's Computer stays running for the session link (plan 5, rule 6).
-- Pause is not enabled on the Pine project (VI-7), so a failed Computer is kept, not paused.
alter table missions add column if not exists kept boolean not null default false;

-- advanceRun reads the running missions of one run on every status call.
create index if not exists missions_run_status_idx on missions (run_id, status);
