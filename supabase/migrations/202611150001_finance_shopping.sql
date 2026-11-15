-- FINANZAS: listas de compras generales (Metas y compras). Cada lista vive en `finance_items`
-- con el tipo «compras»: solo se amplía la lista de tipos permitidos. Las compras de la carta del
-- mes van dentro de su carta y no necesitan esto. Se puede ejecutar más de una vez.
begin;

alter table public.finance_items drop constraint if exists finance_items_kind_check;
alter table public.finance_items add constraint finance_items_kind_check
  check (kind in (
    'ajustes', 'deuda', 'inversion', 'proyeccion', 'recurrente', 'meta', 'deseo',
    'bolsillo', 'apunte', 'cobro', 'tarjeta', 'compras'
  ));

commit;
