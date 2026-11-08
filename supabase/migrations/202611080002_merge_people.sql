-- Nexo: unir dos fichas de la misma persona. Todo lo de «p_drop» pasa a «p_keep» (recuerdos,
-- compromisos, episodios, grupos, vínculos y tarjetas) y después se borra «p_drop». Los datos de
-- su ficha (gustos, novedades, teléfono…) los une la app antes de llamar a esta función.
-- Se ejecuta con los permisos de quien la llama (RLS incluido). Se puede ejecutar más de una vez.
begin;

create or replace function public.merge_people(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Inicia sesión para unir personas';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Elige dos personas distintas';
  end if;
  if (select count(*) from people where owner_id = me and id in (p_keep, p_drop)) <> 2 then
    raise exception 'No se encontró a una de las personas';
  end if;

  -- Recuerdos: a quién están vinculados y quién debe o espera algo en un compromiso.
  update entries
     set person_ids = case
           when p_keep = any(person_ids) then array_remove(person_ids, p_drop)
           else array_replace(person_ids, p_drop, p_keep)
         end
   where owner_id = me and p_drop = any(person_ids);

  update entries
     set details = details
       || case when details ->> 'owner' = p_drop::text
               then jsonb_build_object('owner', p_keep::text) else '{}'::jsonb end
       || case when details ->> 'beneficiary' = p_drop::text
               then jsonb_build_object('beneficiary', p_keep::text) else '{}'::jsonb end
   where owner_id = me
     and (details ->> 'owner' = p_drop::text or details ->> 'beneficiary' = p_drop::text);

  -- Episodios y grupos.
  if to_regclass('public.episodes') is not null then
    update episodes
       set person_ids = case
             when p_keep = any(person_ids) then array_remove(person_ids, p_drop)
             else array_replace(person_ids, p_drop, p_keep)
           end
     where owner_id = me and p_drop = any(person_ids);
  end if;

  if to_regclass('public.person_groups') is not null then
    update person_groups
       set member_ids = case
             when p_keep = any(member_ids) then array_remove(member_ids, p_drop)
             else array_replace(member_ids, p_drop, p_keep)
           end
     where owner_id = me and p_drop = any(member_ids);
  end if;

  -- Vínculos. Los que había entre las dos desaparecen (serían consigo misma). Si la que queda ya
  -- tiene un vínculo con alguien (tú incluido), se conserva el suyo y se descarta el de la otra.
  if to_regclass('public.person_ties') is not null then
    delete from person_ties
     where owner_id = me
       and ((a = p_keep and b = p_drop) or (a = p_drop and b = p_keep));

    delete from person_ties t
     where t.owner_id = me
       and (t.a = p_drop or t.b = p_drop)
       and exists (
         select 1
           from person_ties k
          where k.owner_id = me
            and (k.a = p_keep or k.b = p_keep)
            and (case when k.a = p_keep then k.b else k.a end)
                is not distinct from (case when t.a = p_drop then t.b else t.a end)
       );

    update person_ties set a = p_keep where owner_id = me and a = p_drop;
    update person_ties set b = p_keep where owner_id = me and b = p_drop;
  end if;

  -- Tarjetas de los tableros. Si algo lo impide, al borrar quedan sin persona (no se pierden).
  if to_regclass('public.board_cards') is not null then
    begin
      update board_cards set person_id = p_keep where owner_id = me and person_id = p_drop;
    exception when others then
      null;
    end;
  end if;

  -- Descartes que hablaban de la ficha que se va.
  if to_regclass('public.dismissals') is not null then
    delete from dismissals where owner_id = me and position(p_drop::text in key) > 0;
  end if;

  delete from people where owner_id = me and id = p_drop;
end;
$$;

revoke all on function public.merge_people(uuid, uuid) from public, anon;
grant execute on function public.merge_people(uuid, uuid) to authenticated;

commit;
