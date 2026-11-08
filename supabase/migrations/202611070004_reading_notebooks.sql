begin;
alter table public.readings add column favorite boolean not null default false, add column resume_at integer not null default 0, add column last_read timestamptz, add column question text not null default '', add column excerpt text, add column cover text, add column minutes integer;
create function public.reading_card_fields() returns trigger language plpgsql set search_path=public as $$
begin
 new.cover=(regexp_match(new.content,'!\[[^]]*\]\((https?://[^ )]+)\)'))[1];
 new.excerpt=left(regexp_replace(regexp_replace(new.content,'!\[[^]]*\]\([^)]+\)','','g'),'\s+',' ','g'),240);
 new.minutes=greatest(1,ceil(length(new.content)/1200.0)::int);
 return new;
end; $$;
create trigger reading_card_fields before insert or update of content on public.readings for each row execute function public.reading_card_fields();
update public.readings set content=content;
create index readings_list on public.readings(owner_id,created_at desc,id desc);
create index readings_favorites on public.readings(owner_id,created_at desc) where favorite;
alter table public.reading_marks add column quote text, add column edited_at timestamptz not null default now();
create index reading_marks_article on public.reading_marks(reading_id);
-- Existing offsets use UTF-16 code units. Astral characters count twice.
create function public.reading_slice(s text,a int,b int) returns text language sql immutable strict as $$
 select coalesce(string_agg(ch,'' order by n),'') from
 (select ch,n,sum(case when ascii(ch)>65535 then 2 else 1 end) over(order by n) as upto
 from regexp_split_to_table(s,'') with ordinality as c(ch,n)) t where upto>a and upto<=b
$$;
update public.reading_marks m set quote=public.reading_slice(r.content,m.start_offset,m.end_offset) from public.readings r where r.id=m.reading_id;
create view public.reading_cards with(security_invoker=true) as select r.id,r.title,r.url,r.folder,r.tags,r.favorite,r.archived,r.created_at,r.excerpt,r.cover,r.minutes,(select count(*) from public.reading_marks m where m.reading_id=r.id) as mark_count from public.readings r;
grant select on public.reading_cards to authenticated;
create function public.reading_filters() returns jsonb language sql stable security invoker set search_path=public as $$select jsonb_build_object('folders',array(select distinct folder from readings where folder<>'' order by folder),'tags',array(select distinct unnest(tags) as t from readings order by t))$$;
create table public.reading_books(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,name text not null check(length(trim(name)) between 1 and 100), unique(owner_id,id));
create table public.reading_book_articles(owner_id uuid not null default auth.uid(), book_id uuid not null,reading_id uuid not null,primary key(book_id,reading_id),foreign key(owner_id,book_id) references public.reading_books(owner_id,id) on delete cascade,foreign key(owner_id,reading_id) references public.readings(owner_id,id) on delete cascade);
create table public.reading_book_notes(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid(),book_id uuid not null,kind text not null check(kind in ('nota','pregunta')),body text not null check(length(trim(body)) between 1 and 8000),created_at timestamptz not null default now(),foreign key(owner_id,book_id) references public.reading_books(owner_id,id) on delete cascade);
alter table public.reading_books enable row level security;
alter table public.reading_book_articles enable row level security;
alter table public.reading_book_notes enable row level security;
create policy own_books on public.reading_books for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy own_members on public.reading_book_articles for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy own_notes on public.reading_book_notes for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,update,delete on public.reading_books,public.reading_book_articles,public.reading_book_notes to authenticated;
create extension if not exists pg_trgm;
create index readings_search_trgm on public.readings using gin ((title || ' ' || url || ' ' || content) gin_trgm_ops);
create function public.reading_list(scope text,needle text,before_date timestamptz,before_id uuid) returns setof public.reading_cards language sql stable security invoker set search_path=public as $$
 select c.* from public.reading_cards c join public.readings r using(id)
 where (case when scope='inbox' then not c.archived when scope='archive' then c.archived when scope='favorites' then c.favorite when left(scope,2)='f:' then c.folder=substr(scope,3) when left(scope,2)='t:' then substr(scope,3)=any(c.tags) else false end)
 and (needle='' or (r.title || ' ' || r.url || ' ' || r.content) ilike '%' || needle || '%')
 and (before_date is null or (c.created_at,c.id)<(before_date,before_id))
 order by c.created_at desc,c.id desc limit 32
$$;
create view public.reading_annotations with (security_invoker=true) as select m.id,m.reading_id,m.quote,m.note,m.edited_at,r.title from reading_marks m join readings r on r.id=m.reading_id;
grant select on public.reading_annotations to authenticated;
create function public.reading_notebook_context(book uuid) returns jsonb language sql stable security invoker set search_path=public as $$
 with sources as (select r.id,r.title,r.content,count(*) over() as n from readings r join reading_book_articles a on a.reading_id=r.id where a.book_id=book),
 notes as (select kind,body,created_at,count(*) over() as n from reading_book_notes where book_id=book),
 marks as (select s.title,m.quote,m.note,count(*) over() as n from reading_marks m join sources s on s.id=m.reading_id)
 select jsonb_build_object('cuaderno',name,'artículos',(select jsonb_agg(jsonb_build_object('título',title,'inicio',left(content,(10000/n)::int),'medio',substring(content from greatest(1,length(content)/2) for (4000/n)::int),'final',right(content,(4000/n)::int))) from sources),
 'notas_y_preguntas',(select jsonb_agg(jsonb_build_object('tipo',kind,'texto',left(body,(8000/n)::int)) order by created_at) from notes),
 'resaltados',(select jsonb_agg(jsonb_build_object('fuente',title,'cita',left(quote,(5000/n)::int),'nota',left(note,(5000/n)::int))) from marks))
 from reading_books where id=book
$$;
commit;