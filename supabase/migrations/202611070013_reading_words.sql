-- Nexo: diccionario de Lecturas. Palabras y conceptos por aprender, guardados desde un artículo
-- (con la frase donde aparecían) o escritos a mano. learned_at: cuándo lo tachaste.
-- Se puede ejecutar más de una vez.
begin;

create table if not exists public.reading_words (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  term text not null check (length(trim(term)) between 1 and 200),
  context text not null default '' check (length(context) <= 1200),
  note text not null default '' check (length(note) <= 4000),
  -- Artículo de donde salió; si se borra, la palabra se queda (con el título guardado en source).
  reading_id uuid,
  source text not null default '' check (length(source) <= 300),
  learned_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, reading_id) references public.readings(owner_id, id) on delete set null (reading_id)
);
-- Una sola vez cada término (sin distinguir mayúsculas).
create unique index if not exists reading_words_term on public.reading_words(owner_id, lower(trim(term)));
create index if not exists reading_words_list on public.reading_words(owner_id, created_at desc);

alter table public.reading_words enable row level security;
drop policy if exists own_words on public.reading_words;
create policy own_words on public.reading_words for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.reading_words to authenticated;

commit;
