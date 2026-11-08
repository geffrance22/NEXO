-- Nexo: tres colores de resaltado (amarillo, azul oscuro y naranja). Los anteriores se pasan al
-- más cercano: verde → amarillo; rojo y rosa → naranja. Se puede ejecutar más de una vez.
begin;

alter table public.reading_marks drop constraint if exists reading_marks_color_check;
update public.reading_marks set color = 'yellow' where color = 'mint';
update public.reading_marks set color = 'orange' where color in ('red', 'rose');
alter table public.reading_marks add constraint reading_marks_color_check
 check (color in ('yellow', 'blue', 'orange'));

commit;
