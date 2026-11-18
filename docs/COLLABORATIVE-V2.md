# InfraReport: collaborative inspections, owner setup

For the production release and migration 5, see `docs/PRODUCTION-RELEASE.md`.

This branch (`collaborative-v2`) adds shared cloud inspections. Production (`main`) is not changed by anything here.

## 1. Apply the database migrations (Supabase project `yuoqdyrhhchfdapyqxdz` only)

1. Open https://supabase.com/dashboard/project/yuoqdyrhhchfdapyqxdz/sql/new
2. Paste the whole contents of `supabase/migrations/20261118000100_collaborative_core.sql` and press **Run**. It should finish with "Success. No rows returned".
3. New query. Paste `supabase/migrations/20261118000200_admin_bootstrap.sql`, press **Run**.
4. New query. Paste `supabase/migrations/20261118000300_event_received_at.sql`, press **Run**.
5. New query. Paste `supabase/migrations/20261118000400_approval_lock.sql`, press **Run** (see Migration 4 below).
6. New query. Paste `supabase/migrations/20261119000500_field_test_improvements.sql`, press **Run** (verification queries in `docs/PRODUCTION-RELEASE.md`, Step 1).

Run them once each, in that order. Running the first file a second time fails on purpose (the tables already exist) and changes nothing.

### Migration 4: approved inspections are locked (added later)

If you already ran migrations 1 to 3, run only this one:

1. Open https://supabase.com/dashboard/project/yuoqdyrhhchfdapyqxdz/sql/new
2. Paste the whole contents of `supabase/migrations/20261118000400_approval_lock.sql` and press **Run**. Expect "Success. No rows returned".
3. Check it, in a new query:
   ```sql
   select count(*) as lock_triggers from pg_trigger where tgname = 'approval_lock';
   ```
   The answer must be **5**.

Run it once. A second run stops with "trigger approval_lock already exists" and changes nothing. Existing data is kept; inspections that are already approved become locked.

What it does:
* Approved, Report Generated and Delivered inspections are read only for everyone, administrators included, until an administrator reopens them (Review page or inspection header: **Reopen for corrections**).
* Reopening records who, when, the reason and the count, clears the approval, and sets the inspection to In Progress so assigned technicians can correct it. It must be approved again.
* Every change after the first approval is logged in `inspection_changes` (administrators only; shown as **Changes since approval** on the Review page).
* A phone that edited offline before the approval cannot change the approved data: its upload is refused and listed on that phone's Sync page with **Retry** (after a reopen) or **Discard**.
* Download Excel works in every status.

## 2. Make ashton@infiniteinfrared.com the administrator (one time)

In a new SQL Editor query run exactly:

```sql
select public.bootstrap_first_admin('ashton@infiniteinfrared.com', 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC');
```

It returns the new organization id (`org-…`). It does not change the account's password. It refuses to run again once an administrator exists, and app users cannot call it at all.

If it says "No confirmed auth user", confirm the email under Authentication → Users first.

## 3. Server settings in Vercel (Preview only)

Vercel → project **infrareport** → Settings → Environment Variables. Add both for the **Preview** environment only (leave Production unchecked), mark them **Sensitive**:

| Name | Value |
| --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret keys** (starts with `sb_secret_`). Create one named "infrareport-server" if none exists. |
| `INFRAREPORT_PIN_PEPPER` | A random value of at least 32 characters that you generate yourself, for example from a password manager. Keep it: changing it later makes every technician PIN invalid. |

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are already set for Preview.

Then redeploy the latest `collaborative-v2` preview (Deployments → the newest collaborative-v2 deployment → ⋯ → Redeploy) so it picks up the new variables. Check: open `<preview url>/api/health`; all four values must be `true`.

## 4. Use one stable preview address on both phones

Each commit gets its own preview URL, but the branch also has a fixed address, shown on the deployment page under **Domains**, of the form `infrareport-git-collaborative-v2-<team>.vercel.app`. Always use that branch address. A phone's trusted-device activation and its saved data belong to one web address, so switching addresses would mean activating again.

Preview deployments are protected by Vercel Authentication:

1. Ashton's phone: sign in to Vercel once in the phone's browser.
2. Justice's phone: on the deployment page use **Share** to create a shareable link and send it. Opening it once on the phone lets that browser in without a Vercel account.

Add the page to the home screen on both phones after signing in.

## 5. First sign-in

1. Ashton: open the branch address, **Administrator Login**, email and password.
2. Ashton: **Technicians** → Add technician "Justice Thompson", "Level I Thermographer" → **Create and get link**.
3. Text the link to Justice. Tell Justice the temporary PIN **12345** in person or by phone (it only works with that link, once, within 24 hours).
4. Justice opens the link on their own phone, enters 12345, then chooses and confirms a personal PIN (6 digits recommended).
5. From then on Justice signs in with **Technician Login**: tap their name, enter the PIN.

Admin tools on the Technicians page: activate another phone, reset PIN (signs out every phone and issues a new link), disable or enable the account, revoke a single phone.

## 6. Moving existing inspections into the cloud

Records saved before sync stay on the device and are never removed automatically.

* Same phone, same address: Settings → **Move existing inspections to the cloud** → From this device → tick customers → review the counts → confirm.
* From the production app: production and the preview are different web addresses, so the preview cannot read production's storage. On the phone that has the data, open production, Settings → **Download JSON backup**. Then in the preview: Settings → Move existing inspections → **From a backup file** → choose that file → tick → confirm.

Copies get new ids starting with `up-`, so copying twice is prevented. Photos are not copied.

## What syncs and what does not

| Synced through the database | Stays on the phone |
| --- | --- |
| Customers, facilities, rooms, equipment inventory | Photos (equipment, Before Opening, exterior) |
| Inspections, assignments, status, submit and approval | Which room or item a phone has open, site visit timing |
| Room conditions, equipment lines, every thermal image entry | Custom possible causes and default emissivity settings |
| History events | |

A phone without signal keeps saving locally. Its new work is not visible to the other phone until it reconnects; the status shows Offline with the number of waiting changes. "Synced to Cloud" is shown only after the database confirmed every change.

When the same value was changed on both phones, nothing is overwritten: the Sync page asks which one to keep.

## Running the checks locally

```
npx supabase start && npx supabase db reset
npm test                      # unit tests
npm run test:integration      # needs SUPABASE_TEST_* variables, see the test files
node scripts/check-two-phones.cjs http://localhost:3200   # see header of the script
```
