-- Pictures of a mission's screen: Pine's frame after each agent step, the agent's fail.png, or a last screenshot.
-- GET /api/shots/[id] serves them. They live here, not in Vercel Blob, so they do not depend on a Blob token.
-- packages/core/src/shots.ts creates this table on first use when it is missing.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

create table if not exists mission_shots (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id),
  -- 0 for fail.png and a last screenshot; 1, 2, ... for the step pictures in step order.
  idx int not null default 0,
  media_type text not null,
  -- The Pine step title, for example "Click Add to cart". Empty when the picture has no step.
  title text not null default '',
  observed_at timestamptz,
  -- The image bytes as base64. The Neon HTTP driver sends text parameters as-is.
  data_b64 text not null,
  created_at timestamptz not null default now()
);

create index if not exists mission_shots_mission_idx on mission_shots (mission_id, idx);
