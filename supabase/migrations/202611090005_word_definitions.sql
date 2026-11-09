-- Nexo: definición generada con IA para cada palabra del diccionario de Lecturas (significado,
-- raíz, historia, truco para recordarla, ejemplo, sinónimos, antónimos, familia y un ejercicio).
-- Se puede ejecutar más de una vez.
begin;

alter table public.reading_words
  add column if not exists definition jsonb
    check (definition is null or (jsonb_typeof(definition) = 'object' and length(definition::text) <= 8000));

commit;
