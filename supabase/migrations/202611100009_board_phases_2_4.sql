-- Nexo: Tableros, fases 2 a 4. Requiere 202611090004_card_links.sql y 202611100008_board_views_sync.sql.
-- · Vínculos con tipo: «bloquea» (con quién bloquea y hasta cuándo) o simplemente relacionadas.
-- · Recordatorios de tarjeta (remind_at) que avisa el servidor (board-sweep) o la app.
-- · board_rule_runs: qué regla ya se aplicó a qué tarjeta (la app y el servidor la comparten).
-- · board_inbox: avisos que deja el servidor (recordatorios, reglas automáticas).
-- · board_card_templates: plantillas de tarjeta tuyas (se invocan con /nombre).
-- · board_shares + shared_board(): enlace de solo lectura para un cliente.
-- · Un solo origen para tarjeta y pendiente: la base mantiene ambos iguales.
-- Se puede ejecutar más de una vez.
begin;

-- ───────── Vínculos con tipo ─────────
alter table public.board_card_links
  add column if not exists kind text not null default 'rel',
  add column if not exists blocker uuid,
  add column if not exists cond text not null default 'done',
  add column if not exists note text not null default '';
alter table public.board_card_links drop constraint if exists board_card_links_kind_check;
alter table public.board_card_links add constraint board_card_links_kind_check
  check (
    (kind = 'rel' and blocker is null)
    or (kind = 'blocks' and blocker is not null and (blocker = a or blocker = b))
  );
-- done: hasta que la que bloquea se complete · list:<id>: hasta que llegue a esa columna.
alter table public.board_card_links drop constraint if exists board_card_links_cond_check;
alter table public.board_card_links add constraint board_card_links_cond_check
  check (cond ~ '^(done|list:[0-9a-f-]{36})$');
alter table public.board_card_links drop constraint if exists board_card_links_note_check;
alter table public.board_card_links add constraint board_card_links_note_check
  check (char_length(note) <= 300);

-- ───────── Recordatorios de tarjeta ─────────
alter table public.board_cards
  add column if not exists remind_at timestamptz,
  add column if not exists reminded_at timestamptz;
create index if not exists board_cards_remind on public.board_cards(remind_at)
  where remind_at is not null and reminded_at is null;

-- Avisar un recordatorio no es un cambio de la tarjeta (ni la «toca» ni va al historial).
create or replace function public.board_card_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.list_id is distinct from old.list_id then
    new.list_since = now();
  end if;
  if (to_jsonb(new) - 'rank' - 'touched_at' - 'list_since' - 'updated_at' - 'reminded_at')
     is distinct from (to_jsonb(old) - 'rank' - 'touched_at' - 'list_since' - 'updated_at' - 'reminded_at') then
    new.touched_at = now();
  end if;
  return new;
end $$;

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

  row_old := to_jsonb(old) - 'rank' - 'touched_at' - 'list_since' - 'updated_at' - 'reminded_at';
  row_new := to_jsonb(new) - 'rank' - 'touched_at' - 'list_since' - 'updated_at' - 'reminded_at';
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

-- La vista se rehace para incluir remind_at y reminded_at (c.* se fija al crearla).
drop view if exists public.planner_board_cards;
create view public.planner_board_cards with (security_invoker = true) as
  select c.*, l.board_id, l.name as list_name, b.name as board_name,
         b.is_template as board_is_template, b.settings as board_settings,
         b.archived_at as board_archived_at
  from public.board_cards c
  join public.board_lists l on l.id = c.list_id
  join public.boards b on b.id = l.board_id;
grant select on public.planner_board_cards to authenticated;

-- ───────── Reglas ya aplicadas ─────────
create table if not exists public.board_rule_runs (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  board_id uuid not null references public.boards on delete cascade,
  -- regla|tarjeta|situación (la fecha, la llegada, el día programado…)
  key text not null check (char_length(key) between 1 and 300),
  source text not null default 'app' check (source in ('app', 'server')),
  created_at timestamptz not null default now(),
  primary key (owner_id, key)
);
create index if not exists board_rule_runs_board on public.board_rule_runs(board_id, created_at desc);
alter table public.board_rule_runs enable row level security;
drop policy if exists personal on public.board_rule_runs;
create policy personal on public.board_rule_runs for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid())
  );
grant select, insert, delete on public.board_rule_runs to authenticated;

-- ───────── Avisos del servidor ─────────
create table if not exists public.board_inbox (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users on delete cascade,
  board_id uuid,
  card_id uuid,
  kind text not null check (kind in ('reminder', 'rule')),
  title text not null check (char_length(title) <= 300),
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists board_inbox_unread on public.board_inbox(owner_id, created_at desc)
  where read_at is null;
alter table public.board_inbox enable row level security;
drop policy if exists personal_read on public.board_inbox;
create policy personal_read on public.board_inbox for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists personal_mark on public.board_inbox;
create policy personal_mark on public.board_inbox for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select on public.board_inbox to authenticated;
grant update (read_at) on public.board_inbox to authenticated;

-- ───────── Plantillas de tarjeta ─────────
create table if not exists public.board_card_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  spec jsonb not null default '{}'::jsonb check (jsonb_typeof(spec) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);
alter table public.board_card_templates enable row level security;
drop policy if exists personal on public.board_card_templates;
create policy personal on public.board_card_templates for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.board_card_templates to authenticated;

-- ───────── Enlace de solo lectura ─────────
create table if not exists public.board_shares (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  board_id uuid not null references public.boards on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists board_shares_board on public.board_shares(board_id);
alter table public.board_shares enable row level security;
drop policy if exists personal on public.board_shares;
create policy personal on public.board_shares for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid())
  );
