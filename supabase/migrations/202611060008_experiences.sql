-- Nexo: experiencias (episodios) que reúnen recuerdos, personas, lugares, dinero y tareas;
-- fecha de registro separada de la fecha en que pasó cada recuerdo; naturaleza de los vínculos
-- familiares, y descartes sincronizados entre dispositivos. Se puede ejecutar más de una vez.
begin;

-- 1. Episodios: un viaje, una cena, una mudanza, una colaboración…
create table if not exists public.episodes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 title text not null check (char_length(title) between 1 and 120),
 kind text not null default 'otro' check (char_length(kind) between 1 and 30),
 status text not null default 'activo' check (status in ('activo', 'cerrado')),
 starts_on date,
 ends_on date,
 summary text not null default '' check (char_length(summary) <= 4000),
 -- Texto original con el que se capturó (evidencia de dónde salió cada pieza).
 source text not null default '' check (char_length(source) <= 4000),
 person_ids uuid[] not null default '{}',
 place_ids uuid[] not null default '{}',
 budget numeric(16,2) check (budget is null or budget >= 0),
 outcome text not null default '' check (char_length(outcome) <= 4000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists episodes_owner on public.episodes(owner_id, starts_on desc);
create index if not exists episodes_people on public.episodes using gin(person_ids);

alter table public.episodes enable row level security;
drop policy if exists "Own episodes" on public.episodes;
create policy "Own episodes" on public.episodes for all to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.episodes from anon;
grant select, insert, update, delete on public.episodes to authenticated;

create or replace function public.validate_episode_links() returns trigger language plpgsql set search_path=public as $$
begin
 if exists (select 1 from unnest(new.person_ids) p(id)
            where not exists (select 1 from public.people where id = p.id and owner_id = new.owner_id))
  or exists (select 1 from unnest(new.place_ids) l(id)
            where not exists (select 1 from public.places where id = l.id and owner_id = new.owner_id)) then
  raise exception 'A linked person or place does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_episode_links on public.episodes;
create trigger validate_episode_links before insert or update on public.episodes
 for each row execute function public.validate_episode_links();

drop trigger if exists touch_updated_at on public.episodes;
create trigger touch_updated_at before update on public.episodes
 for each row execute function public.touch_updated_at();

-- Al borrar una persona o un lugar sale de sus episodios.
create or replace function public.unlink_person_from_episodes() returns trigger language plpgsql set search_path=public as $$
begin
 update public.episodes set person_ids = array_remove(person_ids, old.id)
 where owner_id = old.owner_id and old.id = any(person_ids);
 return old;
end; $$;
drop trigger if exists unlink_person_from_episodes on public.people;
create trigger unlink_person_from_episodes before delete on public.people
 for each row execute function public.unlink_person_from_episodes();

create or replace function public.unlink_place_from_episodes() returns trigger language plpgsql set search_path=public as $$
begin
 update public.episodes set place_ids = array_remove(place_ids, old.id)
 where owner_id = old.owner_id and old.id = any(place_ids);
 return old;
end; $$;
drop trigger if exists unlink_place_from_episodes on public.places;
create trigger unlink_place_from_episodes before delete on public.places
 for each row execute function public.unlink_place_from_episodes();

-- 2. Recuerdos: a qué episodio pertenecen y cuándo se registraron (created_at es cuándo pasó).
alter table public.entries add column if not exists episode_id uuid references public.episodes(id) on delete set null;
create index if not exists entries_episode on public.entries(episode_id) where episode_id is not null;
alter table public.entries add column if not exists recorded_at timestamptz;
update public.entries set recorded_at = created_at where recorded_at is null;
alter table public.entries alter column recorded_at set default now();
alter table public.entries alter column recorded_at set not null;

create or replace function public.validate_entry_episode() returns trigger language plpgsql set search_path=public as $$
begin
 if new.episode_id is not null
  and not exists (select 1 from public.episodes where id = new.episode_id and owner_id = new.owner_id) then
  raise exception 'The episode does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_entry_episode on public.entries;
create trigger validate_entry_episode before insert or update on public.entries
 for each row execute function public.validate_entry_episode();

-- 3. Naturaleza de un vínculo familiar (biológico, adoptivo, de crianza, político, medio hermano).
do $$ begin
 if to_regclass('public.person_ties') is not null then
  alter table public.person_ties add column if not exists nature text;
  alter table public.person_ties drop constraint if exists person_ties_nature_check;
  alter table public.person_ties add constraint person_ties_nature_check
   check (nature is null or nature in ('biologica', 'adoptiva', 'crianza', 'politica', 'medio'));
 end if;
end $$;

-- 4. Descartes («No es así», sugerencias, tarjetas pospuestas del inicio), iguales en todos tus dispositivos.
create table if not exists public.dismissals (
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 key text not null check (char_length(key) between 1 and 300),
 created_at timestamptz not null default now(),
 primary key (owner_id, key)
);
alter table public.dismissals enable row level security;
drop policy if exists "Own dismissals" on public.dismissals;
create policy "Own dismissals" on public.dismissals for all to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.dismissals from anon;
grant select, insert, delete on public.dismissals to authenticated;

commit;
