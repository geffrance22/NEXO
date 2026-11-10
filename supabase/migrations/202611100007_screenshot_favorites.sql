-- CAPTURAS: favoritas (estrella) y archivadas (fuera de las carpetas, pero sin borrar).
begin;
alter table public.screenshots
  add column if not exists favorite boolean not null default false,
  add column if not exists archived_at timestamptz;
create index if not exists screenshots_favorites on public.screenshots(owner_id)
  where favorite and deleted_at is null;
create index if not exists screenshots_archived on public.screenshots(owner_id)
  where archived_at is not null and deleted_at is null;
commit;
