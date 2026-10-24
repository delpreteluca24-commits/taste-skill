-- =============================================================================
-- Sports Media OS — 0700 read models for the control room
-- One RPC returns every dashboard section in a single round trip.
-- SECURITY INVOKER: RLS applies, a non-member gets NOT_FOUND.
-- =============================================================================

-- Latest analytics snapshot per content item and platform
create or replace view public.content_latest_metrics
with (security_invoker = true)
as
select distinct on (a.content_item_id, a.platform)
  a.project_id,
  a.content_item_id,
  a.platform,
  a.captured_at,
  a.views,
  a.likes,
  a.comments,
  a.shares,
  a.subscribers_gained,
  a.watch_time_sec,
  a.avg_percentage_viewed,
  a.ctr
from public.analytics a
order by a.content_item_id, a.platform, a.captured_at desc;

revoke all on public.content_latest_metrics from anon;
grant select on public.content_latest_metrics to authenticated, service_role;

create or replace function public.get_dashboard(p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_day_start timestamptz;
  v_result jsonb;
begin
  select p.timezone into v_tz from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'NOT_FOUND: project not found' using errcode = 'P0001';
  end if;
  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,

    'metrics', jsonb_build_object(
      'views', coalesce((
        select sum(m.views) from public.content_latest_metrics m
        where m.project_id = p_project_id), 0),
      'clips_created', (
        select count(*) from public.clips c
        where c.project_id = p_project_id and c.status = 'rendered'),
      'content_published', (
        select count(*) from public.content_items ci
        where ci.project_id = p_project_id and ci.stage in ('published', 'analyzing')),
      'top_opportunity_score', (
        select max(o.opportunity_score) from public.opportunities o
        where o.project_id = p_project_id and o.status not in ('rejected', 'archived')),
      'avg_virality_score', (
        select round(avg(c.virality_score), 1) from public.clips c
        where c.project_id = p_project_id and c.status <> 'rejected' and c.virality_score is not null),
      'production_queue', (
        select count(*) from public.content_items ci
        where ci.project_id = p_project_id and ci.stage in ('script', 'production', 'review'))
    ),

    'pipeline', coalesce((
      select jsonb_object_agg(s.stage, s.n)
      from (
        select ci.stage, count(*) as n from public.content_items ci
        where ci.project_id = p_project_id group by ci.stage
      ) s), '{}'::jsonb),

    'todays_opportunities', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select o.id, o.title, o.status, o.opportunity_score, o.competition, o.created_at
        from public.opportunities o
        where o.project_id = p_project_id and o.created_at >= v_day_start
        order by o.opportunity_score desc nulls last, o.created_at desc
        limit 5
      ) x), '[]'::jsonb),

    'top_opportunities', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select o.id, o.title, o.status, o.opportunity_score, o.competition, o.why_now, o.created_at
        from public.opportunities o
        where o.project_id = p_project_id and o.status in ('new', 'researching', 'approved')
        order by o.opportunity_score desc nulls last, o.created_at desc
        limit 5
      ) x), '[]'::jsonb),

    'trending_stories', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select t.id, t.title, t.status, t.trend_score, t.keywords, t.last_seen_at
        from public.trends t
        where t.project_id = p_project_id and t.status in ('emerging', 'rising', 'peaking')
        order by t.trend_score desc nulls last, t.last_seen_at desc
        limit 5
      ) x), '[]'::jsonb),

    'content_in_production', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select ci.id, ci.title, ci.stage, ci.format, ci.stage_changed_at
        from public.content_items ci
        where ci.project_id = p_project_id and ci.stage in ('script', 'production', 'review')
        order by ci.stage_changed_at desc
        limit 6
      ) x), '[]'::jsonb),

    'ready_to_publish', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select ci.id, ci.title, ci.stage, ci.scheduled_at, ci.target_platforms
        from public.content_items ci
        where ci.project_id = p_project_id and ci.stage in ('ready', 'scheduled')
        order by ci.scheduled_at nulls last, ci.stage_changed_at desc
        limit 6
      ) x), '[]'::jsonb),

    'published', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select ci.id, ci.title, ci.stage, ci.published_at, ci.target_platforms
        from public.content_items ci
        where ci.project_id = p_project_id and ci.stage in ('published', 'analyzing')
        order by ci.published_at desc nulls last
        limit 5
      ) x), '[]'::jsonb),

    'performing_content', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select ci.id, ci.title, ci.predicted_score, ci.published_at,
               sum(m.views) as views, sum(m.likes) as likes, sum(m.shares) as shares
        from public.content_latest_metrics m
        join public.content_items ci on ci.id = m.content_item_id
        where m.project_id = p_project_id
        group by ci.id, ci.title, ci.predicted_score, ci.published_at
        order by sum(m.views) desc nulls last
        limit 5
      ) x), '[]'::jsonb),

    'agent_status', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select distinct on (r.agent)
          r.agent, r.status, r.started_at, r.finished_at, r.error_message, r.created_at,
          (select count(*) from public.agent_runs f
            where f.agent = r.agent
              and (f.project_id = p_project_id or f.project_id is null)
              and f.status = 'failed'
              and f.created_at >= now() - interval '24 hours') as failures_24h
        from public.agent_runs r
        where r.project_id = p_project_id or r.project_id is null
        order by r.agent, r.created_at desc
      ) x), '[]'::jsonb),

    -- cumulative views at the end of each day (latest snapshot before day end)
    'recent_performance', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char(d.day at time zone v_tz, 'YYYY-MM-DD'),
        'published', (
          select count(*) from public.content_items ci
          where ci.project_id = p_project_id
            and ci.published_at >= d.day and ci.published_at < d.day + interval '1 day'),
        'views', (
          select coalesce(sum(s.views), 0) from (
            select distinct on (a.content_item_id, a.platform) a.views
            from public.analytics a
            where a.project_id = p_project_id and a.captured_at < d.day + interval '1 day'
            order by a.content_item_id, a.platform, a.captured_at desc
          ) s)
      ) order by d.day)
      from generate_series(v_day_start - interval '13 days', v_day_start, interval '1 day') as d(day)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_dashboard(uuid) from public, anon;
grant execute on function public.get_dashboard(uuid) to authenticated, service_role;
