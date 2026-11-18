-- InfraReport V2, migration 4: approved inspections are locked.
--
-- 1. An inspection in Approved, Report Generated or Delivered is read only for
--    EVERY app user (administrators included). Rooms, room conditions,
--    equipment lines and thermal image entries of a locked inspection cannot be
--    added or changed. Late offline uploads from any phone are refused with a
--    clear error instead of silently changing approved data.
-- 2. Only an administrator can reopen it (status back to In Progress or Needs
--    Review). Reopening is recorded (who, when, why, how many times) and the
--    approval is cleared, so the inspection must be approved again.
-- 3. Every change made after the first approval is written to
--    inspection_changes, readable by administrators only.
-- The service role (owner maintenance from the SQL Editor) is not restricted.

-- ---------------------------------------------------------------------------
-- New inspection columns (set by the database, not by the app)
-- ---------------------------------------------------------------------------
alter table public.inspections
  add column if not exists first_approved_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists reopen_reason text not null default '';

-- Inspections approved before this migration count as approved once.
update public.inspections set first_approved_at = coalesce(approved_at, updated_at)
 where first_approved_at is null and status in ('Approved', 'Report Generated', 'Delivered');

create or replace function public.inspection_locked(insp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.inspections i
    where i.id = insp and i.status in ('Approved', 'Report Generated', 'Delivered')
  )
$$;

-- ---------------------------------------------------------------------------
-- Inspection rules (replaces the version from migration 1)
-- ---------------------------------------------------------------------------
create or replace function public.tg_inspection_rules() returns trigger
language plpgsql set search_path = '' as $$
declare
  admin boolean := public.is_org_admin(old.organization_id);
  was_locked boolean := old.status in ('Approved', 'Report Generated', 'Delivered');
  now_locked boolean := new.status in ('Approved', 'Report Generated', 'Delivered');
begin
  -- Database-managed columns can never be set by the app.
  new.first_approved_at := old.first_approved_at;
  new.reopened_at := old.reopened_at;
  new.reopened_by := old.reopened_by;
  new.reopen_count := old.reopen_count;
  if (select auth.uid()) is null then
    -- service role / owner maintenance: still keep the approval stamps consistent
    if new.status = 'Approved' and old.status is distinct from 'Approved' then
      new.first_approved_at := coalesce(old.first_approved_at, now());
    end if;
    return new;
  end if;

  if not admin then
    if new.customer_id is distinct from old.customer_id or new.facility_id is distinct from old.facility_id
       or new.date is distinct from old.date or new.deleted_at is distinct from old.deleted_at
       or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
      raise exception 'Only administrators can change these inspection fields' using errcode = '42501';
    end if;
    if was_locked then
      raise exception 'Inspection is approved and locked. An administrator must reopen it before it can be changed.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('In Progress', 'Needs Review') then
      raise exception 'Only administrators can set status %', new.status using errcode = '42501';
    end if;
  else
    -- Administrators: while locked, only the status may change (reopen, or move
    -- on to Report Generated / Delivered), plus deleting the inspection.
    if was_locked and now_locked and (
         new.customer_id is distinct from old.customer_id or new.facility_id is distinct from old.facility_id
      or new.date is distinct from old.date or new.default_emissivity is distinct from old.default_emissivity
      or new.notes is distinct from old.notes) then
      raise exception 'Inspection is approved and locked. Reopen it for corrections first.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'Needs Review' and old.status is distinct from 'Needs Review' then
    new.submitted_at := now(); new.submitted_by := (select auth.uid());
  end if;
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    new.approved_at := now(); new.approved_by := (select auth.uid());
    new.first_approved_at := coalesce(old.first_approved_at, now());
  end if;
  if was_locked and not now_locked then
    -- Reopened for corrections: the approval no longer stands.
    new.approved_at := null; new.approved_by := null;
    new.reopened_at := now(); new.reopened_by := (select auth.uid());
    new.reopen_count := old.reopen_count + 1;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Lock the inspection's data
-- ---------------------------------------------------------------------------
create or replace function public.tg_lock_approved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if public.inspection_locked(new.inspection_id) then
    raise exception 'Inspection is approved and locked. An administrator must reopen it before it can be changed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.inspection_id is distinct from new.inspection_id and public.inspection_locked(old.inspection_id) then
      raise exception 'Inspection is approved and locked. An administrator must reopen it before it can be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger approval_lock before insert or update on public.room_conditions for each row execute function public.tg_lock_approved();
