begin;
alter table public.readings add column if not exists media jsonb not null default '{}';
alter table public.reading_marks add column if not exists color text not null default 'yellow' check(color in ('yellow','mint','rose','blue'));
commit;