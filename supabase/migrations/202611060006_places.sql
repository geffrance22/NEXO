-- Nexo: lugares (cafés, casas, viajes…) con fotos e historia. Los recuerdos los enlazan desde
-- `entries.details.placeId`. Se puede ejecutar más de una vez.
begin;

create table if not exists public.places (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (char_length(name) between 1 and 120),
 kind text not null default 'otro',
 city text not null default '',
 address text not null default '',
 story text not null default '',
 images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 24),
 favorite boolean not null default false,
 created_at timestamptz not null default now()
);

alter table public.places enable row level security;
drop policy if exists "Own places" on public.places;
create policy "Own places" on public.places for all to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.places from anon;
grant select, insert, update, delete on public.places to authenticated;
create index if not exists places_owner on public.places(owner_id);

commit;
