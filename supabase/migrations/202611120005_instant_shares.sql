-- Nexo: INSTANTES en el FEDIVERSO. Un instante puede publicarse (en público) en tu cuenta de
-- Mastodon u otro servidor compatible. La función `fediverse` publica con un token guardado en
-- los secretos de Supabase; aquí solo queda a qué publicación remota corresponde cada instante.
-- · remote_ids: las publicaciones creadas en el servidor (un texto largo se parte en un hilo).
-- · remote_url: la primera, para abrirla.
-- · status: 'posted' (publicado) o 'error' (no se pudo; `note` dice por qué). Sin fila: no se compartió.
-- Requiere 202611120003_instants.sql. Se puede ejecutar más de una vez.
begin;

create table if not exists public.instant_shares (
  instant_id uuid primary key references public.instants(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  status text not null default 'posted' check (status in ('posted', 'error')),
  remote_ids text[] not null default '{}' check (cardinality(remote_ids) <= 40),
  remote_url text check (remote_url is null or char_length(remote_url) <= 2000),
  note text not null default '' check (char_length(note) <= 500),
  shared_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists instant_shares_owner on public.instant_shares (owner_id);

alter table public.instant_shares enable row level security;
drop policy if exists own_instant_shares on public.instant_shares;
create policy own_instant_shares on public.instant_shares for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.instants i where i.id = instant_id)
  );
revoke all on public.instant_shares from anon;
grant select, insert, update, delete on public.instant_shares to authenticated;

commit;
