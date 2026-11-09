-- Nexo: tarjetas vinculadas entre columnas (un lazo entre dos tarjetas de un tablero).
-- Cada vínculo se guarda una vez, con el id menor en «a». Se puede ejecutar más de una vez.
begin;

create table if not exists public.board_card_links (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  a uuid not null references public.board_cards on delete cascade,
  b uuid not null references public.board_cards on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists board_card_links_b on public.board_card_links(b);
create index if not exists board_card_links_owner on public.board_card_links(owner_id);

alter table public.board_card_links enable row level security;
drop policy if exists personal on public.board_card_links;
-- Solo tus vínculos, y solo entre tarjetas tuyas.
create policy personal on public.board_card_links for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.board_cards c
      where c.id = board_card_links.a and c.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.board_cards c
      where c.id = board_card_links.b and c.owner_id = auth.uid()
    )
  );
grant select, insert, update, delete on public.board_card_links to authenticated;

commit;
