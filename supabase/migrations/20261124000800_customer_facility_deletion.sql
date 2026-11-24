-- InfraReport, migration 8: delete, restore and archive customers and facilities.
-- Additive: one new table, one new column (facilities.archived_at, empty), new functions and guards.
-- No existing row is changed by applying this migration.
--
-- 1. Administrators delete a customer or a facility in ONE transaction (admin_delete_records): every
--    record under it is soft deleted (deleted_at) together, or nothing is. Approved inspection history
--    is included only when the caller explicitly asks (p_include_history); otherwise it is refused.
--    The deletion is recorded in deletion_batches with the exact records, so it can be restored
--    (admin_restore_deletion) for 30 days. Permanent removal (admin_purge_deletion) is a separate,
--    deliberate action that is refused until the 30-day recovery period has passed.
-- 2. Guards: nothing can be created, changed or revived under a deleted customer, facility or
--    inspection, so a stale or offline phone cannot bring deleted records back or leave orphans.
--    Its unsent changes are refused with a clear message and stay on that phone's Sync page.
-- 3. facilities.archived_at: archive a facility (kept with its history, hidden from new work).

alter table public.facilities add column if not exists archived_at timestamptz;

create table public.deletion_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('customer', 'facility')),
  target_id text not null,
  target_name text not null default '',
  include_history boolean not null default false,
  counts jsonb not null default '{}'::jsonb,
  ids jsonb not null default '{}'::jsonb,         -- { table: [ids] } exactly what this deletion soft deleted
  deleted_by uuid,
  deleted_at timestamptz not null,
  restored_at timestamptz, restored_by uuid,
  purged_at timestamptz, purged_by uuid
);
create index on public.deletion_batches (organization_id, deleted_at desc);
alter table public.deletion_batches enable row level security;
create policy deletion_batches_admin_read on public.deletion_batches for select to authenticated using (public.is_org_admin(organization_id));
revoke all on public.deletion_batches from anon, authenticated, public;
grant select on public.deletion_batches to authenticated;
grant all on public.deletion_batches to service_role;

-- Table order: children first (delete), parents first (restore).
create or replace function public.deletion_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['thermal_images', 'results', 'room_conditions', 'exterior_checks', 'inspections', 'equipment', 'locations', 'facilities', 'customers']
$$;

