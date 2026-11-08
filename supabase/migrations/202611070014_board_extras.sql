-- Nexo: Tableros más completos. Tarjetas completadas y archivadas, color de tarjeta y de columna,
-- fondo del tablero y fecha de creación. Se puede ejecutar más de una vez.
begin;

alter table public.boards add column if not exists background text not null default '';
alter table public.board_lists add column if not exists color text not null default '';
alter table public.board_cards
  add column if not exists done boolean not null default false,
  add column if not exists done_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists color text not null default '',
  add column if not exists created_at timestamptz not null default now();

create index if not exists board_cards_archived
  on public.board_cards(owner_id, archived_at desc) where archived_at is not null;

-- La vista se rehace (c.* se fija al crearla) y trae el tablero y la columna, para Archivados.
drop view if exists public.planner_board_cards;
create view public.planner_board_cards with (security_invoker = true) as
  select c.*, l.board_id, l.name as list_name, b.name as board_name
  from public.board_cards c
  join public.board_lists l on l.id = c.list_id
  join public.boards b on b.id = l.board_id;
grant select on public.planner_board_cards to authenticated;

commit;
