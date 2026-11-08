-- Nexo: fotos (alojadas en ImgBB) y detalles propios de cada tipo de recuerdo. Se puede ejecutar más de una vez.
--   images : [{"url": "...", "medium": "...", "thumb": "..."}]  (máximo 12 por recuerdo)
--   details: {"author": "...", "rating": 4, "place": "...", ...} (depende del tipo: libro, película, encuentro...)
begin;

alter table public.entries add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.entries add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.entries drop constraint if exists entries_images_valid;
alter table public.entries add constraint entries_images_valid
 check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 12);

alter table public.entries drop constraint if exists entries_details_valid;
alter table public.entries add constraint entries_details_valid
 check (jsonb_typeof(details) = 'object' and length(details::text) <= 20000);

commit;
