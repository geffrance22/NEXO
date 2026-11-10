-- Nexo: las entradas del diario pueden quedar sin título (título vacío).
-- Antes se exigía al menos un carácter y la app rellenaba con parte del texto.
-- Se puede ejecutar más de una vez.
begin;

alter table public.entries drop constraint if exists entries_title_check;

commit;
