-- Cuadernos de Agenda: colecciones de accesos directos (recuerdos, personas, lugares, episodios,
-- lecturas y notas) sobre un lienzo libre. Cada elemento guarda su tipo, su id y su posición;
-- el original sigue donde estaba.
begin;
create table public.agenda_notebooks(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  description text not null default '' check(length(description) <= 2000),
  color text not null default 'salvia' check(length(color) <= 20),
  items jsonb not null default '[]'::jsonb check(jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agenda_notebooks_owner on public.agenda_notebooks(owner_id, updated_at desc);
alter table public.agenda_notebooks enable row level security;
create policy own_agenda_notebooks on public.agenda_notebooks for all to authenticated
  using(owner_id = auth.uid()) with check(owner_id = auth.uid());
grant select, insert, update, delete on public.agenda_notebooks to authenticated;
commit;
