-- Nexo: un cuarto color de resaltado (verde, «Acción») y la fecha de creación de los cuadernos
-- (el menú de destino muestra los más recientes). Se puede ejecutar más de una vez.
begin;

alter table public.reading_marks drop constraint if exists reading_marks_color_check;
alter table public.reading_marks add constraint reading_marks_color_check
 check (color in ('yellow', 'blue', 'orange', 'green'));

alter table public.reading_books
  add column if not exists created_at timestamptz not null default now();

commit;
