-- InfraReport V2: collaborative inspections
-- Organization-isolated schema with Row Level Security on every table.
-- New tables are NOT auto-exposed on this project, so grants are explicit.
-- Record ids are text (stable ids generated on the device) so offline-created
-- records keep the same id when they sync, and retries cannot duplicate them.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Organizations and memberships
-- ---------------------------------------------------------------------------
create table public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('admin', 'technician');

-- One membership per auth user (one organization per person for now).
create table public.memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  role public.member_role not null,
  display_name text not null,
  certification text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.memberships (organization_id);

-- ---------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER so policies do not recurse into RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_org() returns text
language sql stable security definer set search_path = '' as $$
  select m.organization_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.active
$$;

create or replace function public.is_org_admin(org text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.active and m.role = 'admin' and m.organization_id = org
  )
$$;

create or replace function public.is_org_member(org text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.active and m.organization_id = org
  )
$$;

-- ---------------------------------------------------------------------------
-- Shared columns: version (optimistic concurrency), who/when, soft delete
-- ---------------------------------------------------------------------------
create or replace function public.tg_row_meta() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := (select auth.uid());
    new.updated_by := (select auth.uid());
  else
    -- identity and ownership never change through updates
    new.id := old.id;
    new.organization_id := old.organization_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := (select auth.uid());
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Customers, facilities, rooms (locations), permanent equipment
-- ---------------------------------------------------------------------------
create table public.customers (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  notes text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table public.facilities (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  name text not null,
  address text not null default '',
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  notes text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.facilities (customer_id);

-- A room / electrical area. "building" names the building it belongs to.
create table public.locations (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  facility_id text not null references public.facilities (id) on delete cascade,
  building text not null default '',
  name text not null,
  area text not null default '',
  sort_order double precision not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.locations (facility_id);

create table public.equipment (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  facility_id text not null references public.facilities (id) on delete cascade,
  location_id text not null references public.locations (id) on delete cascade,
  name text not null,
  equipment_type text not null default 'Other',
  default_component text not null default '',
  identifiers text not null default '',
  imported_from text not null default '',
  active boolean not null default true,
  sort_order double precision not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.equipment (facility_id);
create index on public.equipment (location_id);

-- ---------------------------------------------------------------------------
-- Inspections and assignments
-- ---------------------------------------------------------------------------
create table public.inspections (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  facility_id text not null references public.facilities (id) on delete cascade,
  date date not null,
  status text not null default 'Draft'
    check (status in ('Draft', 'In Progress', 'Needs Review', 'Approved', 'Report Generated', 'Delivered')),
  default_emissivity text not null default '0.95',
  notes text not null default '',
  submitted_at timestamptz, submitted_by uuid,
  approved_at timestamptz, approved_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.inspections (facility_id);

create table public.inspection_assignments (
  inspection_id text not null references public.inspections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (inspection_id, user_id)
);
create index on public.inspection_assignments (user_id);

create or replace function public.is_assigned(insp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.inspection_assignments a
    join public.memberships m on m.user_id = a.user_id and m.active
    where a.inspection_id = insp and a.user_id = (select auth.uid())
  )
$$;

-- Admin of the organization, or assigned to an open inspection at the facility.
create or replace function public.can_access_facility(fac text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.facilities f where f.id = fac and public.is_org_admin(f.organization_id)
  ) or exists (
    select 1 from public.inspections i
    join public.inspection_assignments a on a.inspection_id = i.id and a.user_id = (select auth.uid())
    join public.memberships m on m.user_id = a.user_id and m.active
    where i.facility_id = fac and i.deleted_at is null
  )
$$;

create or replace function public.can_access_customer(cust text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c where c.id = cust and public.is_org_admin(c.organization_id)
  ) or exists (
    select 1 from public.inspections i
    join public.inspection_assignments a on a.inspection_id = i.id and a.user_id = (select auth.uid())
    join public.memberships m on m.user_id = a.user_id and m.active
    where i.customer_id = cust and i.deleted_at is null
  )
$$;

create or replace function public.can_work_inspection(insp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.inspections i where i.id = insp and public.is_org_admin(i.organization_id)
  ) or public.is_assigned(insp)
$$;

-- Technicians may move an inspection to In Progress or Needs Review only.
-- Approval and later stages are administrator-only, enforced in the database.
create or replace function public.tg_inspection_rules() returns trigger
language plpgsql set search_path = '' as $$
declare admin boolean := public.is_org_admin(old.organization_id);
begin
  if (select auth.uid()) is null then return new; end if; -- service role / owner maintenance
  if not admin then
    if new.customer_id is distinct from old.customer_id or new.facility_id is distinct from old.facility_id
       or new.date is distinct from old.date or new.deleted_at is distinct from old.deleted_at
       or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
      raise exception 'Only administrators can change these inspection fields' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('In Progress', 'Needs Review') then
      raise exception 'Only administrators can set status %', new.status using errcode = '42501';
    end if;
    if old.status in ('Approved', 'Report Generated', 'Delivered') then
      raise exception 'Approved inspections can only be changed by an administrator' using errcode = '42501';
    end if;
  end if;
  if new.status = 'Needs Review' and old.status is distinct from 'Needs Review' then
    new.submitted_at := now(); new.submitted_by := (select auth.uid());
  end if;
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    new.approved_at := now(); new.approved_by := (select auth.uid());
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Inspection data: room conditions, results, thermal image entries
-- ---------------------------------------------------------------------------
create table public.room_conditions (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  location_id text not null references public.locations (id) on delete cascade,
  humidity text not null default '',
  ambient_temp text not null default '',
  background_temp text not null default '',
  image_date text not null default '',
  conditions_copied_from text,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
-- Two phones adding the same room to the inspection collapse to one row.
create unique index room_conditions_one_per_room on public.room_conditions (inspection_id, location_id) where deleted_at is null;

create table public.results (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  equipment_id text not null references public.equipment (id) on delete cascade,
  location_id text not null references public.locations (id) on delete cascade,
  opened text not null default 'Yes, Completely',
  exception jsonb,
  confidence text not null default '',
  review_notes text not null default '',
  overrides jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  sort_order double precision not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.results (inspection_id);
create unique index results_one_per_equipment on public.results (inspection_id, equipment_id) where deleted_at is null;

create table public.thermal_images (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  result_id text not null references public.results (id) on delete cascade,
  sort_order double precision not null default 0,
  component text not null default '',
  ir_image_number text not null default '',
  visual_image_number text not null default '',
  visual_overridden boolean not null default false,
  distance text not null default '',
  possible_cause text not null default 'NONE',
  max_temp text not null default '',
  notes text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.thermal_images (result_id);
create index on public.thermal_images (inspection_id);

create table public.review_events (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now(),
  actor uuid default auth.uid()
);
create index on public.review_events (inspection_id);

-- Triggers
do $$
declare t text;
begin
  foreach t in array array['customers','facilities','locations','equipment','inspections','room_conditions','results','thermal_images'] loop
    execute format('create trigger row_meta before insert or update on public.%I for each row execute function public.tg_row_meta()', t);
  end loop;
end $$;
create trigger inspection_rules before update on public.inspections for each row execute function public.tg_inspection_rules();

-- Children must belong to the same organization as their parent inspection.
create or replace function public.tg_same_org_as_inspection() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from (select i.organization_id from public.inspections i where i.id = new.inspection_id) then
    raise exception 'organization mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger same_org before insert on public.room_conditions for each row execute function public.tg_same_org_as_inspection();
create trigger same_org before insert on public.results for each row execute function public.tg_same_org_as_inspection();
create trigger same_org before insert on public.thermal_images for each row execute function public.tg_same_org_as_inspection();
create trigger same_org before insert on public.review_events for each row execute function public.tg_same_org_as_inspection();
create trigger same_org before insert on public.inspection_assignments for each row execute function public.tg_same_org_as_inspection();

-- ---------------------------------------------------------------------------
-- Technician sign-in (server only: no grants to clients at all)
-- ---------------------------------------------------------------------------
create table public.tech_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text,                       -- scrypt hash of the personal PIN (never the temporary PIN)
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pin_set_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.tech_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,     -- sha256 of the random device secret kept in an httpOnly cookie
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index on public.tech_devices (user_id);

create table public.tech_activations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,     -- sha256 of the single-use activation token
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_attempts integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.auth_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.customers enable row level security;
alter table public.facilities enable row level security;
alter table public.locations enable row level security;
alter table public.equipment enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_assignments enable row level security;
alter table public.room_conditions enable row level security;
alter table public.results enable row level security;
alter table public.thermal_images enable row level security;
alter table public.review_events enable row level security;
alter table public.tech_credentials enable row level security;
alter table public.tech_devices enable row level security;
alter table public.tech_activations enable row level security;
alter table public.auth_rate_limits enable row level security;
-- (tech_* and auth_rate_limits have no policies: only the server's secret key can use them)

create policy org_read on public.organizations for select to authenticated using (public.is_org_member(id));

-- Members of the same organization can see each other's name and certification
-- (needed to show who is assigned to a job). Credentials live in other tables.
create policy membership_same_org on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(organization_id));

-- customers / facilities: admins manage; technicians read what their assigned jobs need
create policy customers_read on public.customers for select to authenticated using (public.can_access_customer(id));
create policy customers_admin_insert on public.customers for insert to authenticated with check (public.is_org_admin(organization_id));
create policy customers_admin_update on public.customers for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy customers_admin_delete on public.customers for delete to authenticated using (public.is_org_admin(organization_id));

create policy facilities_read on public.facilities for select to authenticated using (public.can_access_facility(id));
create policy facilities_admin_insert on public.facilities for insert to authenticated with check (public.is_org_admin(organization_id));
create policy facilities_admin_update on public.facilities for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy facilities_admin_delete on public.facilities for delete to authenticated using (public.is_org_admin(organization_id));

-- rooms and equipment: assigned technicians create and edit them for the job's facility
create policy locations_read on public.locations for select to authenticated using (public.can_access_facility(facility_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (public.is_org_member(organization_id) and public.can_access_facility(facility_id)
              and organization_id = (select f.organization_id from public.facilities f where f.id = facility_id));
create policy locations_update on public.locations for update to authenticated
  using (public.can_access_facility(facility_id)) with check (public.can_access_facility(facility_id));
create policy locations_admin_delete on public.locations for delete to authenticated using (public.is_org_admin(organization_id));

create policy equipment_read on public.equipment for select to authenticated using (public.can_access_facility(facility_id));
create policy equipment_insert on public.equipment for insert to authenticated
  with check (public.is_org_member(organization_id) and public.can_access_facility(facility_id)
              and organization_id = (select f.organization_id from public.facilities f where f.id = facility_id));
create policy equipment_update on public.equipment for update to authenticated
  using (public.can_access_facility(facility_id)) with check (public.can_access_facility(facility_id));
create policy equipment_admin_delete on public.equipment for delete to authenticated using (public.is_org_admin(organization_id));

create policy inspections_read on public.inspections for select to authenticated
  using (public.is_org_admin(organization_id) or public.is_assigned(id));
create policy inspections_admin_insert on public.inspections for insert to authenticated with check (public.is_org_admin(organization_id));
create policy inspections_update on public.inspections for update to authenticated
  using (public.is_org_admin(organization_id) or public.is_assigned(id))
  with check (public.is_org_admin(organization_id) or public.is_assigned(id));
create policy inspections_admin_delete on public.inspections for delete to authenticated using (public.is_org_admin(organization_id));

create policy assignments_read on public.inspection_assignments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_admin(organization_id) or public.is_assigned(inspection_id));
create policy assignments_admin_insert on public.inspection_assignments for insert to authenticated with check (public.is_org_admin(organization_id));
create policy assignments_admin_delete on public.inspection_assignments for delete to authenticated using (public.is_org_admin(organization_id));

create policy rc_read on public.room_conditions for select to authenticated using (public.can_work_inspection(inspection_id));
create policy rc_insert on public.room_conditions for insert to authenticated with check (public.can_work_inspection(inspection_id));
create policy rc_update on public.room_conditions for update to authenticated using (public.can_work_inspection(inspection_id)) with check (public.can_work_inspection(inspection_id));

create policy results_read on public.results for select to authenticated using (public.can_work_inspection(inspection_id));
create policy results_insert on public.results for insert to authenticated with check (public.can_work_inspection(inspection_id));
create policy results_update on public.results for update to authenticated using (public.can_work_inspection(inspection_id)) with check (public.can_work_inspection(inspection_id));

create policy images_read on public.thermal_images for select to authenticated using (public.can_work_inspection(inspection_id));
create policy images_insert on public.thermal_images for insert to authenticated with check (public.can_work_inspection(inspection_id));
create policy images_update on public.thermal_images for update to authenticated using (public.can_work_inspection(inspection_id)) with check (public.can_work_inspection(inspection_id));

create policy events_read on public.review_events for select to authenticated using (public.can_work_inspection(inspection_id));
create policy events_insert on public.review_events for insert to authenticated
  with check (public.can_work_inspection(inspection_id) and actor = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants (explicit: automatic exposure is disabled on this project)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
grant usage on schema public to authenticated;

grant select on public.organizations, public.memberships to authenticated;
grant select, insert, update, delete on public.customers, public.facilities, public.locations, public.equipment, public.inspections to authenticated;
grant select, insert, delete on public.inspection_assignments to authenticated;
grant select, insert, update on public.room_conditions, public.results, public.thermal_images to authenticated;
grant select, insert on public.review_events to authenticated;
grant execute on function public.current_org(), public.is_org_admin(text), public.is_org_member(text), public.is_assigned(text),
  public.can_access_facility(text), public.can_access_customer(text), public.can_work_inspection(text) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
