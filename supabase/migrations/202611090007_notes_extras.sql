-- Notas libres: orden manual en el lienzo, fotos (ImgBB), recordatorios y bóveda con PIN.
-- Las notas de la bóveda se cifran en el navegador (AES-GCM con una clave derivada del PIN): aquí
-- solo llega el texto cifrado en `secret`, y los campos de contenido quedan vacíos.
begin;
alter table public.quick_notes
  add column if not exists rank float8,
  add column if not exists images jsonb not null default '[]'::jsonb,
  add column if not exists remind_at timestamptz,
  add column if not exists vaulted boolean not null default false,
  add column if not exists secret text;

-- Orden inicial: el de siempre (más recientes primero). Las notas nuevas quedan arriba.
update public.quick_notes set rank = -extract(epoch from created_at) * 1000 where rank is null;
alter table public.quick_notes
  alter column rank set default (-extract(epoch from now()) * 1000),
  alter column rank set not null;

alter table public.quick_notes
  add constraint quick_notes_images_list
    check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 12),
  add constraint quick_notes_secret_size check (secret is null or length(secret) <= 2000000),
  -- En la bóveda no puede quedar nada legible fuera de `secret`.
  add constraint quick_notes_vault_sealed check (
    not vaulted or (
      secret is not null and title = '' and body = '' and tags = '{}'
      and checks = '[]'::jsonb and images = '[]'::jsonb and book_id is null and episode_id is null
    )
  );

create index if not exists quick_notes_rank on public.quick_notes(owner_id, rank);
create index if not exists quick_notes_remind on public.quick_notes(owner_id, remind_at)
  where remind_at is not null;

-- Una bóveda por persona: sal y vueltas para derivar la clave, y un verificador cifrado que
-- permite saber si el PIN es correcto sin guardarlo.
create table if not exists public.note_vaults(
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  salt text not null check (length(salt) between 16 and 200),
  iterations int not null check (iterations between 100000 and 5000000),
  verifier text not null check (length(verifier) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.note_vaults enable row level security;
create policy personal on public.note_vaults for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.note_vaults to authenticated;
commit;
