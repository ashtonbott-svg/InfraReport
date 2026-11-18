-- History events carry the time they happened on the device ("at"), which can be
-- hours before an offline phone uploads them. "received_at" is the server time
-- they arrived, so other devices can reliably fetch everything new.
alter table public.review_events add column if not exists received_at timestamptz not null default now();
create index if not exists review_events_received_at on public.review_events (organization_id, received_at);
create index if not exists customers_updated on public.customers (organization_id, updated_at);
create index if not exists facilities_updated on public.facilities (organization_id, updated_at);
create index if not exists locations_updated on public.locations (organization_id, updated_at);
create index if not exists equipment_updated on public.equipment (organization_id, updated_at);
create index if not exists inspections_updated on public.inspections (organization_id, updated_at);
create index if not exists room_conditions_updated on public.room_conditions (organization_id, updated_at);
create index if not exists results_updated on public.results (organization_id, updated_at);
create index if not exists thermal_images_updated on public.thermal_images (organization_id, updated_at);
