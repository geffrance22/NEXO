-- Nexo: repaso espaciado de los resaltados de Lecturas (vuelven a la agenda de hoy).
-- review_step: -1 = no repasar más; 0, 1, 2… = cuántas veces lo recordaste seguido.
-- review_due: cuándo toca (vacío = al día siguiente de resaltarlo). Se puede ejecutar más de una vez.
begin;

alter table public.reading_marks add column if not exists review_due date;
alter table public.reading_marks add column if not exists review_step smallint not null default 0;
alter table public.reading_marks add column if not exists reviewed_at timestamptz;
create index if not exists reading_marks_review on public.reading_marks(owner_id, review_due)
 where review_step >= 0;

-- La vista de anotaciones suma los datos de repaso y el color (columnas nuevas al final).
create or replace view public.reading_annotations with (security_invoker=true) as
 select m.id, m.reading_id, m.quote, m.note, m.edited_at, r.title,
        m.review_due, m.review_step, m.color
 from public.reading_marks m join public.readings r on r.id = m.reading_id;
grant select on public.reading_annotations to authenticated;

commit;
