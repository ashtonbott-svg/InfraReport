# Hosted migration history (project yuoqdyrhhchfdapyqxdz)

Migrations 1 to 4 were applied by hand in the Supabase SQL Editor on 2026-11-18. On 2026-11-18 the hosted
schema was compared object by object (columns, functions, triggers, policies, RLS, grants, indexes) with a
database built from these files: identical. They were then **recorded in the history without being executed**
(Management API `PUT /database/migrations`). Migration 5 was applied with `POST /database/migrations`.

The Management API assigns its own version numbers. The history entry **name** is the repository file name,
and that is what decides whether a file has been applied:

| Repository file | Hosted history version | How |
| --- | --- | --- |
| `20261118000100_collaborative_core.sql` | 20261118224406 | applied manually, recorded only |
| `20261118000200_admin_bootstrap.sql` | 20261118224417 | applied manually, recorded only |
| `20261118000300_event_received_at.sql` | 20261118224420 | applied manually, recorded only |
| `20261118000400_approval_lock.sql` | 20261118224422 | applied manually, recorded only |
| `20261119000500_field_test_improvements.sql` | 20261118224430 | applied through the Management API |
| `20261121000600_room_moves.sql` | 20261120211248 | applied with `scripts/supabase-migrate.sh` (2026-11-20) |
| `20261121000700_room_delete_uninspected.sql` | 20261120222013 | applied with `scripts/supabase-migrate.sh` (2026-11-20) |
| `20261124000800_customer_facility_deletion.sql` | (filled in when applied) | applied with `scripts/supabase-migrate.sh` |

Rules:

* Never edit a migration file that appears in this table. Add a new file with a later timestamp.
* Apply new migrations with `scripts/supabase-migrate.sh` (applies only files whose name is not yet in the
  hosted history; `--dry-run` lists them). Do not use `supabase db push` against this project: the CLI
  matches on version numbers, which differ from the file timestamps above.
* Never reset the hosted database.
