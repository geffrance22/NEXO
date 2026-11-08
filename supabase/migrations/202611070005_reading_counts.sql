create or replace function public.reading_filters() returns jsonb
language sql stable security invoker set search_path=public as $$
with library as materialized (select id,folder,tags,archived,favorite from readings),
folders as (select folder,count(*) n from library where folder<>'' group by folder),
labels as (select tag,count(distinct id) n from library cross join lateral unnest(tags) t(tag) group by tag)
select jsonb_build_object(
 'folders',array(select folder from folders order by folder),
 'tags',array(select tag from labels order by tag),
 'counts', jsonb_build_object(
  'inbox',count(*) filter(where not archived),'archive',count(*) filter(where archived),
  'favorites',count(*) filter(where favorite),'marks',(select count(distinct reading_id) from reading_marks))
  || coalesce((select jsonb_object_agg('f:'||folder,n) from folders),'{}'::jsonb)
  || coalesce((select jsonb_object_agg('t:'||tag,n) from labels),'{}'::jsonb)
) from library
$$;