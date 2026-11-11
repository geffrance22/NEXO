-- Nexo: Tableros, fase 1. Requiere las migraciones de tableros anteriores (014, 016, 202611090002).
-- · Tableros archivados con su cierre (fechas, cuántas tarjetas, qué salió bien, qué harías distinto).
-- · Tarjetas con fecha de inicio (línea de tiempo) y registro de veces cumplidas (rutinas).
-- · updated_at en columnas y tarjetas: sincronización incremental (y base para modo sin conexión).
-- · board_activity alimentado por triggers: historial, pospuestas, métricas y auditoría.
-- · Realtime en board_cards y board_lists.
-- Se puede ejecutar más de una vez.
begin;

-- ───────── Tableros: archivar con cierre ─────────
alter table public.boards
  add column if not exists archived_at timestamptz,
  add column if not exists closing jsonb not null default '{}'::jsonb;

-- ───────── Tarjetas: inicio, rutinas y última modificación ─────────
alter table public.board_cards
  add column if not exists starts date,
  add column if not exists completions jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();
alter table public.board_lists
  add column if not exists updated_at timestamptz not null default now();

alter table public.board_cards drop constraint if exists board_cards_completions_check;
alter table public.board_cards add constraint board_cards_completions_check
  check (jsonb_typeof(completions) = 'array');

-- updated_at cambia con cualquier cambio (también al reordenar): es lo que mira la sincronización.
create or replace function public.board_set_updated() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists set_updated_card on public.board_cards;
create trigger set_updated_card before update on public.board_cards
  for each row execute function public.board_set_updated();
drop trigger if exists set_updated_list on public.board_lists;
create trigger set_updated_list before update on public.board_lists
  for each row execute function public.board_set_updated();

create index if not exists board_cards_updated on public.board_cards(owner_id, updated_at);

-- La vista se rehace para incluir las columnas nuevas y si el tablero está archivado.
drop view if exists public.planner_board_cards;
create view public.planner_board_cards with (security_invoker = true) as
  select c.*, l.board_id, l.name as list_name, b.name as board_name,
         b.is_template as board_is_template, b.settings as board_settings,
         b.archived_at as board_archived_at
  from public.board_cards c
  join public.board_lists l on l.id = c.list_id
  join public.boards b on b.id = l.board_id;
grant select on public.planner_board_cards to authenticated;

-- ───────── Registro de actividad ─────────
create table if not exists public.board_activity (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users on delete cascade,
  -- Sin claves foráneas: el historial sobrevive a lo que se borra.
  board_id uuid,
  list_id uuid,
  card_id uuid,
  -- create, update, move, done, undone, archive, unarchive, postpone, snooze, delete
  action text not null,
  -- Campo → [antes, después] (solo lo que cambió; los textos largos, recortados).
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists board_activity_card on public.board_activity(card_id, created_at desc);
create index if not exists board_activity_board on public.board_activity(board_id, created_at desc);
create index if not exists board_activity_owner on public.board_activity(owner_id, created_at desc);

alter table public.board_activity enable row level security;
drop policy if exists personal_read on public.board_activity;
create policy personal_read on public.board_activity for select to authenticated
  using (owner_id = auth.uid());
-- Solo los triggers escriben (security definer); desde la app solo se lee.
grant select on public.board_activity to authenticated;

create or replace function public.board_card_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  diff jsonb;
  act text;
  board uuid;
  row_new jsonb;
  row_old jsonb;
begin
  if tg_op = 'INSERT' then
    select board_id into board from board_lists where id = new.list_id;
    insert into board_activity(owner_id, board_id, list_id, card_id, action, changes)
    values (new.owner_id, board, new.list_id, new.id, 'create',
            jsonb_build_object('title', jsonb_build_array(null, left(new.title, 200))));
    return new;
  end if;

  if tg_op = 'DELETE' then
    select board_id into board from board_lists where id = old.list_id;
    insert into board_activity(owner_id, board_id, list_id, card_id, action, changes)
    values (old.owner_id, board, old.list_id, old.id, 'delete',
            jsonb_build_object('title', jsonb_build_array(left(old.title, 200), null)));
    return old;
  end if;

  row_old := to_jsonb(old) - 'rank' - 'touched_at' - 'list_since' - 'updated_at';
  row_new := to_jsonb(new) - 'rank' - 'touched_at' - 'list_since' - 'updated_at';
  -- Reordenar dentro de la columna no es actividad.
  if row_old = row_new then
    return new;
  end if;

  select coalesce(jsonb_object_agg(
           n.key,
           jsonb_build_array(
             case when jsonb_typeof(o.value) = 'string' then to_jsonb(left(o.value #>> '{}', 300)) else o.value end,
             case when jsonb_typeof(n.value) = 'string' then to_jsonb(left(n.value #>> '{}', 300)) else n.value end
           )), '{}'::jsonb)
    into diff
    from jsonb_each(row_new) n
    join jsonb_each(row_old) o using (key)
   where n.value is distinct from o.value
     -- El registro de rutinas ya es su propio historial.
     and n.key <> 'completions';

  act := case
    when old.archived_at is null and new.archived_at is not null then 'archive'
    when old.archived_at is not null and new.archived_at is null then 'unarchive'
    when not coalesce(old.done, false) and coalesce(new.done, false) then 'done'
    when coalesce(old.done, false) and not coalesce(new.done, false) then 'undone'
    when jsonb_array_length(new.completions) > jsonb_array_length(old.completions) then 'done'
    when new.list_id is distinct from old.list_id then 'move'
    when old.due is not null and new.due is not null and new.due > old.due then 'postpone'
    when new.snoozed_until is not null and new.snoozed_until is distinct from old.snoozed_until then 'snooze'
    else 'update'
  end;
  if diff = '{}'::jsonb and act = 'update' then
    return new;
  end if;

  select board_id into board from board_lists where id = new.list_id;
  insert into board_activity(owner_id, board_id, list_id, card_id, action, changes)
  values (new.owner_id, board, new.list_id, new.id, act, diff);
  return new;
end $$;
revoke all on function public.board_card_log() from public;

drop trigger if exists log_card on public.board_cards;
create trigger log_card after insert or update or delete on public.board_cards
  for each row execute function public.board_card_log();

-- ───────── Realtime ─────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_cards') then
      execute 'alter publication supabase_realtime add table public.board_cards';
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_lists') then
      execute 'alter publication supabase_realtime add table public.board_lists';
    end if;
  end if;
end $$;

commit;
