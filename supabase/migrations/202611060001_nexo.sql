-- Nexo: run once in Supabase SQL Editor. No service key is required by the browser.
begin;
create table if not exists public.people (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (char_length(name) between 1 and 120),
 role text not null default '', interests text not null default '', bio text not null default '',
 color text not null default '#dce8ce', created_at timestamptz not null default now()
);
create table if not exists public.entries (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 title text not null check (char_length(title) between 1 and 180), body text not null default '',
 kind text not null default 'Nota' check (kind in ('Nota','Encuentro','Película','Libro','Trabajo','Aprendizaje','Movimiento','Pendiente')),
 tags text[] not null default '{}', person_ids uuid[] not null default '{}',
 amount numeric(16,2) not null default 0 check (amount >= 0),
 direction text not null default 'egreso' check (direction in ('ingreso','egreso')),
 status text not null default 'pendiente' check (status in ('pendiente','completado')),
 file_path text, created_at timestamptz not null default now(),
 check (file_path is null or file_path like owner_id::text || '/%')
);
alter table public.people enable row level security;
alter table public.entries enable row level security;
drop policy if exists "Own people" on public.people;
create policy "Own people" on public.people for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Own entries" on public.entries;
create policy "Own entries" on public.entries for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
revoke all on public.people,public.entries from anon;
grant select,insert,update,delete on public.people,public.entries to authenticated;
create index if not exists people_owner on public.people(owner_id);
create index if not exists entries_owner_date on public.entries(owner_id,created_at desc);
create index if not exists entries_people on public.entries using gin(person_ids);
create index if not exists entries_search on public.entries using gin(to_tsvector('spanish', title || ' ' || body));
-- Validate linked profiles under the same owner. Arrays keep the first version simple.
create or replace function public.validate_entry_people() returns trigger language plpgsql set search_path=public as $$
begin
 if exists (select 1 from unnest(new.person_ids) p(id) where not exists (select 1 from public.people where id=p.id and owner_id=new.owner_id)) then
 raise exception 'A linked person does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_entry_people on public.entries;
create trigger validate_entry_people before insert or update on public.entries for each row execute function public.validate_entry_people();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('attachments','attachments',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain']) on conflict(id) do nothing;
drop policy if exists "Own attachments read" on storage.objects;
create policy "Own attachments read" on storage.objects for select to authenticated using (bucket_id='attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Own attachments upload" on storage.objects;
create policy "Own attachments upload" on storage.objects for insert to authenticated with check (bucket_id='attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Own attachments delete" on storage.objects;
create policy "Own attachments delete" on storage.objects for delete to authenticated using (bucket_id='attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Persist an atomic per-user daily limit for assistant requests.
create table if not exists public.assistant_usage(owner_id uuid not null references auth.users(id) on delete cascade,day date not null default current_date,calls integer not null default 0, primary key(owner_id,day));
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon,authenticated;
create or replace function public.consume_assistant_quota() returns boolean language plpgsql security definer set search_path=public as $$
declare consumed integer;
begin
 if auth.uid() is null then return false; end if;
 insert into public.assistant_usage(owner_id,day,calls) values(auth.uid(),current_date,1)
 on conflict(owner_id,day) do update set calls=assistant_usage.calls+1 where assistant_usage.calls<30
 returning calls into consumed;
 return consumed is not null;
end; $$;
revoke all on function public.consume_assistant_quota() from public;
grant execute on function public.consume_assistant_quota() to authenticated;

-- Stored generated column for PostgREST full-text retrieval.
alter table public.entries add column if not exists fts tsvector generated always as (to_tsvector('spanish',title || ' ' || body)) stored;
create index if not exists entries_fts on public.entries using gin(fts);
commit;
