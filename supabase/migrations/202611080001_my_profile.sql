-- Nexo: tu propia ficha («Mi ficha»): tus datos y la lectura que hace la IA de todo lo que hay
-- de ti en Nexo. Una fila por usuario. Se puede ejecutar más de una vez.
begin;

create table if not exists public.my_profile (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  profile jsonb not null default '{}'
    check (jsonb_typeof(profile) = 'object' and length(profile::text) <= 100000),
  reading text not null default '' check (char_length(reading) <= 6000),
  highlights text[] not null default '{}' check (cardinality(highlights) <= 12),
  reading_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.my_profile enable row level security;
drop policy if exists "Own profile" on public.my_profile;
create policy "Own profile" on public.my_profile for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.my_profile from anon;
grant select, insert, update, delete on public.my_profile to authenticated;

commit;
