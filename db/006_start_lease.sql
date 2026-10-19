-- One call at a time starts the Computers of a run. fillSlots in packages/runner/src/orchestrate.ts
-- takes the lease with a conditional update and gives it back after the starts. A call that dies
-- leaves the lease to expire. Not the same as next_start_at, which the client shows as a rate-limit wait.
-- packages/runner/src/start-lease.ts adds this column on first use when it is missing.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

alter table runs add column if not exists start_lease_until timestamptz;
