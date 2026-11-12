-- Nexo: INSTANTES + CUADERNOS. Un instante puede vincularse a uno o varios cuadernos de Agenda
-- (además de episodios, recuerdos, personas y lugares), desde «Episodio o tema» al escribirlo.
-- · notebook_ids: ids de agenda_notebooks (sin llave foránea, como el resto de vínculos: si un
--   cuaderno se borra, el vínculo queda suelto y la app lo ignora).
-- Requiere 202611120003_instants.sql. Se puede ejecutar más de una vez.
begin;

alter table public.instants
  add column if not exists notebook_ids uuid[] not null default '{}'
  check (cardinality(notebook_ids) <= 40);

commit;
