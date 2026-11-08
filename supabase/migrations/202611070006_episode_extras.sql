-- Nexo: bitácora de cada episodio, episodios relacionados entre sí y fotos propias del episodio.
-- Requiere la migración 202611060008_experiences.sql. Se puede ejecutar más de una vez.
begin;

alter table public.episodes add column if not exists updates jsonb not null default '[]'::jsonb;
alter table public.episodes add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.episodes add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.episodes drop constraint if exists episodes_extras_shape;
alter table public.episodes add constraint episodes_extras_shape check (
 jsonb_typeof(updates) = 'array' and jsonb_array_length(updates) <= 500
 and jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 100
 and jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 200
 and pg_column_size(updates) <= 400000
);

-- Un episodio solo puede enlazar episodios de la misma cuenta (y no a sí mismo).
create or replace function public.validate_episode_relations() returns trigger language plpgsql set search_path=public as $$
begin
 if exists (
  select 1 from jsonb_array_elements(new.links) l
  where l->>'id' is null
   or l->>'id' = new.id::text
   or coalesce(l->>'kind', '') not in ('relacionado', 'derivo', 'continua', 'parte')
   or not exists (select 1 from public.episodes e where e.id::text = l->>'id' and e.owner_id = new.owner_id)
 ) then
  raise exception 'A linked episode is invalid or does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_episode_relations on public.episodes;
create trigger validate_episode_relations before insert or update of links on public.episodes
 for each row execute function public.validate_episode_relations();

-- Al borrar un episodio desaparece de los vínculos de los demás.
create or replace function public.unlink_episode_relations() returns trigger language plpgsql set search_path=public as $$
begin
 update public.episodes
 set links = coalesce((select jsonb_agg(l) from jsonb_array_elements(links) l where l->>'id' <> old.id::text), '[]'::jsonb)
 where owner_id = old.owner_id and links @> jsonb_build_array(jsonb_build_object('id', old.id::text));
 return old;
end; $$;
drop trigger if exists unlink_episode_relations on public.episodes;
create trigger unlink_episode_relations after delete on public.episodes
 for each row execute function public.unlink_episode_relations();

commit;
