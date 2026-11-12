-- Nexo: un pendiente se puede cerrar como hecho o como no realizado («Soltados» en Agenda).
-- Agrega el estado «no_realizado» a entries.status. La razón (opcional) y la fecha en que lo
-- marcaste viven en details.missed, así que no hace falta otra columna.
-- Los disparadores con los tableros no cambian: un pendiente no realizado deja su tarjeta sin
-- completar (la tarjeta solo se completa con «completado»).
-- Se puede ejecutar más de una vez.
begin;

-- La restricción original no tiene nombre propio: se busca la que limita status y se cambia.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.entries'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
       and pg_get_constraintdef(oid) ilike '%completado%'
  loop
    execute format('alter table public.entries drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.entries
  add constraint entries_status_check
  check (status in ('pendiente', 'completado', 'no_realizado'));

commit;
