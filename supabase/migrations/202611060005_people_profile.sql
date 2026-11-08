-- Nexo: identidad completa de cada persona (foto, relación, cercanía, contacto, fechas, gustos,
-- datos libres y registro de dar/recibir). Se puede ejecutar más de una vez.
begin;

alter table public.people add column if not exists profile jsonb not null default '{}'::jsonb;

alter table public.people drop constraint if exists people_profile_valid;
alter table public.people add constraint people_profile_valid
 check (jsonb_typeof(profile) = 'object' and length(profile::text) <= 200000);

commit;
