-- =============================================================================
-- M2 · Start production atomically
-- APPROVED opportunity → story + content item (stage 'research', format 'short')
-- and opportunity → 'production', in ONE transaction (no orphan stories).
-- SECURITY INVOKER: RLS decides who may do it (editors of the project).
-- =============================================================================

create or replace function public.start_production(p_opportunity_id uuid)
returns table (content_item_id uuid, story_id uuid, existing boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.opportunities;
  v_story uuid;
  v_item uuid;
begin
  -- row lock: two concurrent clicks cannot create two stories
  select * into o from public.opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'NOT_FOUND: opportunity' using errcode = 'P0001';
  end if;

  if o.status in ('production', 'ready', 'published') then
    select ci.id, ci.story_id into v_item, v_story
    from public.content_items ci
    where ci.opportunity_id = o.id and ci.project_id = o.project_id
    order by ci.created_at
    limit 1;
    if v_item is not null then
      return query select v_item, v_story, true;
      return;
    end if;
    -- in production but its content item was deleted: recreate it below
  elsif o.status <> 'approved' then
    raise exception 'APPROVAL_REQUIRED: approve the opportunity before starting production' using errcode = 'P0001';
  end if;

  insert into public.stories (project_id, opportunity_id, title, logline, angle, created_by, metadata)
  values (
    o.project_id, o.id, o.title,
    left(coalesce(o.description, o.why_now), 1000),
    o.angle, auth.uid(),
    jsonb_build_object('created_from', 'opportunity', 'hook', o.hook)
  )
  returning id into v_story;

  insert into public.content_items (project_id, opportunity_id, story_id, title, description, format, stage, created_by)
  values (o.project_id, o.id, v_story, o.title, o.description, 'short', 'research', auth.uid())
  returning id into v_item;

  if o.status = 'approved' then
    update public.opportunities set status = 'production' where id = o.id;
  end if;

  return query select v_item, v_story, false;
end;
$$;
revoke execute on function public.start_production(uuid) from public, anon;
grant execute on function public.start_production(uuid) to authenticated, service_role;
