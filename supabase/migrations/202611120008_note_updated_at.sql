-- Notas (Libroteca): cuándo se modificó por última vez su contenido, para «Modificada …» al abrirla.
-- Queda vacía hasta la primera edición (las notas que ya existen no tienen cómo saberlo).
-- Reordenar, fijar, archivar o cambiar el color no cuenta como modificarla.
begin;

alter table public.quick_notes add column if not exists updated_at timestamptz;

create or replace function public.touch_quick_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title, new.body, new.checks, new.tags, new.images, new.secret)
     is distinct from (old.title, old.body, old.checks, old.tags, old.images, old.secret) then
    new.updated_at := now();
  else
    -- La fecha la pone la base de datos, no quien escribe.
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists touch_quick_note on public.quick_notes;
create trigger touch_quick_note
  before update on public.quick_notes
  for each row execute function public.touch_quick_note();

commit;