/** The records a customer or facility deletion covers: { table: [ids] } (live rows only). */
create or replace function public.deletion_scope(p_kind text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare fac text[]; insp text[]; out jsonb;
begin
  if p_kind = 'customer' then
    select coalesce(array_agg(id), '{}') into fac from public.facilities where customer_id = p_id and deleted_at is null;
    select coalesce(array_agg(id), '{}') into insp from public.inspections where (customer_id = p_id or facility_id = any(fac)) and deleted_at is null;
  else
    fac := array[p_id];
    select coalesce(array_agg(id), '{}') into insp from public.inspections where facility_id = p_id and deleted_at is null;
  end if;
  out := jsonb_build_object(
    'thermal_images', coalesce((select jsonb_agg(id) from public.thermal_images where inspection_id = any(insp) and deleted_at is null), '[]'),
    'results', coalesce((select jsonb_agg(id) from public.results where inspection_id = any(insp) and deleted_at is null), '[]'),
    'room_conditions', coalesce((select jsonb_agg(id) from public.room_conditions where inspection_id = any(insp) and deleted_at is null), '[]'),
    'exterior_checks', coalesce((select jsonb_agg(id) from public.exterior_checks where inspection_id = any(insp) and deleted_at is null), '[]'),
    'inspections', coalesce(to_jsonb(insp), '[]'),
    'equipment', coalesce((select jsonb_agg(id) from public.equipment where facility_id = any(fac) and deleted_at is null), '[]'),
    'locations', coalesce((select jsonb_agg(id) from public.locations where facility_id = any(fac) and deleted_at is null), '[]'),
    'facilities', coalesce((select jsonb_agg(id) from public.facilities where id = any(fac) and deleted_at is null), '[]'),
    'customers', case when p_kind = 'customer' then jsonb_build_array(p_id) else '[]'::jsonb end);
  return out;
end $$;

/** Run as the database owner for the rest of this transaction (approval locks treat it as maintenance). */
create or replace function public.as_maintenance() returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
$$;

create or replace function public.admin_delete_records(p_kind text, p_id text, p_include_history boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  org text; name text; scope jsonb; t text; ids text[]; n integer; counts jsonb := '{}'::jsonb;
  stamp timestamptz := clock_timestamp(); locked integer; batch uuid;
begin
  if p_kind not in ('customer', 'facility') then raise exception 'Unknown record type' using errcode = '22023'; end if;
  if p_kind = 'customer' then select organization_id, c.name into org, name from public.customers c where id = p_id and deleted_at is null;
  else select organization_id, f.name into org, name from public.facilities f where id = p_id and deleted_at is null; end if;
  if org is null then raise exception 'Not found, or already deleted.' using errcode = 'P0002'; end if;
  if caller is null or not public.is_org_admin(org) then raise exception 'Only an administrator can delete customers and facilities.' using errcode = '42501'; end if;
  scope := public.deletion_scope(p_kind, p_id);
  select count(*) into locked from public.inspections i where i.id in (select jsonb_array_elements_text(scope->'inspections')) and public.inspection_locked(i.id);
  if locked > 0 and not p_include_history then
    raise exception '% approved inspection report(s) belong to it. Archive it instead, or confirm deleting the approved history.', locked using errcode = 'P0001';
  end if;
  perform public.as_maintenance();
  foreach t in array public.deletion_tables() loop
    select array(select jsonb_array_elements_text(scope->t)) into ids;
    execute format('update public.%I set deleted_at = $1 where id = any($2) and deleted_at is null', t) using stamp, ids;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  insert into public.deletion_batches (organization_id, kind, target_id, target_name, include_history, counts, ids, deleted_by, deleted_at)
  values (org, p_kind, p_id, coalesce(name, ''), p_include_history, counts || jsonb_build_object('approved', locked), scope, caller, stamp)
  returning id into batch;
  return jsonb_build_object('batch', batch, 'counts', counts, 'deleted_at', stamp);
end $$;

create or replace function public.admin_restore_deletion(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.deletion_batches; caller uuid := (select auth.uid()); t text; ids text[]; n integer; counts jsonb := '{}'::jsonb;
begin
  select * into b from public.deletion_batches where id = p_batch for update;
  if b.id is null then raise exception 'Deletion not found.' using errcode = 'P0002'; end if;
  if caller is null or not public.is_org_admin(b.organization_id) then raise exception 'Only an administrator can restore deleted records.' using errcode = '42501'; end if;
  if b.restored_at is not null then raise exception 'Already restored.' using errcode = 'P0001'; end if;
  if b.purged_at is not null then raise exception 'Permanently deleted; it can no longer be restored.' using errcode = 'P0001'; end if;
  if b.kind = 'facility' and exists (select 1 from public.facilities f join public.customers c on c.id = f.customer_id where f.id = b.target_id and c.deleted_at is not null) then
    raise exception 'Its customer was deleted. Restore the customer first.' using errcode = 'P0001';
  end if;
  perform public.as_maintenance();
  for i in reverse array_length(public.deletion_tables(), 1)..1 loop
    t := (public.deletion_tables())[i];
    select array(select jsonb_array_elements_text(b.ids->t)) into ids;
    -- Only rows this deletion removed (same timestamp); anything deleted separately stays deleted.
    execute format('update public.%I set deleted_at = null where id = any($1) and deleted_at = $2', t) using ids, b.deleted_at;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  update public.deletion_batches set restored_at = now(), restored_by = caller where id = p_batch;
  return jsonb_build_object('batch', p_batch, 'counts', counts);
end $$;

create or replace function public.admin_purge_deletion(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.deletion_batches; caller uuid := (select auth.uid()); t text; ids text[]; n integer; counts jsonb := '{}'::jsonb;
begin
  select * into b from public.deletion_batches where id = p_batch for update;
  if b.id is null then raise exception 'Deletion not found.' using errcode = 'P0002'; end if;
  if caller is null or not public.is_org_admin(b.organization_id) then raise exception 'Only an administrator can permanently delete records.' using errcode = '42501'; end if;
  if b.restored_at is not null or b.purged_at is not null then raise exception 'Nothing left to delete for this entry.' using errcode = 'P0001'; end if;
  if b.deleted_at > now() - interval '30 days' then
    raise exception 'Still in the 30-day recovery period (until %).', to_char(b.deleted_at + interval '30 days', 'Mon DD, YYYY') using errcode = 'P0001';
  end if;
  perform public.as_maintenance();
  foreach t in array public.deletion_tables() loop
    select array(select jsonb_array_elements_text(b.ids->t)) into ids;
    execute format('delete from public.%I where id = any($1) and deleted_at = $2', t) using ids, b.deleted_at;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  update public.deletion_batches set purged_at = now(), purged_by = caller where id = p_batch;
  return jsonb_build_object('batch', p_batch, 'counts', counts);
end $$;

-- ---------------------------------------------------------------------------
-- Guards: no live record under a deleted parent (no orphans, no resurrection by stale phones).
-- ---------------------------------------------------------------------------
create or replace function public.tg_parent_not_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new); bad boolean := false;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_table_name in ('results', 'room_conditions', 'thermal_images', 'exterior_checks') then
    bad := exists (select 1 from public.inspections i where i.id = j->>'inspection_id' and i.deleted_at is not null);
  elsif tg_table_name = 'inspections' then
    bad := exists (select 1 from public.facilities f where f.id = j->>'facility_id' and f.deleted_at is not null)
        or exists (select 1 from public.customers c where c.id = j->>'customer_id' and c.deleted_at is not null);
  elsif tg_table_name in ('locations', 'equipment') then
    bad := exists (select 1 from public.facilities f where f.id = j->>'facility_id' and f.deleted_at is not null);
  elsif tg_table_name = 'facilities' then
    bad := exists (select 1 from public.customers c where c.id = j->>'customer_id' and c.deleted_at is not null);
  end if;
  if bad then
    raise exception 'This job, facility or customer was deleted by an administrator. The change was not saved; it can be retried if the deletion is restored.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger parent_alive before insert or update on public.results for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.room_conditions for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.thermal_images for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.exterior_checks for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.inspections for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.locations for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.equipment for each row execute function public.tg_parent_not_deleted();
create trigger parent_alive before insert or update on public.facilities for each row execute function public.tg_parent_not_deleted();

revoke all on function public.deletion_tables(), public.deletion_scope(text, text), public.as_maintenance(),
  public.admin_delete_records(text, text, boolean), public.admin_restore_deletion(uuid), public.admin_purge_deletion(uuid),
  public.tg_parent_not_deleted() from anon, authenticated, public;
grant execute on function public.admin_delete_records(text, text, boolean), public.admin_restore_deletion(uuid), public.admin_purge_deletion(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
