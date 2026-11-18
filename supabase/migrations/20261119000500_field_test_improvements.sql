-- InfraReport, migration 5: improvements from the AMNT Mansfield / Burleson field test.
-- Additive only: existing records, accounts, PINs and history are kept.
--
-- 1. results.photo_notes: notes typed on photos are synced as text (photos stay on the phone).
-- 2. inspections.approval_snapshot: equipment names, room names and room order at approval,
--    so approved reports stay historically accurate after the inventory is renamed or reordered.
-- 3. Primary Thermographer: inspections.primary_thermographer + primary_locked (administrator
--    designated). Technicians may only choose among assigned people and never override a designation.
-- 4. One submission per cycle: submission_count and exactly one "Submitted for review" history
--    event written by the database, however many phones send the submission.
-- 5. exterior_checks: per building front photo acknowledgment shared between phones.
-- 6. sync_reports: each phone reports how many changes it has not uploaded (administrators read it).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.results add column if not exists photo_notes jsonb not null default '[]'::jsonb;

alter table public.inspections
  add column if not exists approval_snapshot jsonb,
  add column if not exists primary_thermographer uuid references auth.users (id) on delete set null,
  add column if not exists primary_locked boolean not null default false,
  add column if not exists submission_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- Approval snapshot
-- ---------------------------------------------------------------------------
create or replace function public.approval_snapshot_for(insp text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'at', now(),
    'equipment', coalesce((
      select jsonb_object_agg(e.id, jsonb_build_object('name', e.name))
      from public.equipment e
      where e.id in (select r.equipment_id from public.results r where r.inspection_id = insp and r.deleted_at is null)
    ), '{}'::jsonb),
    'locations', coalesce((
      select jsonb_object_agg(l.id, jsonb_build_object('building', l.building, 'name', l.name, 'sort_order', l.sort_order))
      from public.locations l
      where l.id in (
        select r.location_id from public.results r where r.inspection_id = insp and r.deleted_at is null
        union select rc.location_id from public.room_conditions rc where rc.inspection_id = insp and rc.deleted_at is null)
    ), '{}'::jsonb))
  where (select auth.uid()) is null   -- owner maintenance
     or exists (select 1 from public.inspections i where i.id = insp and public.is_org_admin(i.organization_id))
$$;
-- Called by the approval trigger as the approving administrator; returns nothing for anyone else.
revoke all on function public.approval_snapshot_for(text) from anon, authenticated, public;
grant execute on function public.approval_snapshot_for(text) to authenticated;

-- The change log records inspection data, not database bookkeeping (snapshot, submission counter).
create or replace function public.row_diff(old_row jsonb, new_row jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}'::jsonb)
  from jsonb_each(new_row) n
  left join jsonb_each(coalesce(old_row, '{}'::jsonb)) o on o.key = n.key
  where n.key not in ('version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'id', 'organization_id',
                      'approval_snapshot', 'submission_count')
    and n.value is distinct from o.value
$$;
revoke all on function public.row_diff(jsonb, jsonb) from anon, authenticated, public;

-- Inspections that are already approved get a snapshot of their current names and order
-- (the best information available; nothing older is invented).
update public.inspections set approval_snapshot = public.approval_snapshot_for(id)
 where approval_snapshot is null and status in ('Approved', 'Report Generated', 'Delivered');

-- ---------------------------------------------------------------------------
-- Inspection rules (replaces the version from migration 4; same lock rules plus the additions)
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
  new.approval_snapshot := old.approval_snapshot;
  new.submission_count := old.submission_count;

  if (select auth.uid()) is null then
    -- service role / owner maintenance: keep the stamps consistent
    if new.status = 'Approved' and old.status is distinct from 'Approved' then
      new.first_approved_at := coalesce(old.first_approved_at, now());
      new.approval_snapshot := public.approval_snapshot_for(new.id);
    end if;
    if new.status = 'Needs Review' and old.status is distinct from 'Needs Review' then
      new.submission_count := old.submission_count + 1;
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
    -- Primary Thermographer: field choice among assigned people, never over an administrator's designation.
    if new.primary_locked is distinct from old.primary_locked then
      raise exception 'Only administrators can designate the primary thermographer' using errcode = '42501';
    end if;
    if new.primary_thermographer is distinct from old.primary_thermographer then
      if old.primary_locked then
        raise exception 'The primary thermographer was designated by an administrator' using errcode = '42501';
      end if;
      if new.primary_thermographer is not null and not exists (
        select 1 from public.inspection_assignments a where a.inspection_id = new.id and a.user_id = new.primary_thermographer) then
        raise exception 'The primary thermographer must be assigned to the inspection' using errcode = '42501';
      end if;
    end if;
  else
    if was_locked and now_locked and (
         new.customer_id is distinct from old.customer_id or new.facility_id is distinct from old.facility_id
      or new.date is distinct from old.date or new.default_emissivity is distinct from old.default_emissivity
      or new.notes is distinct from old.notes or new.primary_thermographer is distinct from old.primary_thermographer) then
      raise exception 'Inspection is approved and locked. Reopen it for corrections first.' using errcode = '42501';
    end if;
    if new.primary_thermographer is not null and new.primary_thermographer is distinct from old.primary_thermographer
       and not exists (select 1 from public.memberships m where m.user_id = new.primary_thermographer and m.organization_id = old.organization_id) then
      raise exception 'The primary thermographer must belong to this organization' using errcode = '42501';
    end if;
  end if;

  if new.status = 'Needs Review' and old.status is distinct from 'Needs Review' then
    -- One submission per cycle: concurrent submissions are serialized by the row lock,
    -- and the second one finds the status already 'Needs Review' (no new cycle).
    new.submitted_at := now(); new.submitted_by := (select auth.uid());
    new.submission_count := old.submission_count + 1;
  end if;
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    new.approved_at := now(); new.approved_by := (select auth.uid());
    new.first_approved_at := coalesce(old.first_approved_at, now());
    new.approval_snapshot := public.approval_snapshot_for(new.id);
  end if;
  if was_locked and not now_locked then
    new.approved_at := null; new.approved_by := null;
    new.reopened_at := now(); new.reopened_by := (select auth.uid());
    new.reopen_count := old.reopen_count + 1;
  end if;
  return new;
