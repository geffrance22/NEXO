-- Nexo: tarjetas que se repiten («cada lunes») y plantillas de tablero.
-- repeat: '' (no se repite), daily, weekdays, weekly, biweekly, monthly o yearly.
-- is_template: el tablero es una plantilla tuya (se edita como un tablero, no sale en la lista).
-- Se puede ejecutar más de una vez.
begin;

alter table public.board_cards add column if not exists repeat text not null default '';
alter table public.board_cards drop constraint if exists board_cards_repeat_check;
alter table public.board_cards add constraint board_cards_repeat_check
  check (repeat in ('', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'));

alter table public.boards
  add column if not exists is_template boolean not null default false,
  add column if not exists description text not null default '' check (length(description) <= 2000);

-- La vista se rehace para incluir las columnas nuevas (c.* se fija al crearla).
drop view if exists public.planner_board_cards;
create view public.planner_board_cards with (security_invoker = true) as
  select c.*, l.board_id, l.name as list_name, b.name as board_name,
         b.is_template as board_is_template
  from public.board_cards c
  join public.board_lists l on l.id = c.list_id
  join public.boards b on b.id = l.board_id;
grant select on public.planner_board_cards to authenticated;

commit;
