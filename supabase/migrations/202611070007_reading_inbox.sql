begin;
create or replace function public.reading_list(scope text,needle text,before_date timestamptz,before_id uuid) returns setof public.reading_cards language sql stable security invoker set search_path=public as $$
 select c.* from public.reading_cards c join public.readings r using(id)
 where (case when scope='inbox' then not c.archived and c.folder='' when scope='archive' then c.archived when scope='favorites' then c.favorite when left(scope,2)='f:' then c.folder=substr(scope,3) when left(scope,2)='t:' then substr(scope,3)=any(c.tags) else false end)
 and (needle='' or (r.title || ' ' || r.url || ' ' || r.content) ilike '%' || needle || '%')
 and (before_date is null or (c.created_at,c.id)<(before_date,before_id))
 order by c.created_at desc,c.id desc limit 32
$$;
create or replace function public.reading_filters() returns jsonb
language sql stable security invoker set search_path=public as $$
with library as materialized (select id,folder,tags,archived,favorite from readings),
folders as (select folder,count(*) n from library where folder<>'' group by folder),
labels as (select tag,count(distinct id) n from library cross join lateral unnest(tags) t(tag) group by tag)
select jsonb_build_object(
 'folders',array(select folder from folders order by folder),
 'tags',array(select tag from labels order by tag),
 'counts', jsonb_build_object(
  'inbox',count(*) filter(where not archived and folder=''),'archive',count(*) filter(where archived),
  'favorites',count(*) filter(where favorite),'marks',(select count(distinct reading_id) from reading_marks))
  || coalesce((select jsonb_object_agg('f:'||folder,n) from folders),'{}'::jsonb)
  || coalesce((select jsonb_object_agg('t:'||tag,n) from labels),'{}'::jsonb)
) from library
$$;
commit;
