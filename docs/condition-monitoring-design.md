# Condition Monitoring: data design (not built yet)

Status: design only. Nothing here is implemented beyond what already exists. The Condition Monitoring
report is a separate generator from the Electrical Infrared Inspection Report.

## What already supports it

* **Stable equipment identity.** `equipment.id` stays the same from one inspection to the next at a
  facility (carry forward, rename and move between rooms keep the id). This is the key that links
  readings over time. Approved inspections keep a snapshot of the name and room they were inspected in.
* **One reading per thermal image entry.** `thermal_images` holds the component, IR and visual numbers,
  Max Temp and Possible Cause. Room conditions (ambient, background, humidity) are on `room_conditions`
  with per-line overrides.
* **Frozen reports.** `report_versions.model` stores the exact numbers an approved report showed,
  so history is never recalculated from data that was corrected later.
* **Photographs.** `photo_files` links every original to inspection, entry (`image_id`) and building.

## What it needs

1. **A component key.** The component text ("Section 2 - Top Half") is free text, so the same physical
   point can be spelled differently each visit. Add `equipment_points`:
   `id, organization_id, equipment_id, label, sort_order, archived_at`, and an optional
   `thermal_images.point_id`. New inspections carry the point forward with the equipment; older entries
   are linked once by an administrator (suggested by matching component text, never automatically).
2. **A read-only history view** (SQL view `point_readings`): point, inspection date, inspection status,
   Max Temp, ambient (after overrides), ΔT, severity band, cause, photo ids, approved report version.
   Only approved inspections count as history; drafts show as "not final".
3. **Load.** ΔT comparisons are only meaningful at similar load. Add optional `thermal_images.load_percent`
   (or amps) as recorded in the field; blank means unknown and is shown as unknown, never estimated.
4. **Trend rules** (report-time only, stored with the report model when approved):
   * Change in ΔT since the previous approved visit and since the first.
   * Flag a rising trend only with at least 3 approved readings, and never when load is unknown on either side.
   * Not evaluated / off / locked out visits appear as gaps, not zeros.
5. **Schedule.** `facilities.monitoring_interval_months` (optional) and a computed "next due" for the dashboard.

## Report outline (later)

Cover and scope as in the inspection report; per point: a small ΔT-over-time chart, the last readings
table (date, Max, ambient, ΔT, load, severity), current IR and visual photographs side by side with the
previous visit's, and the reviewer's comment. Same approval workflow (`report_versions`) with a
`kind` column added (`inspection` | `condition-monitoring`).

## Open questions for the owner

* Should points be defined per equipment type (templates) or always by hand?
* Is load recorded today, and in what form (percent, amps, "normal")?
* What interval defines "recurring" per customer?
