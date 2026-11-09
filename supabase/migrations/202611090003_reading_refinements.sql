-- Nexo: ajustes de Lecturas.
-- 1. Minutos de lectura por palabras (≈230 por minuto y unos segundos por imagen) y extracto sin la
--    sintaxis de los hipervínculos, que ahora se pueden conservar al guardar un artículo.
-- 2. Colección «Leídos»: lo que marcas como leído sale de «Por leer».
-- 3. Repaso espaciado para las palabras del diccionario.
-- Requiere las migraciones 012 (read_at) y 013 (diccionario). Se puede ejecutar más de una vez.
begin;

-- 1. Portada, extracto y minutos.
create or replace function public.reading_card_fields() returns trigger language plpgsql set search_path=public as $$
declare
 plain text;
 words int;
 images int;
begin
 new.cover=(regexp_match(new.content,'!\[[^]]*\]\((https?://[^ )]+)\)'))[1];
 plain=regexp_replace(new.content,'!\[[^]]*\]\([^)]+\)','','g');
 plain=regexp_replace(plain,'\[([^]]*)\]\((https?://[^ )]+)\)','\1','g');
 new.excerpt=left(regexp_replace(plain,'\s+',' ','g'),240);
 words=(select count(*) from regexp_matches(regexp_replace(plain,'[#>*_`|]+',' ','g'),'\S+','g'));
 images=(select count(*) from regexp_matches(new.content,'!\[[^]]*\]\([^)]+\)','g'));
 new.minutes=greatest(1,ceil(words/230.0 + least(images,12)*10/60.0)::int);
 return new;
end; $$;
update public.readings set content=content;

-- 2. «Por leer» sin lo leído; «Leídos» con todo lo leído que no está archivado.
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

create or replace function public.reading_filters() returns jsonb
language sql stable security invoker set search_path=public as $$
with library as materialized (select id,folder,tags,archived,favorite,read_at from readings),
folders as (select folder,count(*) n from library where folder<>'' group by folder),
labels as (select tag,count(distinct id) n from library cross join lateral unnest(tags) t(tag) group by tag)
select jsonb_build_object(
 'folders',array(select folder from folders order by folder),
 'tags',array(select tag from labels order by tag),
 'counts', jsonb_build_object(
  'inbox',count(*) filter(where not archived and folder='' and read_at is null),
  'read',count(*) filter(where not archived and read_at is not null),
  'archive',count(*) filter(where archived),
  'favorites',count(*) filter(where favorite),'marks',(select count(distinct reading_id) from reading_marks))
  || coalesce((select jsonb_object_agg('f:'||folder,n) from folders),'{}'::jsonb)
  || coalesce((select jsonb_object_agg('t:'||tag,n) from labels),'{}'::jsonb)
) from library
$$;

-- 3. Repaso del diccionario: cuántas veces seguidas la recordaste y cuándo toca de nuevo.
alter table public.reading_words
  add column if not exists review_step integer not null default 0,
  add column if not exists review_due date;
create index if not exists reading_words_review on public.reading_words(owner_id, review_due)
  where learned_at is null and review_step >= 0;

commit;
