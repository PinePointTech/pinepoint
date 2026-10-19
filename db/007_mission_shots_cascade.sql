-- Deleting a mission (or a run's missions) also deletes its pictures, instead of failing on the foreign key.
-- Apply with: pnpm --filter @pinepoint/core db:migrate

alter table mission_shots drop constraint if exists mission_shots_mission_id_fkey;
alter table mission_shots
  add constraint mission_shots_mission_id_fkey foreign key (mission_id) references missions(id) on delete cascade;
