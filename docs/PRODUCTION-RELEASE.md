# InfraReport production release (replacing V1)

Work through these in order. Each step says how to check it. Nothing here touches any project other than the Vercel project **infrareport**, the GitHub repository **ashtonbott-svg/InfraReport** and the Supabase project **yuoqdyrhhchfdapyqxdz**.

> Status 2026-11-18: migration 5 applied and verified through the Management API; history reconciled (see
> `supabase/MIGRATIONS.md`). Future migrations: `scripts/supabase-migrate.sh`.

## Step 1. Apply migration 5 to the hosted database

Migrations 1 to 4 are already applied. Apply only migration 5.

1. Open https://supabase.com/dashboard/project/yuoqdyrhhchfdapyqxdz/sql/new
2. Paste the whole file `supabase/migrations/20261119000500_field_test_improvements.sql` (branch collaborative-v2) and press **Run**. Expect "Success. No rows returned".
3. New query, run this check:

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'inspections'
     and column_name in ('approval_snapshot', 'primary_thermographer', 'primary_locked', 'submission_count')) as inspection_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'results' and column_name = 'photo_notes') as photo_notes,
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('exterior_checks', 'sync_reports')) as new_tables,
  (select count(*) from pg_trigger where tgname in ('submission_event', 'acknowledged_by', 'report_meta')) as new_triggers,
  (select count(*) from pg_trigger where tgname = 'approval_lock') as approval_lock_triggers;
```

Expected: `inspection_columns 4, photo_notes 1, new_tables 2, new_triggers 3, approval_lock_triggers 6`.

4. Confirm nothing was lost (compare with what you know):

```sql
select (select count(*) from public.inspections) as inspections,
       (select count(*) from public.results where deleted_at is null) as equipment_lines,
       (select count(*) from public.thermal_images where deleted_at is null) as thermal_images,
       (select count(*) from public.memberships) as people,
       (select count(*) from public.tech_credentials where pin_hash is not null) as pins_set,
       (select count(*) from public.inspections where status in ('Approved','Report Generated','Delivered') and approval_snapshot is null) as approved_without_snapshot;
```

`approved_without_snapshot` must be 0. The other numbers must match what you had before.

Run the migration once. A second run stops with "already exists" and changes nothing.

## Step 2. Verify the preview

1. Vercel, project **infrareport**, Deployments: open the newest **collaborative-v2** deployment. If it was built before Step 1, use **Redeploy**.
2. Open `<preview address>/api/health`. Required: `"ready": true` and `"migration5": true`. `commit` shows which commit answered.
3. On both phones, open the preview, sign in, and run a short test inspection (or open an existing one): notes, Download Excel (both formats), rename, reorder, views, Primary Thermographer, front photo reminder, submit.

## Step 3. Make sure nothing is left only on a preview phone

The preview and production are different web addresses. Each keeps its own copy on the phone, and **changes that never synced from the preview phone do not exist in production**.

On each phone, in the preview: open **Sync**. It must say **Synced to Cloud** with nothing waiting, nothing failed and no decisions needed. If anything is waiting, stay online on that page until it is gone.

## Step 4. Production environment variables (Vercel, project infrareport only)

Production must use the same Supabase project and the **same PIN pepper**. A new pepper would make every technician PIN invalid. Do not create a new one.

Vercel → project **infrareport** → Settings → Environment Variables. For each of these four, open the existing variable (⋯ → Edit) and tick **Production** in addition to Preview. Keep the value unchanged:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | https://yuoqdyrhhchfdapyqxdz.supabase.co |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key |
| `SUPABASE_SECRET_KEY` | secret key (Sensitive) |
| `INFRAREPORT_PIN_PEPPER` | **identical** to Preview (Sensitive) |

If Vercel does not let you add Production to an existing Sensitive variable, add a new Production-only variable with the same name and the same value: the secret key can be copied again from Supabase → Project Settings → API Keys, and the pepper from wherever you stored it. **If the pepper value can no longer be found, stop and tell me.** Do not invent a new one.

Never paste these values into a chat.

## Step 5. Deployment protection (technicians must not need Vercel accounts)

Vercel → project **infrareport** → Settings → Deployment Protection → **Vercel Authentication**: choose **Standard Protection**. It keeps every preview deployment protected and leaves the production address (https://infrareport-six.vercel.app) open to everyone, who then still must sign in to InfraReport. Do not choose "All Deployments", and do not disable protection. This setting only affects this project.

## Step 6. Release (I do this after you confirm Steps 1, 2, 4 and 5)

1. Tag the current production commit as `v1-final` (rollback point; no history is rewritten).
2. Merge collaborative-v2 into main. Vercel builds production from main.
3. Check `https://infrareport-six.vercel.app/api/health`: `ready: true`, `migration5: true`, `commit` = the merged commit.
4. Sign in as administrator on production.

## Step 7. Moving both phones to production

* **Ashton**: open https://infrareport-six.vercel.app, Administrator Login (same email and password). Shared inspections load from the cloud.
* **Justice**: Ashton opens **Technicians** on the **production** address and taps **Activate a phone** next to Justice. Text the link. Justice opens it on his phone and enters **the PIN he already uses**. His PIN does not change and no new account is created. (Links always point to the address they were created on, so create them on production.)
* **Old V1 data on a phone** (anything saved in V1 that was never in the cloud): it is kept on that phone. Signed in as administrator on production: Settings → **Move existing inspections to the cloud** → From this device → tick → confirm. Originals are never removed.
* Add the production address to the home screen; remove the preview icon afterwards.

## Rollback

Vercel → Deployments → the last V1 production deployment → **Instant Rollback** (or Promote to Production). Git keeps tag `v1-final`. The database changes from migrations 1 to 5 are additive; V1 does not use the database, so rolling back the app does not touch shared inspection data.
