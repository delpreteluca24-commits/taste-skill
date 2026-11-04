-- =============================================================================
-- Sports Media OS — M2 / 0200 RIGHTS-FIRST content engine
--
-- Principle: rights belong to ASSETS (sources, videos), never to STORIES.
-- A story can be approved and produced with original formats even when no
-- footage is usable (STORY ≠ FOOTAGE).
--
--   GREEN  → may enter production under the recorded conditions
--            (DB requires a documented basis: commercial use + ownership/evidence)
--   YELLOW → needs human review; usable ONLY after a human 'rights' approval,
--            and NEVER by automated workflows (workers/agents)
--   RED    → never enters production
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Full classification on every rights check
--    ownership · source · license · commercial_use · authorization ·
--    transformation_required · risk · rights_status · evidence_url · notes
-- -----------------------------------------------------------------------------
alter table public.rights_checks rename column origin to source_detail;

alter table public.rights_checks
  add column ownership public.asset_ownership not null default 'unknown',
  add column transformation_required boolean not null default false,
  add column evidence_url text check (evidence_url is null or (evidence_url ~* '^https?://' and char_length(evidence_url) <= 2048)),
  add constraint rights_checks_id_project_key unique (id, project_id),
  -- GREEN must be documented: commercial use allowed AND a real basis for it
  add constraint rights_checks_green_requires_basis check (
    status <> 'green'
    or (
      commercial_use is true
      and ownership not in ('unknown', 'third_party')
      and (ownership in ('owned', 'public_domain') or evidence_url is not null)
    )
  );

comment on column public.rights_checks.owner is 'Rights holder name (e.g. club, league, photographer)';
comment on column public.rights_checks.source_detail is 'Where the asset comes from (channel, archive, agency, upload)';
comment on column public.rights_checks.authorization_details is 'Permission on file: who granted it, scope, date';
comment on column public.rights_checks.transformation_required is 'Use is allowed only if transformed (commentary, edit, overlay)';
comment on column public.rights_checks.evidence_url is 'Link to license, contract, email or written permission';

-- -----------------------------------------------------------------------------
-- 2. Derived rights state on assets (read-only for every writer)
-- -----------------------------------------------------------------------------
alter table public.videos
  add column rights_check_id uuid,
  add column usable_in_production boolean not null default false;

alter table public.sources
  add column rights_check_id uuid,
  add column usable_in_production boolean not null default false;

-- approvals can now target scripts and rights checks
alter table public.approvals drop constraint approvals_entity_type_check;
alter table public.approvals add constraint approvals_entity_type_check
  check (entity_type in ('opportunity', 'story', 'content_item', 'publishing_job', 'script', 'rights_check'));

-- Is this check usable in (human-initiated) production?
create or replace function private.rights_check_usable(p_check_id uuid, p_status public.rights_status)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_check_id is null then false
    when p_status = 'green' then true
    when p_status = 'yellow' then coalesce((
      select a.decision = 'approved'
      from public.approvals a
      where a.checkpoint = 'rights' and a.entity_type = 'rights_check' and a.entity_id = p_check_id
      order by a.created_at desc, a.id desc
      limit 1), false)
    else false
  end
$$;

