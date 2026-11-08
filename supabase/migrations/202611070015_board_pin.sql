-- Nexo: una columna de Tableros anclada a Mi espacio (acceso rápido). Solo una a la vez.
-- Se puede ejecutar más de una vez.
begin;

alter table public.board_lists add column if not exists pinned boolean not null default false;
create unique index if not exists board_lists_one_pinned
  on public.board_lists(owner_id) where pinned;

commit;
