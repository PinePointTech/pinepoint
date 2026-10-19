-- Why a run failed, for example "Planning failed: ..." or "Planning did not finish in 6 minutes.".
-- Null for every run that did not fail. GET /api/runs/[id]/status sends it as run.error.
-- packages/core/src/run-error.ts adds this column on first use when it is missing.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

alter table runs add column if not exists error text;