-- Recompute an asset's rights state from its latest check (+ approvals)
create or replace function private.refresh_asset_rights(p_video_id uuid, p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.rights_status;
begin
  if p_video_id is not null then
    select rc.id, rc.status into v_id, v_status
    from public.rights_checks rc
    where rc.video_id = p_video_id
    order by rc.checked_at desc, rc.created_at desc, rc.id desc
    limit 1;
    update public.videos
    set rights_status = coalesce(v_status, 'unchecked'),
        rights_check_id = v_id,
        usable_in_production = private.rights_check_usable(v_id, v_status)
    where id = p_video_id;
  end if;

  if p_source_id is not null then
    v_id := null; v_status := null;
    select rc.id, rc.status into v_id, v_status
    from public.rights_checks rc
    where rc.source_id = p_source_id
    order by rc.checked_at desc, rc.created_at desc, rc.id desc
    limit 1;
    update public.sources
    set rights_status = coalesce(v_status, 'unchecked'),
        rights_check_id = v_id,
        usable_in_production = private.rights_check_usable(v_id, v_status)
    where id = p_source_id;
  end if;
end;
$$;

-- replaces the M1 version: same trigger, now also maintains check id + usability
create or replace function private.sync_rights_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.refresh_asset_rights(old.video_id, old.source_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.refresh_asset_rights(new.video_id, new.source_id);
  end if;
  return null;
end;
$$;

-- a 'rights' approval changes usability of the approved check's asset
create or replace function private.sync_rights_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rc public.rights_checks;
begin
  select * into rc from public.rights_checks where id = new.entity_id;
  if found then
    perform private.refresh_asset_rights(rc.video_id, rc.source_id);
  end if;
  return null;
end;
$$;

create trigger approvals_sync_rights
  after insert on public.approvals
  for each row when (new.checkpoint = 'rights')
  execute function private.sync_rights_on_approval();

-- derived columns are read-only: only the sync functions (nested triggers) write them
create or replace function private.rights_status_readonly()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.rights_status <> 'unchecked' or new.usable_in_production or new.rights_check_id is not null then
      raise exception 'RIGHTS_BLOCKED: rights status starts as unchecked; record a rights check instead'
        using errcode = 'P0001';
    end if;
  elsif new.rights_status is distinct from old.rights_status
     or new.usable_in_production is distinct from old.usable_in_production
     or new.rights_check_id is distinct from old.rights_check_id then
    raise exception 'RIGHTS_BLOCKED: rights status changes only through a rights check'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger videos_rights_status_readonly on public.videos;
drop trigger sources_rights_status_readonly on public.sources;

create trigger videos_rights_status_readonly
  before insert or update of rights_status, usable_in_production, rights_check_id on public.videos
  for each row execute function private.rights_status_readonly();

create trigger sources_rights_status_readonly
  before insert or update of rights_status, usable_in_production, rights_check_id on public.sources
  for each row execute function private.rights_status_readonly();

-- -----------------------------------------------------------------------------
-- 3. Production gates
--    automated writers (no auth.uid(): workers, agents) → GREEN only
--    humans → GREEN, or YELLOW with a human rights approval; RED never
-- -----------------------------------------------------------------------------
create or replace function private.clips_rights_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.rights_status;
  v_usable boolean;
begin
  if new.status in ('approved', 'rendering', 'rendered') then
    select v.rights_status, v.usable_in_production into v_status, v_usable
    from public.videos v where v.id = new.video_id;

    if auth.uid() is null then
      if v_status is distinct from 'green' then
        raise exception 'RIGHTS_BLOCKED: automated production requires GREEN rights (source video is %)', v_status
          using errcode = 'P0001';
      end if;
    elsif not coalesce(v_usable, false) then
      raise exception 'RIGHTS_BLOCKED: source video rights are % — RED never, YELLOW only after a rights approval', v_status
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- READY gate: replace the clip-rights part (now: anything not cleared for production)
create or replace function private.content_blockers_for(
  p_project_id uuid,
  p_content_item_id uuid,
  p_story_id uuid,
  p_opportunity_id uuid
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  blockers text[] := '{}'::text[];
  n integer;
begin
  select count(*) into n
  from public.facts f
  where f.project_id = p_project_id
    and f.is_critical
    and f.status <> 'confirmed'
    and (f.content_item_id = p_content_item_id
      or (p_story_id is not null and f.story_id = p_story_id)
      or (p_opportunity_id is not null and f.opportunity_id = p_opportunity_id));
  if n > 0 then
    blockers := blockers || format('%s critical fact(s) not confirmed', n);
  end if;

  select count(*) into n
  from public.clips c
  join public.videos v on v.id = c.video_id
  where c.content_item_id = p_content_item_id
    and c.status <> 'rejected'
    and not v.usable_in_production;
  if n > 0 then
    blockers := blockers || format('%s clip(s) use material not cleared for production (RED, unchecked or unapproved YELLOW)', n);
  end if;

  return blockers;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Rights Center read model: every asset with its current classification
-- -----------------------------------------------------------------------------
create or replace view public.asset_rights
with (security_invoker = true)
as
select
  'source'::text as asset_type,
  s.id as asset_id,
  s.project_id,
  coalesce(s.title, s.name) as title,
  s.name as publisher,
  s.url,
  s.source_type::text as kind,
  s.license_status,
  s.rights_status,
  s.usable_in_production,
  (s.rights_status = 'yellow' and not s.usable_in_production) as awaiting_approval,
  rc.id as check_id,
  rc.owner,
  rc.ownership,
  rc.source_detail,
  rc.license,
  rc.commercial_use,
  rc.authorization_details,
  rc.transformation_required,
  rc.risk,
  rc.evidence_url,
  rc.notes,
  rc.checked_at,
  rc.checked_by,
  rc.checked_by_agent,
  rc.expires_at,
  s.created_at
from public.sources s
left join public.rights_checks rc on rc.id = s.rights_check_id
union all
select
  'video'::text,
  v.id,
  v.project_id,
  v.title,
  null::text,
  null::text,
  coalesce(v.container, 'video'),
  null::public.license_status,
  v.rights_status,
  v.usable_in_production,
  (v.rights_status = 'yellow' and not v.usable_in_production),
  rc.id,
  rc.owner,
  rc.ownership,
  rc.source_detail,
  rc.license,
  rc.commercial_use,
  rc.authorization_details,
  rc.transformation_required,
  rc.risk,
  rc.evidence_url,
  rc.notes,
  rc.checked_at,
  rc.checked_by,
  rc.checked_by_agent,
  rc.expires_at,
  v.created_at
from public.videos v
left join public.rights_checks rc on rc.id = v.rights_check_id;

revoke all on public.asset_rights from anon;
grant select on public.asset_rights to authenticated, service_role;

revoke execute on function private.rights_check_usable(uuid, public.rights_status) from public;
grant execute on function private.rights_check_usable(uuid, public.rights_status) to authenticated, service_role;
revoke execute on function private.refresh_asset_rights(uuid, uuid) from public, authenticated;
grant execute on function private.refresh_asset_rights(uuid, uuid) to service_role;
