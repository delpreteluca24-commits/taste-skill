-- =============================================================================
-- Sports Media OS — 0400 business-rule guards
-- These rules hold no matter who writes (UI, agent, worker, SQL console):
--   1. script versions are immutable; new versions get the next number
--   2. one selected hook / title per parent
--   3. rights status of videos/sources follows their latest rights check
--   4. content cannot reach READY+ with unverified critical facts or unsafe rights
--   5. RED / unchecked material cannot enter clip production
--   6. API publishing only for content that passed the READY gate
-- Errors use SQLSTATE P0001 with a stable prefix so the app can map them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at on every table that has the column
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. scripts — versioning + immutability
-- -----------------------------------------------------------------------------
create or replace function private.scripts_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- serialize version assignment per story
  perform 1 from public.stories s where s.id = new.story_id for update;

  if new.version is null then
    select coalesce(max(sc.version), 0) + 1 into new.version
    from public.scripts sc where sc.story_id = new.story_id;
  end if;

  if new.is_current then
    update public.scripts set is_current = false
    where story_id = new.story_id and is_current;
  end if;
  return new;
end;
$$;

create trigger scripts_before_insert
  before insert on public.scripts
  for each row execute function private.scripts_before_insert();

create or replace function private.scripts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
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

create trigger scripts_before_update
  before update on public.scripts
  for each row execute function private.scripts_before_update();

-- -----------------------------------------------------------------------------
-- 2. single selection (hooks per story/opportunity, titles per content item)
-- -----------------------------------------------------------------------------
create or replace function private.hooks_single_selected()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_selected then
    update public.hooks set is_selected = false
    where id <> new.id and is_selected
      and ((new.story_id is not null and story_id = new.story_id)
        or (new.story_id is null and story_id is null and opportunity_id = new.opportunity_id));
  end if;
  return new;
end;
$$;

create trigger hooks_single_selected
  before insert or update of is_selected on public.hooks
  for each row when (new.is_selected)
  execute function private.hooks_single_selected();

create or replace function private.titles_single_selected()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.titles set is_selected = false
  where content_item_id = new.content_item_id and id <> new.id and is_selected;
  return new;
end;
$$;

create trigger titles_single_selected
  before insert or update of is_selected on public.titles
  for each row when (new.is_selected)
  execute function private.titles_single_selected();

-- -----------------------------------------------------------------------------
-- 3. rights status follows the latest rights check
-- -----------------------------------------------------------------------------
create or replace function private.sync_rights_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_video_ids uuid[] := array_remove(array[
    case when tg_op <> 'INSERT' then old.video_id end,
    case when tg_op <> 'DELETE' then new.video_id end], null);
  v_source_ids uuid[] := array_remove(array[
    case when tg_op <> 'INSERT' then old.source_id end,
    case when tg_op <> 'DELETE' then new.source_id end], null);
begin
  update public.videos v
  set rights_status = coalesce((
    select rc.status from public.rights_checks rc
    where rc.video_id = v.id
    order by rc.checked_at desc, rc.created_at desc
    limit 1), 'unchecked')
  where v.id = any(v_video_ids);

  update public.sources s
  set rights_status = coalesce((
    select rc.status from public.rights_checks rc
    where rc.source_id = s.id
    order by rc.checked_at desc, rc.created_at desc
    limit 1), 'unchecked')
  where s.id = any(v_source_ids);

  return null;
end;
$$;

create trigger rights_checks_sync_status
  after insert or update or delete on public.rights_checks
  for each row execute function private.sync_rights_status();

-- -----------------------------------------------------------------------------
-- 4. READY gate for content items
-- Blockers are computed by one function used by both the trigger and the UI.
-- -----------------------------------------------------------------------------
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
    and v.rights_status in ('red', 'unchecked');
  if n > 0 then
    blockers := blockers || format('%s clip(s) use material with RED or unchecked rights', n);
  end if;

  return blockers;
end;
$$;

-- UI-facing: what stops this item from going READY? (RLS-equivalent visibility check)
create or replace function public.content_item_blockers(p_content_item_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  ci public.content_items%rowtype;
begin
  -- security invoker: RLS hides items of projects the caller is not a member of
  select * into ci from public.content_items where id = p_content_item_id;
  if not found then
    raise exception 'NOT_FOUND: content item not found' using errcode = 'P0001';
  end if;
  return private.content_blockers_for(ci.project_id, ci.id, ci.story_id, ci.opportunity_id);
end;
$$;

create or replace function private.content_items_stage_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  blockers text[];
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;

  if new.stage in ('ready', 'scheduled', 'published') then
    blockers := private.content_blockers_for(new.project_id, new.id, new.story_id, new.opportunity_id);
    if coalesce(array_length(blockers, 1), 0) > 0 then
      raise exception 'CONTENT_NOT_READY: %', array_to_string(blockers, '; ')
        using errcode = 'P0001';
    end if;
  end if;

  if new.stage = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger content_items_stage_guard
  before insert or update of stage, story_id, opportunity_id on public.content_items
  for each row execute function private.content_items_stage_guard();

-- -----------------------------------------------------------------------------
-- 5. rights gate for clip production
-- -----------------------------------------------------------------------------
create or replace function private.clips_rights_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rights public.rights_status;
begin
  if new.status in ('approved', 'rendering', 'rendered') then
    select v.rights_status into v_rights from public.videos v where v.id = new.video_id;
    if v_rights in ('red', 'unchecked') then
      raise exception 'RIGHTS_BLOCKED: source video rights are % — clip cannot enter production', v_rights
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger clips_rights_guard
  before insert or update of status, video_id on public.clips
  for each row execute function private.clips_rights_guard();

-- -----------------------------------------------------------------------------
-- 6. API publishing only after the READY gate
-- -----------------------------------------------------------------------------
create or replace function private.publishing_jobs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage public.content_stage;
begin
  if new.mode = 'api' and new.status in ('pending', 'running') then
    select ci.stage into v_stage from public.content_items ci where ci.id = new.content_item_id;
    if v_stage not in ('ready', 'scheduled', 'published') then
      raise exception 'PUBLISH_BLOCKED: content is in stage % — it must pass the READY gate first', v_stage
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger publishing_jobs_guard
  before insert or update of mode, status on public.publishing_jobs
  for each row execute function private.publishing_jobs_guard();

revoke execute on function private.content_blockers_for(uuid, uuid, uuid, uuid) from public;
grant execute on function private.content_blockers_for(uuid, uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.content_item_blockers(uuid) from public, anon;
grant execute on function public.content_item_blockers(uuid) to authenticated, service_role;
