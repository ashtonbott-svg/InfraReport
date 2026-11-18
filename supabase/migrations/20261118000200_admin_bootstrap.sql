-- Controlled, one-time administrator bootstrap.
-- Not callable by app users (no grant to anon/authenticated). The project owner
-- runs it once in the Supabase SQL Editor for an existing, email-confirmed user:
--   select public.bootstrap_first_admin('ashton@infiniteinfrared.com', 'Ashton Bott',
--     'Level III Certified Master Thermographer', 'Infinite Infrared LLC');
-- It refuses to run if any administrator already exists, so nobody can use it
-- later to promote themselves.
create or replace function public.bootstrap_first_admin(
  admin_email text, admin_name text, admin_certification text, org_name text
) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; org text;
begin
  if exists (select 1 from public.memberships where role = 'admin') then
    raise exception 'An administrator already exists; bootstrap is disabled';
  end if;
  select u.id into uid from auth.users u
   where lower(u.email) = lower(admin_email) and u.email_confirmed_at is not null;
  if uid is null then
    raise exception 'No confirmed auth user with email %', admin_email;
  end if;
  org := 'org-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.organizations (id, name) values (org, org_name);
  insert into public.memberships (user_id, organization_id, role, display_name, certification)
  values (uid, org, 'admin', admin_name, admin_certification);
  return org;
end $$;

revoke all on function public.bootstrap_first_admin(text, text, text, text) from public, anon, authenticated;
