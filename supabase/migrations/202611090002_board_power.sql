-- Nexo: Tableros con prioridad, tarjetas resaltadas, posponer, reglas por columna, tarjetas que
-- envejecen y ajustes por tablero (saludo de Mi espacio). Requiere las migraciones 014 a 016.
-- Se puede ejecutar más de una vez.
begin;

-- Tarjetas: prioridad, resaltada, pospuesta hasta una fecha y cuándo cambió por última vez.
alter table public.board_cards
  add column if not exists priority text not null default '',
  add column if not exists highlight boolean not null default false,
  add column if not exists snoozed_until date,
  add column if not exists touched_at timestamptz not null default now(),
  add column if not exists list_since timestamptz not null default now();
alter table public.board_cards drop constraint if exists board_cards_priority_check;
alter table public.board_cards add constraint board_cards_priority_check
  check (priority in ('', 'baja', 'media', 'alta'));

-- touched_at: el último cambio real (reordenar no cuenta). list_since: desde cuándo está en su columna.
create or replace function public.board_card_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.list_id is distinct from old.list_id then
    new.list_since = now();
  end if;
  if (to_jsonb(new) - 'rank' - 'touched_at' - 'list_since')
     is distinct from (to_jsonb(old) - 'rank' - 'touched_at' - 'list_since') then
    new.touched_at = now();
  end if;
  return new;
end $$;
drop trigger if exists touch_card on public.board_cards;
create trigger touch_card before update on public.board_cards
  for each row execute function public.board_card_touch();

-- Columnas: reglas y comportamiento (límite, orden automático, archivar solas).
alter table public.board_lists add column if not exists rules jsonb not null default '{}'::jsonb;

-- Tableros: ajustes (saludo de Mi espacio, envejecimiento de tarjetas).
alter table public.boards add column if not exists settings jsonb not null default '{}'::jsonb;

-- La vista se rehace para incluir las columnas nuevas (c.* se fija al crearla).
drop view if exists public.planner_board_cards;
create view public.planner_board_cards with (security_invoker = true) as
  select c.*, l.board_id, l.name as list_name, b.name as board_name,
         b.is_template as board_is_template, b.settings as board_settings
  from public.board_cards c
  join public.board_lists l on l.id = c.list_id
  join public.boards b on b.id = l.board_id;
grant select on public.planner_board_cards to authenticated;

create index if not exists board_cards_due
  on public.board_cards(owner_id, due) where due is not null and archived_at is null;

commit;
