-- InfraReport, migration 9: cloud photographs and native report versions (report-prototype branch).
-- Additive only: new tables, a private storage bucket and its access rules. No existing row changes.
--
-- 1. photo_files: one row per original photograph uploaded for an inspection (building exterior,
--    infrared, visual, equipment, before-opening). The file itself lives in the private Storage bucket
--    "inspection-photos" at <organization>/<inspection>/<photo id>/<original file name>. It is never
--    re-encoded. A row counts as safely stored only when the server has re-read the stored object and
--    its SHA-256 and size match what the uploading device computed (verified_at, set by the server).
-- 2. Access: administrators of the organization and technicians assigned to the inspection, the
--    same rule as equipment lines (can_work_inspection). Files cannot be overwritten; only
--    administrators can remove them.
-- 3. inspection_reports (per inspection: report settings, annotations, scope notes) and
--    report_versions (draft and approved report snapshots). Reports are administrator-only.

create table public.photo_files (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  facility_id text not null default '',
  kind text not null check (kind in ('exterior', 'ir', 'visual', 'equipment', 'before-opening', 'other')),
  building text not null default '',
  -- Match to an equipment line and thermal image entry (null = not matched yet).
  result_id text,
  image_id text,
  match_source text check (match_source in ('auto', 'manual')),
  image_number text not null default '',
  original_name text not null,
  mime_type text not null default '',
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz,
  uploaded_at timestamptz,
  verified_at timestamptz,
  verify_error text,
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index on public.photo_files (inspection_id);
create index on public.photo_files (inspection_id, sha256);
create trigger row_meta before insert or update on public.photo_files for each row execute function public.tg_row_meta();
create trigger same_org before insert on public.photo_files for each row execute function public.tg_same_org_as_inspection();
create trigger parent_alive before insert or update on public.photo_files for each row execute function public.tg_parent_not_deleted();

-- Only the server (no signed-in user) sets verification; devices cannot claim a file is stored.
create or replace function public.tg_photo_verification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    new.verified_at := null; new.verify_error := null;
  else
    new.verified_at := old.verified_at; new.verify_error := old.verify_error;
    -- The stored file's identity never changes.
    new.sha256 := old.sha256; new.size_bytes := old.size_bytes; new.storage_path := old.storage_path; new.inspection_id := old.inspection_id;
  end if;
  return new;
end $$;
create trigger verification before insert or update on public.photo_files for each row execute function public.tg_photo_verification();

alter table public.photo_files enable row level security;
create policy photo_files_read on public.photo_files for select to authenticated using (public.can_work_inspection(inspection_id));
create policy photo_files_insert on public.photo_files for insert to authenticated with check (public.can_work_inspection(inspection_id));
create policy photo_files_update on public.photo_files for update to authenticated using (public.can_work_inspection(inspection_id)) with check (public.can_work_inspection(inspection_id));
create policy photo_files_admin_delete on public.photo_files for delete to authenticated using (public.is_org_admin(organization_id));
revoke all on public.photo_files from anon;
grant select, insert, update, delete on public.photo_files to authenticated;
grant all on public.photo_files to service_role;

-- ---------------------------------------------------------------------------
-- Private Storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('inspection-photos', 'inspection-photos', false, 104857600)
on conflict (id) do nothing;

-- Path: <organization>/<inspection>/<photo id>/<file name>
create or replace function public.photo_path_inspection(path text) returns text
language sql immutable set search_path = '' as $$ select split_part(path, '/', 2) $$;

create policy "inspection photos read" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-photos' and public.can_work_inspection(public.photo_path_inspection(name)));
create policy "inspection photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-photos' and public.can_work_inspection(public.photo_path_inspection(name))
    and split_part(name, '/', 1) = (select organization_id from public.inspections where id = public.photo_path_inspection(name)));
create policy "inspection photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'inspection-photos' and exists (select 1 from public.inspections i where i.id = public.photo_path_inspection(name) and public.is_org_admin(i.organization_id)));
-- No update policy: stored originals cannot be overwritten.

-- ---------------------------------------------------------------------------
-- Native reports (administrators)
-- ---------------------------------------------------------------------------
create table public.inspection_reports (
  inspection_id text primary key references public.inspections (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,       -- scope notes, title, cover photos, visual annotations
  version integer not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  inspection_id text not null references public.inspections (id) on delete cascade,
  number integer not null,
  status text not null check (status in ('draft', 'approved', 'superseded')),
  model jsonb not null,                              -- the report exactly as generated (data, not layout)
  photo_ids jsonb not null default '[]'::jsonb,      -- photo_files used, for reproducible downloads
  review jsonb not null default '[]'::jsonb,         -- items flagged for the administrator
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  approved_at timestamptz, approved_by uuid,
  unique (inspection_id, number)
);
create or replace function public.tg_report_version_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'approved' and new.status = 'approved' and (new.model is distinct from old.model or new.photo_ids is distinct from old.photo_ids) then
      raise exception 'An approved report cannot be changed. Generate a new draft.' using errcode = 'P0001';
    end if;
    new.model := case when old.status = 'approved' then old.model else new.model end;
    if new.status = 'approved' and old.status <> 'approved' then new.approved_at := now(); new.approved_by := (select auth.uid()); end if;
  end if;
  return new;
end $$;
create trigger rules before update on public.report_versions for each row execute function public.tg_report_version_rules();

alter table public.inspection_reports enable row level security;
alter table public.report_versions enable row level security;
create policy inspection_reports_admin on public.inspection_reports for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy report_versions_admin_read on public.report_versions for select to authenticated using (public.is_org_admin(organization_id));
create policy report_versions_admin_insert on public.report_versions for insert to authenticated with check (public.is_org_admin(organization_id));
create policy report_versions_admin_update on public.report_versions for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
revoke all on public.inspection_reports, public.report_versions from anon;
grant select, insert, update on public.inspection_reports, public.report_versions to authenticated;
grant all on public.inspection_reports, public.report_versions to service_role;

revoke all on function public.tg_photo_verification(), public.tg_report_version_rules(), public.photo_path_inspection(text) from anon, public;
grant execute on function public.photo_path_inspection(text) to authenticated;
grant execute on function public.tg_photo_verification(), public.tg_report_version_rules(), public.photo_path_inspection(text) to service_role;
