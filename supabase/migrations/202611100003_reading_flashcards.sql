-- Nexo: flashcards de Lecturas. Tarjetas de estudio (pregunta y respuesta) que la IA saca de los
-- artículos ya leídos y que entran en el repaso espaciado (1, 3, 7, 16… días).
-- review_step = -1: «No repasar más». Se puede ejecutar más de una vez.
begin;

create table if not exists public.reading_flashcards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- Artículo de donde salió; si se borra, la tarjeta se queda (con el título guardado en source).
  reading_id uuid,
  source text not null default '' check (length(source) <= 300),
  front text not null check (length(trim(front)) between 1 and 400),
  back text not null check (length(trim(back)) between 1 and 1200),
  review_step smallint not null default 0,
  review_due date,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, reading_id) references public.readings(owner_id, id) on delete set null (reading_id)
);
create index if not exists reading_flashcards_due on public.reading_flashcards(owner_id, review_due);
create index if not exists reading_flashcards_reading on public.reading_flashcards(owner_id, reading_id);

alter table public.reading_flashcards enable row level security;
drop policy if exists own_flashcards on public.reading_flashcards;
create policy own_flashcards on public.reading_flashcards for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.reading_flashcards to authenticated;

commit;