end $$;

-- Exactly one history event per submission cycle, written by the database.
create or replace function public.tg_submission_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Needs Review' and old.status is distinct from 'Needs Review' then
    insert into public.review_events (id, organization_id, inspection_id, action, detail, at, actor)
    values ('ev-submitted-' || new.id || '-' || new.submission_count, new.organization_id, new.id,
            'Submitted for review', 'Submission ' || new.submission_count, now(), new.submitted_by)
    on conflict (id) do nothing;
  end if;
  return null;
end $$;
create trigger submission_event after update on public.inspections for each row execute function public.tg_submission_event();

-- ---------------------------------------------------------------------------
-- Front building photo acknowledgments (shared between phones)
-- ---------------------------------------------------------------------------
create table public.exterior_checks (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  building text not null default '',
  status text not null check (status in ('photo', 'camera', 'exception')),
  note text not null default '',
  acknowledged_by uuid,
  acknowledged_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz,
  check (status <> 'exception' or length(trim(note)) > 0)
);
create unique index exterior_checks_one_per_building on public.exterior_checks (inspection_id, building) where deleted_at is null;
create index exterior_checks_updated on public.exterior_checks (organization_id, updated_at);

create or replace function public.tg_exterior_ack() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null then new.acknowledged_by := (select auth.uid()); end if;
  return new;
end $$;

create trigger row_meta before insert or update on public.exterior_checks for each row execute function public.tg_row_meta();
create trigger same_org before insert on public.exterior_checks for each row execute function public.tg_same_org_as_inspection();
create trigger acknowledged_by before insert or update on public.exterior_checks for each row execute function public.tg_exterior_ack();
create trigger approval_lock before insert or update on public.exterior_checks for each row execute function public.tg_lock_approved();

alter table public.exterior_checks enable row level security;
create policy xc_read on public.exterior_checks for select to authenticated using (public.can_work_inspection(inspection_id));
create policy xc_insert on public.exterior_checks for insert to authenticated with check (public.can_work_inspection(inspection_id));
create policy xc_update on public.exterior_checks for update to authenticated using (public.can_work_inspection(inspection_id)) with check (public.can_work_inspection(inspection_id));

-- ---------------------------------------------------------------------------
-- Unsent-change reports from each phone
-- ---------------------------------------------------------------------------
create table public.sync_reports (
  device_id text not null,
  inspection_id text not null references public.inspections (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  pending integer not null default 0 check (pending >= 0),
  failed integer not null default 0 check (failed >= 0),
  reported_at timestamptz not null default now(),
  primary key (device_id, inspection_id, user_id)
);
create index sync_reports_inspection on public.sync_reports (inspection_id);

create or replace function public.tg_sync_report() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null then new.user_id := (select auth.uid()); end if;
  new.reported_at := now();
  return new;
end $$;
create trigger report_meta before insert or update on public.sync_reports for each row execute function public.tg_sync_report();
create trigger same_org before insert on public.sync_reports for each row execute function public.tg_same_org_as_inspection();

alter table public.sync_reports enable row level security;
create policy sr_read on public.sync_reports for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_admin(organization_id));
create policy sr_insert on public.sync_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_work_inspection(inspection_id));
create policy sr_update on public.sync_reports for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.can_work_inspection(inspection_id));

-- ---------------------------------------------------------------------------
-- Grants (explicit: automatic exposure is disabled on this project)
-- ---------------------------------------------------------------------------
revoke all on public.exterior_checks, public.sync_reports from anon, authenticated, public;
grant select, insert, update on public.exterior_checks to authenticated;
grant select, insert, update on public.sync_reports to authenticated;
grant all on public.exterior_checks, public.sync_reports to service_role;
revoke all on function public.tg_submission_event(), public.tg_exterior_ack(), public.tg_sync_report() from anon, authenticated, public;
grant execute on all functions in schema public to service_role;
