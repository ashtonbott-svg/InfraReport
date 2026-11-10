# InfraReport

Electrical infrared inspection management and reporting. Prototype build.

> **Prototype data notice.** All data is fictional and stored only in the browser's
> localStorage. This is not a secure or shared database. Do not enter real customer
> information until authentication, Postgres with per organization isolation, and
> private file storage are in place.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 36 unit + workflow tests (CSV layout, rules, store workflow)
npm run build
```

## Deploy (Vercel)

Deployed by the Vercel project connected to this repository. The app lives at the
repository root; `vercel.json` pins the framework to Next.js so the build does not
depend on the project's dashboard preset. Every push to the production branch
redeploys automatically; other branches get preview deployments.

## What works

| Area | Status |
| --- | --- |
| Dashboard, customers, facilities, rooms, equipment inventory | Functional |
| Inspections (create, carry forward inventory, status workflow, audit history) | Functional |
| Equipment entry (room conditions inherit, overrides, presets, quick add, duplicate, search/filter, keyboard nav) | Functional |
| Validation and approval gating | Functional |
| Generator CSV export (exact 16 columns) | Functional |
| Field notes upload and preview | Functional, session only; AI extraction **not connected** |
| Image number matching | Functional from file names; images **not stored** |
| Excel workbook population, PDF report | Not built (needs the real Generator workbook) |

## Code map

```
src/lib/domain/   types, constants (Opened values, causes, presets), rules, csv, validation
src/lib/store/    zustand store (localStorage) + fictional seed data + org-scoped hooks
src/components/   ui kit, app shell, inspection workspace (room panels, equipment grid)
src/app/          routes
tests/            vitest suites
docs/             architecture and database plan
```

The domain layer has no React or storage dependencies, so the same CSV and
validation code will run on the server once a database is added.
