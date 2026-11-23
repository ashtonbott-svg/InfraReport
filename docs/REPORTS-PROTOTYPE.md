# Electrical Infrared Inspection Report (prototype)

Branch `report-prototype` only. Not in production; no screen, route, database or Excel export changes.
The owner's Generator workbook, VBA, PowerPoint and Word templates are reference only and untouched.

## Pieces

| File | Role |
| --- | --- |
| `src/lib/reports/severity.ts` | Generator rules: Delta T bands (<19 normal, <62 potential, <128 serious, else critical), severity colors, the Validation sheet's cause-to-recommendation table, not-evaluated reasons. |
| `src/lib/reports/inspection-report.ts` | Report model built from InfraReport records (rooms, room conditions, equipment, lines, image entries). Read only. Orders findings worst first (severity, then Delta T), then the rest in room order; complete inventory; review list for the administrator. |
| `src/lib/reports/render-inspection-report.ts` | Landscape 10 x 7.5 in HTML pages, printed to PDF by Chromium. |
| `scripts/report-sample/brim-report.ts` | Brim Laundry proof of concept: Generator rows to InfraReport records to PDF. Reads customer data and photos from paths given on the command line; writes nothing to the repository. |

## Rules that differ from the Generator (deliberately)

* A blank Max Temp is never a temperature. The Generator computes Delta T as minus the ambient and labels
  such rows "Normal". Here: no image and a documented reason = **Not Evaluated (reason)**; a cause without
  a Max Temp = **visual finding**, severity set by the reviewer (blocks approval until set).
* Equipment imaged while **Off** or **Locked Out** is Not Evaluated, never Normal (the owner's finished Brim
  equipment list already says so). Can't Open / Inaccessible with an image = surface scanned, evaluated.
* No image and no reason = **Not documented**, listed for the reviewer, never claimed as Normal.
* Page references are real PDF page numbers.

## Open decisions for the owner

1. Visual findings (cause, no Max Temp): which severity, or a separate category?
2. Off equipment that was imaged: keep its page (documents the condition) or inventory only?
3. Equipment notes column in the inventory, finding summary table length, cover with several buildings.
4. Photo storage and matching (next stage): originals uploaded per job to private storage, matched by the
   image numbers recorded on each entry, with review of missing, duplicate and ambiguous photos.
