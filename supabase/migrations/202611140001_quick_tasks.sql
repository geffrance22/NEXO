-- Nexo: PENDIENTES RÁPIDOS (Agenda → Pendientes → Abiertos). Una lista corta del día para
-- apuntar y tachar sin crear un pendiente completo.
-- · done_at: cuándo lo tachaste (null: sin tachar). Los tachados se borran al día siguiente; los
--   que no, siguen en la lista con la etiqueta de su día. Eso lo hace la app (con tu zona horaria).
-- Se puede ejecutar más de una vez.
begin;

create table if not exists public.quick_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 300),
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists quick_tasks_owner on public.quick_tasks (owner_id, created_at);

alter table public.quick_tasks enable row level security;
drop policy if exists own_quick_tasks on public.quick_tasks;
create policy own_quick_tasks on public.quick_tasks for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.quick_tasks from anon;
grant select, insert, update, delete on public.quick_tasks to authenticated;

commit;
