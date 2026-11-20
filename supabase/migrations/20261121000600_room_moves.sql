-- InfraReport, migration 6: move equipment between rooms, delete or archive rooms.
-- Additive only. No existing row is changed: the new column is nullable and starts empty, and the
-- new triggers only check rows that are being changed.
--
-- 1. locations.archived_at: a room that only approved (historical) inspections still use is
--    archived instead of deleted. It disappears from the active inventory and from room pickers;
--    approved reports keep showing it.
-- 2. Guards (the app checks the same rules first; these stop a second phone or an old app version
--    from leaving broken references):
--    * a room cannot be deleted or archived while it still has equipment, equipment lines in an
--      inspection that is not approved, or measured room conditions in such an inspection;
--    * a room used by an approved inspection can only be archived, never deleted;
--    * equipment, equipment lines and room conditions cannot be placed in a deleted or archived room.

alter table public.locations add column if not exists archived_at timestamptz;

create or replace function public.tg_location_removal_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not ((old.deleted_at is null and new.deleted_at is not null) or (old.archived_at is null and new.archived_at is not null)) then
    return new;
  end if;
  select count(*) into n from public.equipment e where e.location_id = new.id and e.deleted_at is null;
  if n > 0 then
    raise exception 'Room still has % equipment item(s). Move them to another room first.', n using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.results r join public.inspections i on i.id = r.inspection_id
    where r.location_id = new.id and r.deleted_at is null and i.deleted_at is null and not public.inspection_locked(i.id)
  ) then
    raise exception 'Room is still used by an open inspection. Move its equipment lines to another room first.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.room_conditions c join public.inspections i on i.id = c.inspection_id
    where c.location_id = new.id and c.deleted_at is null and i.deleted_at is null and not public.inspection_locked(i.id)
      and (c.humidity <> '' or c.ambient_temp <> '' or c.background_temp <> '' or c.image_date <> '')
  ) then
    raise exception 'Room has measured conditions in an open inspection. Remove the room from that inspection first.' using errcode = 'P0001';
  end if;
  if old.deleted_at is null and new.deleted_at is not null and exists (
    select 1 from public.inspections i
    where i.deleted_at is null and public.inspection_locked(i.id) and (
      exists (select 1 from public.results r where r.inspection_id = i.id and r.location_id = new.id and r.deleted_at is null)
      or exists (select 1 from public.room_conditions c where c.inspection_id = i.id and c.location_id = new.id and c.deleted_at is null))
  ) then
    raise exception 'Room is part of an approved report and can only be archived, not deleted.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.tg_location_must_be_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.location_id is not distinct from old.location_id then return new; end if;
  if new.deleted_at is not null then return new; end if;
  if exists (select 1 from public.locations l where l.id = new.location_id and (l.deleted_at is not null or l.archived_at is not null)) then
    raise exception 'That room was deleted or archived. Choose another room.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger room_rules before update on public.locations for each row execute function public.tg_location_removal_rules();
create trigger room_rules before insert or update on public.equipment for each row execute function public.tg_location_must_be_active();
create trigger room_rules before insert or update on public.results for each row execute function public.tg_location_must_be_active();
create trigger room_rules before insert or update on public.room_conditions for each row execute function public.tg_location_must_be_active();

revoke all on function public.tg_location_removal_rules(), public.tg_location_must_be_active() from anon, authenticated, public;
grant execute on function public.tg_location_removal_rules(), public.tg_location_must_be_active() to service_role;
