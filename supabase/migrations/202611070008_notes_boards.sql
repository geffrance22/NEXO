begin;
create table public.note_books(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,name text not null check(length(trim(name)) between 1 and 120),unique(owner_id,name));
create table public.quick_notes(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,book_id uuid references public.note_books on delete set null,title text not null default '',body text not null default '',color text not null default 'linen',tags text[] not null default '{}',checks jsonb not null default '[]',pinned boolean not null default false, archived boolean not null default false,episode_id uuid references public.episodes on delete set null,created_at timestamptz not null default now());
create table public.boards(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,name text not null check(length(trim(name)) between 1 and 120),created_at timestamptz not null default now());
create table public.board_lists(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,board_id uuid not null references public.boards on delete cascade,name text not null check(length(trim(name)) between 1 and 120),rank float8 not null default 0);
create table public.board_cards(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users on delete cascade,list_id uuid not null references public.board_lists on delete cascade,title text not null check(length(trim(title)) between 1 and 240),body text not null default '',rank float8 not null default 0,tags text[] not null default '{}',checks jsonb not null default '[]',due date, entry_id uuid references public.entries on delete set null,note_id uuid references public.quick_notes on delete set null,episode_id uuid references public.episodes on delete set null,person_id uuid references public.people on delete set null,reading_id uuid references public.readings on delete set null);
create index quick_notes_owner on public.quick_notes(owner_id,created_at desc);
create index board_lists_parent on public.board_lists(board_id,rank);
create index board_cards_parent on public.board_cards(list_id,rank);
do $$ declare t text; begin foreach t in array array['note_books','quick_notes','boards','board_lists','board_cards'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy personal on public.%I for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid())',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
end loop; end $$;
create function public.verify_planner_links() returns trigger language plpgsql set search_path=public as $$
declare field text; tbl text; ref uuid; ok boolean;
begin
 for field,tbl in select * from (values ('book_id','note_books'),('board_id','boards'),('list_id','board_lists'),('note_id','quick_notes'),('entry_id','entries'),('episode_id','episodes'),('person_id','people'),('reading_id','readings')) v(f,t) loop
 ref=(to_jsonb(new)->>field)::uuid;
 if ref is not null then execute format('select exists(select 1 from public.%I where id=$1 and owner_id=$2 %s)',tbl,case when tbl='entries' then 'and kind=''Pendiente''' else '' end) into ok using ref,new.owner_id;
 if not ok then raise exception 'Vínculo no disponible';end if;end if;
 end loop;return new;
end $$;
create trigger validate_note before insert or update on public.quick_notes for each row execute function public.verify_planner_links();
create trigger validate_list before insert or update on public.board_lists for each row execute function public.verify_planner_links();
create trigger validate_card before insert or update on public.board_cards for each row execute function public.verify_planner_links();
create function public.create_planner_board(board_name text) returns uuid language plpgsql security invoker set search_path=public as $$
declare b uuid;begin insert into boards(name) values(trim(board_name)) returning id into b;
insert into board_lists(board_id,name,rank) values(b,'Por hacer',1),(b,'En curso',2),(b,'Hecho',3);return b;end $$;
create view public.planner_board_cards with(security_invoker=true) as select c.*, l.board_id from public.board_cards c join public.board_lists l on l.id=c.list_id;
grant select on public.planner_board_cards to authenticated;
commit;