create trigger approval_lock before insert or update on public.results for each row execute function public.tg_lock_approved();
create trigger approval_lock before insert or update on public.thermal_images for each row execute function public.tg_lock_approved();

-- Rooms and equipment belong to the facility. A technician may only create or
-- change them while assigned to an open (not approved) inspection there.
create or replace function public.tg_facility_edit_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_org_admin(new.organization_id) then return new; end if;
  if not exists (
    select 1 from public.inspections i
    join public.inspection_assignments a on a.inspection_id = i.id and a.user_id = (select auth.uid())
    join public.memberships m on m.user_id = a.user_id and m.active
    where i.facility_id = new.facility_id and i.deleted_at is null
      and i.status not in ('Approved', 'Report Generated', 'Delivered')
  ) then
    raise exception 'Inspection is approved and locked. An administrator must reopen it before rooms or equipment can be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger approval_lock before insert or update on public.locations for each row execute function public.tg_facility_edit_rules();
create trigger approval_lock before insert or update on public.equipment for each row execute function public.tg_facility_edit_rules();

-- ---------------------------------------------------------------------------
-- Change history after the first approval
-- ---------------------------------------------------------------------------
create table public.inspection_changes (
  id bigint generated always as identity primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  table_name text not null,
  record_id text not null,
  action text not null,               -- created / changed / deleted / reopened / approved / status
  changes jsonb not null default '{}'::jsonb,  -- { field: [before, after] }
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index on public.inspection_changes (inspection_id, changed_at);
alter table public.inspection_changes enable row level security;
create policy changes_admin_read on public.inspection_changes for select to authenticated
  using (public.is_org_admin(organization_id));
revoke all on public.inspection_changes from anon, authenticated, public;
grant select on public.inspection_changes to authenticated;
grant all on public.inspection_changes to service_role;

create or replace function public.row_diff(old_row jsonb, new_row jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}'::jsonb)
  from jsonb_each(new_row) n
  left join jsonb_each(coalesce(old_row, '{}'::jsonb)) o on o.key = n.key
  where n.key not in ('version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'id', 'organization_id')
    and n.value is distinct from o.value
$$;

create or replace function public.tg_log_after_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare insp text; diff jsonb; act text := 'changed'; old_json jsonb := null; new_json jsonb := to_jsonb(new);
begin
  if tg_table_name = 'inspections' then insp := new_json->>'id'; else insp := new_json->>'inspection_id'; end if;
  if not exists (select 1 from public.inspections i where i.id = insp and i.first_approved_at is not null) then
    return null;
  end if;
  if tg_op = 'UPDATE' then old_json := to_jsonb(old); end if;
  diff := public.row_diff(old_json, new_json);
  if diff = '{}'::jsonb then return null; end if;
  if tg_table_name = 'inspections' then
    if (new_json->>'reopen_count')::int > (old_json->>'reopen_count')::int then act := 'reopened';
    elsif new_json->>'status' = 'Approved' and old_json->>'status' is distinct from 'Approved' then act := 'approved';
    elsif new_json->>'status' is distinct from old_json->>'status' then act := 'status';
    end if;
  elsif tg_op = 'INSERT' then act := 'created';
  elsif new_json->>'deleted_at' is not null and old_json->>'deleted_at' is null then act := 'deleted';
  end if;
  insert into public.inspection_changes (organization_id, inspection_id, table_name, record_id, action, changes, changed_by)
  values (new_json->>'organization_id', insp, tg_table_name, new_json->>'id', act, diff, (select auth.uid()));
  return null;
end $$;

create trigger log_after_approval after update on public.inspections for each row execute function public.tg_log_after_approval();
create trigger log_after_approval after insert or update on public.room_conditions for each row execute function public.tg_log_after_approval();
create trigger log_after_approval after insert or update on public.results for each row execute function public.tg_log_after_approval();
create trigger log_after_approval after insert or update on public.thermal_images for each row execute function public.tg_log_after_approval();

revoke all on function public.inspection_locked(text), public.tg_lock_approved(), public.tg_facility_edit_rules(),
  public.tg_log_after_approval(), public.row_diff(jsonb, jsonb) from anon, authenticated, public;
grant execute on function public.inspection_locked(text) to authenticated;
grant execute on all functions in schema public to service_role;
