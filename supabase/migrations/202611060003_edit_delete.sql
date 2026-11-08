-- Nexo: soporte para editar y borrar personas y recuerdos. Se puede ejecutar más de una vez.
begin;

-- 1. Al borrar una persona se quita su id de los recuerdos vinculados (los recuerdos se conservan).
--    Sin esto, `entries.person_ids` (un arreglo sin clave foránea) quedaría con ids colgando.
create or replace function public.unlink_deleted_person() returns trigger language plpgsql set search_path=public as $$
begin
 update public.entries
 set person_ids = array_remove(person_ids, old.id)
 where owner_id = old.owner_id and old.id = any(person_ids);
 return old;
end; $$;
drop trigger if exists unlink_deleted_person on public.people;
create trigger unlink_deleted_person before delete on public.people for each row execute function public.unlink_deleted_person();

-- 2. Marca de última modificación en ambas tablas.
alter table public.people add column if not exists updated_at timestamptz not null default now();
alter table public.entries add column if not exists updated_at timestamptz not null default now();
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin
 new.updated_at = now();
 return new;
end; $$;
drop trigger if exists touch_updated_at on public.people;
create trigger touch_updated_at before update on public.people for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.entries;
create trigger touch_updated_at before update on public.entries for each row execute function public.touch_updated_at();

-- 3. Índice duplicado: `entries_fts` (sobre la columna generada `fts`) ya cubre la búsqueda de texto.
drop index if exists public.entries_search;

commit;
