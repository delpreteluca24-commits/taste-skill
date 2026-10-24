-- =============================================================================
-- M2 · Integration: atomic story creation, batch blockers, cache-aware usage,
-- clear error for scripts pointing at another project's story.
-- =============================================================================

-- 1. Content item without a story → story built from the item, linked in ONE
--    transaction (row lock: concurrent clicks land on the same story).
create or replace function public.create_story_for_content_item(p_content_item_id uuid)
returns table (story_id uuid, existing boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ci public.content_items;
  o public.opportunities;
  v_story uuid;
  v_logline text;
begin
  select * into ci from public.content_items where id = p_content_item_id for update;
  if not found then
    raise exception 'NOT_FOUND: content item not found' using errcode = 'P0001';
  end if;
  if ci.story_id is not null then
    return query select ci.story_id, true;
    return;
  end if;

  if ci.opportunity_id is not null then
    select * into o from public.opportunities where id = ci.opportunity_id and project_id = ci.project_id;
  end if;
  v_logline := left(coalesce(ci.description, o.why_now), 1000);

  insert into public.stories (project_id, opportunity_id, title, logline, angle, created_by, metadata)
  values (
    ci.project_id, ci.opportunity_id, ci.title, v_logline, o.angle, auth.uid(),
    jsonb_strip_nulls(jsonb_build_object('created_from', 'content_item', 'content_item_id', ci.id, 'hook', o.hook))
  )
  returning id into v_story;

  update public.content_items set story_id = v_story where id = ci.id;
  return query select v_story, false;
end;
$$;
revoke execute on function public.create_story_for_content_item(uuid) from public, anon;
grant execute on function public.create_story_for_content_item(uuid) to authenticated, service_role;

-- 2. READY blockers for many cards in one round trip (the Kanban board).
--    SECURITY INVOKER: RLS limits the items to the caller's projects.
create or replace function public.content_items_blockers(p_project_id uuid, p_ids uuid[])
returns table (content_item_id uuid, blockers text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select ci.id, private.content_blockers_for(ci.project_id, ci.id, ci.story_id, ci.opportunity_id)
  from public.content_items ci
  where ci.project_id = p_project_id
    and ci.id = any (p_ids[1:500])
$$;
revoke execute on function public.content_items_blockers(uuid, uuid[]) from public, anon;
grant execute on function public.content_items_blockers(uuid, uuid[]) to authenticated, service_role;

-- 3. Usage ledger summary with prompt-cache tokens and exact unpriced calls.
drop function public.ai_usage_summary(uuid, integer);
create function public.ai_usage_summary(p_project_id uuid, p_days integer default 30)
returns table (
  task public.ai_task,
  provider text,
  model text,
  calls bigint,
  errors bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  unpriced_calls bigint,
  cost_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select u.task, u.provider, u.model,
         count(*) as calls,
         count(*) filter (where u.status <> 'success') as errors,
         coalesce(sum(u.input_tokens), 0) as input_tokens,
         coalesce(sum(u.output_tokens), 0) as output_tokens,
         coalesce(sum(u.cache_read_tokens), 0) as cache_read_tokens,
         coalesce(sum(u.cache_write_tokens), 0) as cache_write_tokens,
         count(*) filter (where u.cost_usd is null and (u.input_tokens + u.output_tokens) > 0) as unpriced_calls,
         sum(u.cost_usd) as cost_usd
  from public.ai_usage u
  where u.project_id = p_project_id
    and u.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  group by u.task, u.provider, u.model
  order by u.task, cost_usd desc nulls last
$$;
revoke execute on function public.ai_usage_summary(uuid, integer) from public, anon;
grant execute on function public.ai_usage_summary(uuid, integer) to authenticated, service_role;

-- 4. A script must belong to its story's project: report NOT_FOUND instead of a
--    misleading unique violation on (story_id, version).
create or replace function private.scripts_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- serialize version assignment per story (and prove the story is in this project)
  perform 1 from public.stories s where s.id = new.story_id and s.project_id = new.project_id for update;
  if not found then
    raise exception 'NOT_FOUND: story not found in this project' using errcode = 'P0001';
  end if;

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
