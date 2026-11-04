-- =============================================================================
-- Sports Media OS — 0900 rights_status is derived, never written directly
-- videos.rights_status / sources.rights_status may only change through a
-- rights_checks row (audited: who, when, license, risk). Without this guard an
-- editor could flip a RED video to GREEN with a plain UPDATE and bypass the
-- production gate. The sync trigger runs nested (pg_trigger_depth() > 1).
-- =============================================================================

create or replace function private.rights_status_readonly()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- written by private.sync_rights_status()
  end if;
  if tg_op = 'INSERT' and new.rights_status <> 'unchecked' then
    raise exception 'RIGHTS_BLOCKED: rights status starts as unchecked; record a rights check instead'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.rights_status is distinct from old.rights_status then
    raise exception 'RIGHTS_BLOCKED: rights status changes only through a rights check'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger videos_rights_status_readonly
  before insert or update of rights_status on public.videos
  for each row execute function private.rights_status_readonly();

create trigger sources_rights_status_readonly
  before insert or update of rights_status on public.sources
  for each row execute function private.rights_status_readonly();
