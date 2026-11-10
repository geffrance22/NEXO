-- Nexo: Lecturas abiertas y newsletters por RSS.
-- 1. opened_at: la primera vez que abriste un artículo. En la lista, lo que nunca abriste va en
--    negrita y lo ya abierto se atenúa un poco. Lo que ya empezaste o terminaste cuenta como abierto.
-- 2. reading_feeds: tus feeds RSS o Atom. Sus artículos nuevos entran solos a «Por leer».
-- Requiere las migraciones 012 (read_at) y 202611090003. Se puede ejecutar más de una vez.
begin;

-- 1. Abiertos.
alter table public.readings add column if not exists opened_at timestamptz;
update public.readings set opened_at = coalesce(last_read, read_at)
 where opened_at is null and (last_read is not null or read_at is not null);

-- La columna nueva va al final para poder reemplazar la vista.
create or replace view public.reading_cards with (security_invoker=true) as
 select r.id, r.title, r.url, r.folder, r.tags, r.favorite, r.archived, r.created_at,
        r.excerpt, r.cover, r.minutes,
        (select count(*) from public.reading_marks m where m.reading_id = r.id) as mark_count,
        case
          when r.read_at is not null then 100
          when r.last_read is null or coalesce(r.resume_at, 0) <= 0 then null
          else least(100, greatest(1, round(100.0 * r.resume_at / greatest(length(r.content), 1))))::int
        end as progress,
        r.pinned_at, r.read_at, r.opened_at
 from public.readings r;
grant select on public.reading_cards to authenticated;

-- La lista devuelve filas de la vista: se vuelve a crear para que incluya la columna nueva.
create or replace function public.reading_list(scope text,needle text,before_date timestamptz,before_id uuid) returns setof public.reading_cards language sql stable security invoker set search_path=public as $$
 select c.* from public.reading_cards c join public.readings r using(id)
 where (case when scope='inbox' then not c.archived and c.folder='' and c.read_at is null when scope='read' then not c.archived and c.read_at is not null when scope='archive' then c.archived when scope='favorites' then c.favorite when left(scope,2)='f:' then c.folder=substr(scope,3) when left(scope,2)='t:' then substr(scope,3)=any(c.tags) else false end)
 and (needle='' or (r.title || ' ' || r.url || ' ' || r.content) ilike '%' || needle || '%')
 and (before_date is null or (c.created_at,c.id)<(before_date,before_id))
 order by c.created_at desc,c.id desc limit 32
$$;

create or replace function public.reading_pinned(scope text,needle text) returns setof public.reading_cards language sql stable security invoker set search_path=public as $$
 select c.* from public.reading_cards c join public.readings r using(id)
 where c.pinned_at is not null
 and (case when scope='inbox' then not c.archived and c.folder='' and c.read_at is null when scope='read' then not c.archived and c.read_at is not null when scope='archive' then c.archived when scope='favorites' then c.favorite when left(scope,2)='f:' then c.folder=substr(scope,3) when left(scope,2)='t:' then substr(scope,3)=any(c.tags) else false end)
 and (needle='' or (r.title || ' ' || r.url || ' ' || r.content) ilike '%' || needle || '%')
 order by c.pinned_at desc limit 100
$$;
grant execute on function public.reading_pinned(text,text) to authenticated;

-- 2. Feeds RSS. last_item_at: fecha del artículo más reciente que ya entró (lo anterior no se
--    vuelve a traer aunque lo borres). checked_at: la última vez que se revisó.
create table if not exists public.reading_feeds (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users on delete cascade,
 url text not null check (url ~ '^https?://' and length(url) <= 2000),
 title text not null default '' check (length(title) <= 300),
 site text not null default '' check (length(site) <= 2000),
 last_item_at timestamptz,
 checked_at timestamptz,
 created_at timestamptz not null default now(),
 unique(owner_id, url)
);
alter table public.reading_feeds enable row level security;
drop policy if exists own_reading_feeds on public.reading_feeds;
create policy own_reading_feeds on public.reading_feeds for all to authenticated
 using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.reading_feeds to authenticated;

commit;
