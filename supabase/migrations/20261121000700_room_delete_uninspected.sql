-- InfraReport, migration 7: delete a room together with its uninspected equipment.
-- Additive: no column or row is changed. Only the checks run when a room or an item of equipment is
-- deleted or archived are adjusted. Equipment deletion stays a recoverable soft delete (deleted_at).
--
-- 1. A room may be archived while it still holds retired equipment that only approved reports use
--    (kept for those reports). Deleting a room still requires it to hold no equipment at all, and
--    archiving still requires no active equipment.
-- 2. An item of equipment cannot be deleted while an approved report uses it (retire it instead), or
--    while an equipment line for it is still in an open inspection (the line is removed first; a
--    phone that has not seen that line yet cannot delete the equipment under it).

create or replace function public.tg_location_removal_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n integer; deleting boolean := old.deleted_at is null and new.deleted_at is not null;
begin
  if not (deleting or (old.archived_at is null and new.archived_at is not null)) then
    return new;
  end if;
  select count(*) into n from public.equipment e
  where e.location_id = new.id and e.deleted_at is null and (deleting or e.active);
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
  if deleting and exists (
    select 1 from public.inspections i
    where i.deleted_at is null and public.inspection_locked(i.id) and (
      exists (select 1 from public.results r where r.inspection_id = i.id and r.location_id = new.id and r.deleted_at is null)
      or exists (select 1 from public.room_conditions c where c.inspection_id = i.id and c.location_id = new.id and c.deleted_at is null))
  ) then
    raise exception 'Room is part of an approved report and can only be archived, not deleted.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.tg_equipment_delete_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (old.deleted_at is null and new.deleted_at is not null) then return new; end if;
  if exists (
    select 1 from public.results r join public.inspections i on i.id = r.inspection_id
    where r.equipment_id = new.id and r.deleted_at is null and i.deleted_at is null and public.inspection_locked(i.id)
  ) then
    raise exception 'This equipment is part of an approved report and cannot be deleted. Retire it instead.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.results r join public.inspections i on i.id = r.inspection_id
    where r.equipment_id = new.id and r.deleted_at is null and i.deleted_at is null
  ) then
    raise exception 'This equipment still has a line in an open inspection, so it was not deleted.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger delete_rules before update on public.equipment for each row execute function public.tg_equipment_delete_rules();

revoke all on function public.tg_equipment_delete_rules() from anon, authenticated, public;
grant execute on function public.tg_equipment_delete_rules() to service_role;
