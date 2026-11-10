-- CAPTURAS (Libroteca): imágenes subidas a YourImageShare, ordenadas en carpetas como un Drive.
-- La imagen vive en YourImageShare; aquí se guarda su id (para borrarla allí) y sus enlaces.
-- Borrar es en dos pasos: se marca `deleted_at` (desaparece al instante) y la función
-- `screenshots` la borra de YourImageShare y luego la fila, respetando su límite de peticiones.
begin;
create table public.screenshot_folders(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references public.screenshot_folders(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(parent_id is distinct from id)
);
create index screenshot_folders_owner on public.screenshot_folders(owner_id, parent_id);
alter table public.screenshot_folders enable row level security;
create policy own_screenshot_folders on public.screenshot_folders for all to authenticated
  using(owner_id = auth.uid()) with check(owner_id = auth.uid());
grant select, insert, update, delete on public.screenshot_folders to authenticated;

create table public.screenshots(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- Al borrar una carpeta sus capturas ya están marcadas para borrar: no se pierden de vista.
  folder_id uuid references public.screenshot_folders(id) on delete set null,
  name text not null default '' check(length(name) <= 200),
  note text not null default '' check(length(note) <= 4000),
  tags text[] not null default '{}' check(cardinality(tags) <= 30),
  yis_id text not null check(length(yis_id) between 1 and 40),
  src text not null check(src ~ '^https://'),
  url text not null check(url ~ '^https://'),
  thumb text check(thumb is null or thumb ~ '^https://'),
  width integer,
  height integer,
  size bigint not null default 0,
  mime text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index screenshots_owner on public.screenshots(owner_id, folder_id, created_at desc);
create index screenshots_trash on public.screenshots(owner_id) where deleted_at is not null;
alter table public.screenshots enable row level security;
create policy own_screenshots on public.screenshots for all to authenticated
  using(owner_id = auth.uid()) with check(owner_id = auth.uid());
grant select, insert, update, delete on public.screenshots to authenticated;
commit;
