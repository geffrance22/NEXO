-- Nexo: progreso de lectura en la lista de Lecturas (cuánto llevas leído de cada artículo).
-- progress: 1–100 si ya empezaste a leerlo; vacío si nunca lo abriste. Se puede ejecutar más de una vez.
begin;

-- La columna nueva va al final (así se puede reemplazar la vista sin borrarla).
create or replace view public.reading_cards with (security_invoker=true) as
 select r.id, r.title, r.url, r.folder, r.tags, r.favorite, r.archived, r.created_at,
        r.excerpt, r.cover, r.minutes,
        (select count(*) from public.reading_marks m where m.reading_id = r.id) as mark_count,
        case
          when r.last_read is null or coalesce(r.resume_at, 0) <= 0 then null
          else least(100, greatest(1, round(100.0 * r.resume_at / greatest(length(r.content), 1))))::int
        end as progress
 from public.readings r;
grant select on public.reading_cards to authenticated;

-- La lista devuelve filas de la vista: se vuelve a crear para que incluya la columna nueva.
create or replace function public.reading_list(scope text,needle text,before_date timestamptz,before_id uuid) returns setof public.reading_cards language sql stable security invoker set search_path=public as $$
 select c.* from public.reading_cards c join public.readings r using(id)
 where (case when scope='inbox' then not c.archived and c.folder='' when scope='archive' then c.archived when scope='favorites' then c.favorite when left(scope,2)='f:' then c.folder=substr(scope,3) when left(scope,2)='t:' then substr(scope,3)=any(c.tags) else false end)
 and (needle='' or (r.title || ' ' || r.url || ' ' || r.content) ilike '%' || needle || '%')
 and (before_date is null or (c.created_at,c.id)<(before_date,before_id))
 order by c.created_at desc,c.id desc limit 32
$$;

commit;
