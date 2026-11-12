-- Nexo: INSTANTES. Lo que escribes en «¿Qué pasó?» se conserva tal cual, como publicaciones
-- breves que pueden formar un hilo. Nexo sigue proponiendo sus piezas (encuentro, gasto,
-- pendiente, novedad…), pero esas fichas ya no copian el texto: quedan vinculadas al instante.
-- · thread_id: el primero del hilo (él mismo si es el primero); pos: su lugar en el hilo.
-- · entry_ids, episode_ids, person_ids, place_ids: lo que nació de él o lo que le vinculaste.
-- · fts: búsqueda en español (la usa el asistente).
-- Se puede ejecutar más de una vez.
begin;

create table if not exists public.instants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  thread_id uuid not null,
  pos smallint not null default 0 check (pos between 0 and 200),
  body text not null default '' check (char_length(body) <= 8000),
  images jsonb not null default '[]'
    check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 8),
  mood smallint check (mood is null or mood between 1 and 30),
  happened_on date,
  person_ids uuid[] not null default '{}' check (cardinality(person_ids) <= 80),
  entry_ids uuid[] not null default '{}' check (cardinality(entry_ids) <= 300),
  episode_ids uuid[] not null default '{}' check (cardinality(episode_ids) <= 40),
  place_ids uuid[] not null default '{}' check (cardinality(place_ids) <= 40),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('spanish'::regconfig, body)) stored
);

create index if not exists instants_owner on public.instants (owner_id, created_at desc);
create index if not exists instants_thread on public.instants (owner_id, thread_id, pos);
create index if not exists instants_fts on public.instants using gin (fts);
create index if not exists instants_entries on public.instants using gin (entry_ids);
create index if not exists instants_people on public.instants using gin (person_ids);
create index if not exists instants_episodes on public.instants using gin (episode_ids);

alter table public.instants enable row level security;
drop policy if exists own_instants on public.instants;
create policy own_instants on public.instants for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.instants from anon;
grant select, insert, update, delete on public.instants to authenticated;

commit;
