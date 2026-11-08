-- Nexo: devuelve una consulta de la cuota diaria cuando el asistente falla por causas ajenas al usuario
-- (Groq no responde, error interno). Solo la Edge Function puede llamarla, con la clave de servicio:
-- si el navegador pudiera ejecutarla, el usuario podría reiniciar su propio contador.
-- Es opcional: sin esta migración el asistente funciona igual, pero las consultas fallidas siguen contando.
begin;
create or replace function public.refund_assistant_quota(p_owner uuid) returns void language sql security definer set search_path=public as $$
 update public.assistant_usage set calls=greatest(calls-1,0) where owner_id=p_owner and day=current_date;
$$;
revoke all on function public.refund_assistant_quota(uuid) from public,anon,authenticated;
grant execute on function public.refund_assistant_quota(uuid) to service_role;
commit;
