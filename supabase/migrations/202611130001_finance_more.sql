-- FINANZAS (2): bolsillos y carteras, apuntes con calculadora y cobros por partes (ingresos que
-- llegan en abonos de un total mayor). Todo vive en `finance_items`: solo se amplía la lista de
-- tipos permitidos. Se puede ejecutar más de una vez.
begin;

alter table public.finance_items drop constraint if exists finance_items_kind_check;
alter table public.finance_items add constraint finance_items_kind_check
  check (kind in (
    'ajustes', 'deuda', 'inversion', 'proyeccion', 'recurrente', 'meta', 'deseo',
    'bolsillo', 'apunte', 'cobro'
  ));

commit;
