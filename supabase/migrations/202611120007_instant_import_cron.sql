-- Nexo: una vez al día (4:00 a. m. en Colombia) trae a Instantes lo que publicaste en Mastodon,
-- aunque Nexo esté cerrado. Es lo mismo que hace la app al abrirse, así que no se duplica nada.
-- Requiere 202611120006_instant_import.sql, la función `fediverse` desplegada y estos secretos:
--   · de la función (supabase secrets set): FEDIVERSE_CRON_SECRET=<una clave larga al azar>
--   · en Vault (la misma clave) — la URL del proyecto ya está si activaste los tableros:
--       select vault.create_secret('<la misma clave>', 'fediverse_cron_secret');
-- Se puede ejecutar más de una vez.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nexo-fediverse-import') then
    perform cron.unschedule('nexo-fediverse-import');
  end if;
end $$;

select cron.schedule(
  'nexo-fediverse-import',
  '0 9 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/fediverse',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fediverse_cron_secret')
    ),
    body := '{"action":"import"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
