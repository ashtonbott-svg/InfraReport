# InfraReport architecture notes

## Entities

| Entity | Purpose | Lifetime |
| --- | --- | --- |
| Organization | Tenant (Infinite Infrared, future customers of the SaaS) | Permanent |
| User | Member of one organization with a role (owner, admin, inspector, reviewer) | Permanent |
| Customer | Company being inspected | Permanent |
| Facility | Site belonging to a customer | Permanent |
| Location | Room / electrical area / building inside a facility | Permanent |
| Equipment | Identity of a physical item (Panel P1) | Permanent, can be retired |
| Inspection | One visit to one facility on one date | Per visit |
| InspectionRoomConditions | Humidity, ambient, background, distance, image date for a room during one inspection | Per visit |
| InspectionResult | What was found on one Equipment during one Inspection (component, images, temps, opened, cause, overrides) | Per visit |
| ImageAsset | Thermal / visual image metadata and its match to a result | Per visit |
| DocumentAsset | Field notes, workbooks, reports | Per visit |
| ReviewEvent | Audit trail (status changes, exports, approvals) | Append only |

Equipment identity is separate from inspection results: Panel P1 keeps one id
across years while each inspection creates a new InspectionResult.

## Inheritance

`resolveEffective()` in `src/lib/domain/rules.ts` is the single source of truth:
row override → room conditions → inspection default (emissivity 0.95) → blank.
`null` means inherit; any string (including empty) is an explicit override.

## Tenant isolation plan

Every tenant table carries `organization_id`. In Postgres/Supabase:

```sql
alter table customers enable row level security;
create policy tenant_isolation on customers
  using (organization_id = (select organization_id from memberships where user_id = auth.uid()));
```

The same policy pattern applies to every tenant table. Files go in a private
bucket under `org/<organization_id>/...` with signed URLs only.

## Generator compatibility

`src/lib/domain/csv.ts` defines the 16 columns and their Excel destinations
(B through N, then R). O, P and Q are never written. Open questions to settle
with the real workbook:

1. Does the Generator expect `Can’t Open Item` with a typographic apostrophe (as
   specified) or a straight one?
2. Image Date format (currently MM/DD/YYYY).
3. Does the macro read the CSV with a UTF-8 BOM correctly? (toggle in Settings)
4. Location text when a building is set (currently `Building - Room`).
