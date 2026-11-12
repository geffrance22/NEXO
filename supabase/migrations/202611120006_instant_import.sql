-- Nexo: lo que publicas en MASTODON llega a Instantes. La función `fediverse` lee tus posts
-- públicos desde el último que ya revisó y los guarda como instantes.
-- · instant_shares.origin: 'nexo' (lo publicó Nexo) o 'mastodon' (nació allí y se trajo).
-- · instant_shares.remote_edited_at: cuándo se editó por última vez el post, para traer solo los
--   cambios hechos en Mastodon y no los que Nexo mismo acaba de enviar.
-- · fediverse_sync: dónde va la lectura (since_id) y cuándo corrió por última vez (evita que dos
--   pestañas lean a la vez).
-- Requiere 202611120005_instant_shares.sql. Se puede ejecutar más de una vez.
begin;

alter table public.instant_shares
  add column if not exists origin text not null default 'nexo'
    check (origin in ('nexo', 'mastodon')),
  add column if not exists remote_edited_at timestamptz;

create table if not exists public.fediverse_sync (
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  account_id text not null,
  since_id text not null,
  checked_at timestamptz not null default now()
);

alter table public.fediverse_sync enable row level security;
drop policy if exists own_fediverse_sync on public.fediverse_sync;
create policy own_fediverse_sync on public.fediverse_sync for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.fediverse_sync from anon;
grant select, insert, update, delete on public.fediverse_sync to authenticated;

commit;
