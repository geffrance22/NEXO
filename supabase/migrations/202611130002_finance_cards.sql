-- FINANZAS (3): tarjetas débito y crédito (en Bolsillos). Incluye todos los tipos anteriores, así
-- que basta con ejecutar esta aunque no hayas ejecutado 202611130001. Se puede ejecutar más de una vez.
-- El número completo y el CVV de una tarjeta nunca llegan en claro: se cifran en el navegador con el
-- PIN de la bóveda (AES-GCM) y aquí solo se guarda el texto cifrado.
begin;

alter table public.finance_items drop constraint if exists finance_items_kind_check;
alter table public.finance_items add constraint finance_items_kind_check
  check (kind in (
    'ajustes', 'deuda', 'inversion', 'proyeccion', 'recurrente', 'meta', 'deseo',
    'bolsillo', 'apunte', 'cobro', 'tarjeta'
  ));

commit;
