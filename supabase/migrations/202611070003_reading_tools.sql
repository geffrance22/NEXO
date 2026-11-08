begin;
alter table public.readings add column if not exists tags text[] not null default '{}';
alter table public.reading_marks drop constraint if exists reading_marks_color_check;
alter table public.reading_marks add constraint reading_marks_color_check check(color in ('yellow','mint','blue','red','rose'));
commit;
