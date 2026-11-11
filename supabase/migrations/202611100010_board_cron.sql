-- Nexo: reglas programadas y recordatorios de Tableros en el servidor, cada 5 minutos.
-- Requiere 202611100009_board_phases_2_4.sql y la función board-sweep desplegada:
--   supabase functions deploy board-sweep --no-verify-jwt
--   supabase secrets set BOARD_SWEEP_SECRET=<una clave larga al azar>
-- Antes de ejecutar este archivo, guarda en Vault la URL del proyecto y la misma clave
-- (Dashboard → Project Settings → Vault, o en el SQL Editor):
--   select vault.create_secret('https://<tu-proyecto>.supabase.co', 'project_url');
--   select vault.create_secret('<la misma clave de BOARD_SWEEP_SECRET>', 'board_sweep_secret');
-- Se puede ejecutar más de una vez.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nexo-board-sweep') then
    perform cron.unschedule('nexo-board-sweep');
  end if;
end $$;

select cron.schedule(
  'nexo-board-sweep',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/board-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'board_sweep_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Lo aplicado hace más de 180 días ya no hace falta recordarlo.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nexo-board-runs-cleanup') then
    perform cron.unschedule('nexo-board-runs-cleanup');
  end if;
end $$;
select cron.schedule(
  'nexo-board-runs-cleanup',
  '17 4 * * *',
  $$
  delete from public.board_rule_runs where created_at < now() - interval '180 days';
  delete from public.board_inbox where read_at is not null and read_at < now() - interval '30 days';
  $$
);
