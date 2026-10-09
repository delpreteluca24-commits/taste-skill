-- =============================================================================
-- Sports Media OS — 1000 audit stamps + script lineage
-- 1. Who checked a fact / rights item is stamped by the database from the
--    session (auth.uid()), never trusted from the client payload. Agents and
--    workers (service role, no auth.uid()) identify themselves via *_by_agent.
-- 2. Script immutability allows exactly one system change besides is_current:
--    parent_script_id becoming NULL when the parent version is deleted
--    (ON DELETE SET NULL), so deleting a story never fails on lineage links.
-- =============================================================================

create or replace function private.stamp_rights_checker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.checked_by := auth.uid();
    new.checked_by_agent := null;
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.checked_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create trigger rights_checks_stamp_checker
  before insert or update on public.rights_checks
  for each row execute function private.stamp_rights_checker();

create or replace function private.stamp_fact_checker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.confidence is distinct from old.confidence then
    new.checked_at := clock_timestamp();
    if auth.uid() is not null then
      new.checked_by := auth.uid();
      new.checked_by_agent := null;
    end if;
  elsif auth.uid() is not null
        and (new.checked_by is distinct from old.checked_by
          or new.checked_by_agent is distinct from old.checked_by_agent
          or new.checked_at is distinct from old.checked_at) then
    -- the audit fields only move together with a verification change
    new.checked_by := old.checked_by;
    new.checked_by_agent := old.checked_by_agent;
    new.checked_at := old.checked_at;
  end if;
  return new;
end;
$$;

create trigger facts_stamp_checker
  before insert or update on public.facts
  for each row execute function private.stamp_fact_checker();

create or replace function private.scripts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'is_current' - 'parent_script_id') is distinct from (to_jsonb(old) - 'is_current' - 'parent_script_id')
     or (new.parent_script_id is distinct from old.parent_script_id and new.parent_script_id is not null) then
    raise exception 'SCRIPT_IMMUTABLE: script versions cannot be edited; create a new version instead'
      using errcode = 'P0001';
  end if;

  if new.is_current and not old.is_current then
    update public.scripts set is_current = false
    where story_id = new.story_id and is_current and id <> new.id;
  end if;
  return new;
end;
$$;
