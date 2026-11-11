-- FINANZAS: lo que no es un movimiento. Deudas (lo que debes y te deben), inversiones con su
-- seguimiento diario, cartas del mes (proyección), fijos y suscripciones, metas de ahorro, deseos
-- con tiempo de espera y tus ajustes (presupuestos, cuentas, categorías propias).
-- Los movimientos siguen en `entries` (kind = 'Movimiento'); sus datos nuevos van en `details`.
-- Se puede ejecutar más de una vez.
begin;

create table if not exists public.finance_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null
    check (kind in ('ajustes', 'deuda', 'inversion', 'proyeccion', 'recurrente', 'meta', 'deseo')),
  title text not null default '' check (char_length(title) <= 200),
  data jsonb not null default '{}'
    check (jsonb_typeof(data) = 'object' and length(data::text) <= 400000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_items_owner
  on public.finance_items (owner_id, kind, updated_at desc);

alter table public.finance_items enable row level security;
drop policy if exists own_finance_items on public.finance_items;
create policy own_finance_items on public.finance_items for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.finance_items from anon;
grant select, insert, update, delete on public.finance_items to authenticated;

commit;
