begin;
create table public.readings (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users on delete cascade,
 url text not null, title text not null, content text not null, folder text not null default '', archived boolean not null default false,
 created_at timestamptz not null default now(), unique(owner_id,url), unique(owner_id,id)
);
create table public.reading_marks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), reading_id uuid not null,
 start_offset integer not null check(start_offset>=0), end_offset integer not null check(end_offset>start_offset), note text not null default '',
 foreign key(owner_id,reading_id) references public.readings(owner_id,id) on delete cascade
);
alter table public.readings enable row level security;
alter table public.reading_marks enable row level security;
create policy own_readings on public.readings for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy own_marks on public.reading_marks for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,update,delete on public.readings, public.reading_marks to authenticated;
commit;