-- Nexo: arregla «column reference "due" is ambiguous» al completar un pendiente.
-- El disparador que lleva los cambios de un pendiente a su tarjeta de tablero (de
-- 202611100009_board_phases_2_4.sql) tenía una variable llamada «due», igual que la columna
-- board_cards.due, y la actualización fallaba: el pendiente no se podía marcar como hecho.
-- Aquí la variable pasa a llamarse «new_due». Lo demás queda igual.
-- Se puede ejecutar más de una vez.
begin;

create or replace function public.entry_sync_board_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  board boolean := 'tablero' = any(new.tags);
  -- Ojo: no puede llamarse «due» (choca con board_cards.due).
  new_due date;
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
    new_due := nullif(new.details ->> 'due', '')::date;
  exception when others then
    new_due := null;
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
               then new_due else c.due end
  where c.entry_id = new.id and c.owner_id = new.owner_id;
  return new;
end $$;
revoke all on function public.entry_sync_board_cards() from public;

commit;