grant select, insert, update, delete on public.board_shares to authenticated;

-- Lo que ve el cliente con el enlace: columnas y tarjetas sin archivar. Sin personas, pendientes,
-- vínculos de Nexo ni nada más de tu cuenta.
create or replace function public.shared_board(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  bid uuid;
  out jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    return null;
  end if;
  select s.board_id into bid
    from board_shares s
    join boards b on b.id = s.board_id
   where s.token = p_token and s.revoked_at is null and b.owner_id = s.owner_id;
  if bid is null then
    return null;
  end if;
  select jsonb_build_object(
    'board', jsonb_build_object('name', b.name, 'background', coalesce(b.background, ''),
                                'updated', (select max(c.updated_at) from board_cards c
                                              join board_lists l on l.id = c.list_id
                                             where l.board_id = bid)),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', coalesce(l.color, ''))
                       order by l.rank, l.id)
        from board_lists l where l.board_id = bid), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(x.card order by x.rank, x.id) from (
        select c.rank, c.id,
               jsonb_build_object('id', c.id, 'list_id', c.list_id, 'title', c.title,
                                  'body', c.body, 'tags', c.tags, 'checks', c.checks,
                                  'due', c.due, 'starts', c.starts, 'done', c.done,
                                  'color', c.color, 'priority', c.priority) as card
          from board_cards c
          join board_lists l on l.id = c.list_id
         where l.board_id = bid and c.archived_at is null
         order by c.rank, c.id
         limit 3000
      ) x), '[]'::jsonb)
  ) into out
  from boards b where b.id = bid;
  return out;
end $$;
revoke all on function public.shared_board(text) from public;
grant execute on function public.shared_board(text) to anon, authenticated;

-- ───────── Un solo origen para tarjeta y pendiente ─────────
-- La tarjeta manda en título, descripción, fecha y completada; el pendiente vinculado la sigue.
-- Si cambias el pendiente (desde Pendientes o una persona), la tarjeta lo sigue a él.
-- Título, descripción y fecha solo se copian con los pendientes que nacieron en el tablero
-- (etiqueta «tablero»); el estado, con cualquier pendiente vinculado.
create or replace function public.board_card_sync_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  st text;
begin
  if pg_trigger_depth() > 1 or new.entry_id is null then
    return new;
  end if;
  -- Recién vinculada: la tarjeta toma el estado del pendiente (no al revés).
  if tg_op = 'INSERT' or new.entry_id is distinct from old.entry_id then
    select status into st from entries where id = new.entry_id and owner_id = new.owner_id;
    if st is not null then
      new.done := st = 'completado';
      new.done_at := case when new.done then coalesce(new.done_at, now()) else null end;
    end if;
    return new;
  end if;
  if new.title is not distinct from old.title and new.body is not distinct from old.body
     and new.due is not distinct from old.due and new.done is not distinct from old.done then
    return new;
  end if;
  update entries e set
    title = case when 'tablero' = any(e.tags)
                 then left(coalesce(nullif(btrim(new.title), ''), e.title), 180) else e.title end,
    body = case when 'tablero' = any(e.tags) then new.body else e.body end,
    details = case when 'tablero' = any(e.tags) then
                (case when new.due is null then e.details - 'due'
                      else jsonb_set(e.details, '{due}', to_jsonb(new.due::text)) end)
              else e.details end,
    status = case when new.done is distinct from old.done
                  then (case when new.done then 'completado' else 'pendiente' end)
                  else e.status end
  where e.id = new.entry_id and e.owner_id = new.owner_id and e.kind = 'Pendiente';
  return new;
end $$;
revoke all on function public.board_card_sync_entry() from public;
drop trigger if exists sync_entry on public.board_cards;
create trigger sync_entry before insert or update on public.board_cards
  for each row execute function public.board_card_sync_entry();

create or replace function public.entry_sync_board_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  board boolean := 'tablero' = any(new.tags);
  due date;
begin
  if pg_trigger_depth() > 1 or new.kind <> 'Pendiente' then
    return new;
  end if;
  if new.status is not distinct from old.status and new.title is not distinct from old.title
     and new.body is not distinct from old.body
     and (new.details ->> 'due') is not distinct from (old.details ->> 'due') then
    return new;
  end if;
  begin
    due := nullif(new.details ->> 'due', '')::date;
  exception when others then
    due := null;
  end;
  update board_cards c set
    done = case when new.status is distinct from old.status then new.status = 'completado' else c.done end,
    done_at = case when new.status is distinct from old.status
                   then (case when new.status = 'completado' then coalesce(c.done_at, now()) else null end)
                   else c.done_at end,
    -- Un título de tarjeta más largo que el del pendiente se conserva si no lo cambiaste allí.
    title = case when board and new.title is distinct from old.title and left(c.title, 180) <> new.title
                 then new.title else c.title end,
    body = case when board and new.body is distinct from old.body then new.body else c.body end,
    due = case when board and (new.details ->> 'due') is distinct from (old.details ->> 'due')
               then due else c.due end
  where c.entry_id = new.id and c.owner_id = new.owner_id;
  return new;
end $$;
revoke all on function public.entry_sync_board_cards() from public;
drop trigger if exists sync_board_cards on public.entries;
create trigger sync_board_cards after update on public.entries
  for each row execute function public.entry_sync_board_cards();

-- Las que ya habían quedado distintas se igualan una vez (sin llenar el historial).
alter table public.board_cards disable trigger log_card;
update public.board_cards c
   set done = (e.status = 'completado'),
       done_at = case when e.status = 'completado' then coalesce(c.done_at, now()) else null end
  from public.entries e
 where e.id = c.entry_id and c.done is distinct from (e.status = 'completado');
alter table public.board_cards enable trigger log_card;

commit;
