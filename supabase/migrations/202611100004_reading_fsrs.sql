-- Nexo: repaso espaciado con FSRS. Cada tarjeta guarda su estabilidad (días hasta que la
-- probabilidad de recordarla baja al 90 %) y su dificultad (1 a 10). Las que ya tenías siguen
-- igual: su memoria se estima desde el paso en que iban la próxima vez que las repases.
-- Se puede ejecutar más de una vez.
begin;

alter table public.reading_marks
  add column if not exists review_stability real,
  add column if not exists review_difficulty real;

alter table public.reading_flashcards
  add column if not exists review_stability real,
  add column if not exists review_difficulty real;
-- Las tarjetas de huecos llevan un fragmento entero (p. ej. un subrayado): más espacio delante.
alter table public.reading_flashcards drop constraint if exists reading_flashcards_front_check;
alter table public.reading_flashcards add constraint reading_flashcards_front_check
  check (length(trim(front)) between 1 and 1000);

alter table public.reading_words
  add column if not exists review_stability real,
  add column if not exists review_difficulty real,
  add column if not exists reviewed_at timestamptz;

-- La vista de anotaciones suma la memoria (columnas nuevas al final).
create or replace view public.reading_annotations with (security_invoker=true) as
 select m.id, m.reading_id, m.quote, m.note, m.edited_at, r.title,
        m.review_due, m.review_step, m.color,
        m.reviewed_at, m.review_stability, m.review_difficulty
 from public.reading_marks m join public.readings r on r.id = m.reading_id;
grant select on public.reading_annotations to authenticated;

commit;
