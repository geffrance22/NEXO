-- Nexo: vínculos entre personas (familia, pareja, amistad, trabajo…) y grupos en común
-- (iglesia, un trabajo concreto, la familia Gómez…). Se puede ejecutar más de una vez.
begin;

-- Vínculo directo: «a» es <kind> de «b». a = null significa «Tú».
create table if not exists public.person_ties (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 a uuid references public.people(id) on delete cascade,
 b uuid not null references public.people(id) on delete cascade,
 kind text not null check (char_length(kind) between 1 and 30),
 note text not null default '' check (char_length(note) <= 300),
 created_at timestamptz not null default now(),
 check (a is distinct from b)
);
create unique index if not exists person_ties_unique
 on public.person_ties(owner_id, coalesce(a, '00000000-0000-0000-0000-000000000000'::uuid), b, kind);
create index if not exists person_ties_owner on public.person_ties(owner_id);

create table if not exists public.person_groups (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (char_length(name) between 1 and 80),
 kind text not null default 'otro' check (char_length(kind) <= 30),
 description text not null default '' check (char_length(description) <= 500),
 member_ids uuid[] not null default '{}',
 created_at timestamptz not null default now()
);
create index if not exists person_groups_owner on public.person_groups(owner_id);
create index if not exists person_groups_members on public.person_groups using gin(member_ids);

alter table public.person_ties enable row level security;
alter table public.person_groups enable row level security;
drop policy if exists "Own ties" on public.person_ties;
create policy "Own ties" on public.person_ties for all to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "Own groups" on public.person_groups;
create policy "Own groups" on public.person_groups for all to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on public.person_ties, public.person_groups from anon;
grant select, insert, update, delete on public.person_ties, public.person_groups to authenticated;

-- Las personas de un vínculo o un grupo deben ser de la misma cuenta.
create or replace function public.validate_tie_people() returns trigger language plpgsql set search_path=public as $$
begin
 if (new.a is not null and not exists (select 1 from public.people where id = new.a and owner_id = new.owner_id))
  or not exists (select 1 from public.people where id = new.b and owner_id = new.owner_id) then
  raise exception 'A linked person does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_tie_people on public.person_ties;
create trigger validate_tie_people before insert or update on public.person_ties
 for each row execute function public.validate_tie_people();

create or replace function public.validate_group_members() returns trigger language plpgsql set search_path=public as $$
begin
 if exists (select 1 from unnest(new.member_ids) m(id)
            where not exists (select 1 from public.people where id = m.id and owner_id = new.owner_id)) then
  raise exception 'A group member does not belong to this account';
 end if;
 return new;
end; $$;
drop trigger if exists validate_group_members on public.person_groups;
create trigger validate_group_members before insert or update on public.person_groups
 for each row execute function public.validate_group_members();

-- Al borrar una persona sale de sus grupos (los vínculos se borran solos por la clave foránea).
create or replace function public.unlink_person_from_groups() returns trigger language plpgsql set search_path=public as $$
begin
 update public.person_groups set member_ids = array_remove(member_ids, old.id)
 where owner_id = old.owner_id and old.id = any(member_ids);
 return old;
end; $$;
drop trigger if exists unlink_person_from_groups on public.people;
create trigger unlink_person_from_groups before delete on public.people
 for each row execute function public.unlink_person_from_groups();

commit;
