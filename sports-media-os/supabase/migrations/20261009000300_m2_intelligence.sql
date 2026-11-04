-- =============================================================================
-- Sports Media OS — M2 / 0300 intelligence, research, workflow, AI ledger
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Connectors (RSS / JSON API) → sources or events
-- -----------------------------------------------------------------------------
create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind public.connector_kind not null,
  url text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  target text not null default 'sources' check (target in ('sources', 'events')),
  sport_id uuid references public.sports (id) on delete set null,
  -- json_api field mapping, e.g. {"itemsPath":"data.items","titlePath":"headline",…}
  config jsonb not null default '{}'::jsonb,
  credibility public.probability,
  default_license public.license_status not null default 'unknown',
  enabled boolean not null default true,
  fetch_interval_minutes integer not null default 60 check (fetch_interval_minutes between 15 and 1440),
  last_fetched_at timestamptz,
  last_status text check (last_status is null or last_status in ('ok', 'not_modified', 'error')),
  last_error text,
  last_item_count integer check (last_item_count is null or last_item_count >= 0),
  etag text,
  last_modified text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, url)
);
create index connectors_due_idx on public.connectors (enabled, last_fetched_at);

create trigger set_updated_at before update on public.connectors
  for each row execute function private.set_updated_at();

alter table public.sources
  add column connector_id uuid,
  add column signals public.radar_signal[] not null default '{}',
  add column language text,
  add constraint sources_connector_fk foreign key (connector_id, project_id)
    references public.connectors (id, project_id) on delete set null (connector_id);
create index sources_content_hash_idx on public.sources (project_id, content_hash) where content_hash is not null;
create index sources_connector_idx on public.sources (connector_id) where connector_id is not null;

alter table public.events
  add column connector_id uuid,
  add constraint events_connector_fk foreign key (connector_id, project_id)
    references public.connectors (id, project_id) on delete set null (connector_id);

-- -----------------------------------------------------------------------------
-- 2. Radar / trend metrics (all explainable, stored with their explanation)
-- -----------------------------------------------------------------------------
alter table public.trends
  add column curiosity_score public.score,
  add column competition_level public.competition_level,
  add column publisher_count integer check (publisher_count is null or publisher_count >= 0),
  add column source_count integer check (source_count is null or source_count >= 0),
  add column signals public.radar_signal[] not null default '{}',
  add column radar_score public.score,
  add column is_sweet_spot boolean not null default false,
  add column radar_explanation jsonb;
create index trends_radar_idx on public.trends (project_id, is_sweet_spot, radar_score desc nulls last);

alter table public.opportunities
  add column score_coverage numeric(5, 2) check (score_coverage is null or score_coverage between 0 and 100),
  add column scoring_version text,
  add column signals public.radar_signal[] not null default '{}',
  add column competition_level public.competition_level,
  add column is_sweet_spot boolean not null default false;

-- -----------------------------------------------------------------------------
-- 3. Claims ↔ sources (every important claim links to its evidence)
-- -----------------------------------------------------------------------------
alter table public.facts
  drop column source_id,
  add column ai_suggestion jsonb,
  add constraint facts_id_project_key unique (id, project_id);

create table public.fact_sources (
  fact_id uuid not null,
  source_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  relation public.claim_relation not null default 'supports',
  excerpt text check (excerpt is null or char_length(excerpt) <= 1000),
  locator text check (locator is null or char_length(locator) <= 200),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (fact_id, source_id),
  foreign key (fact_id, project_id) references public.facts (id, project_id) on delete cascade,
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade
);
create index fact_sources_source_idx on public.fact_sources (source_id);

-- A critical claim can be CONFIRMED only with at least one supporting source.
create or replace function private.facts_confirmation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and new.is_critical
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed' or old.is_critical is distinct from true)
     and not exists (
       select 1 from public.fact_sources fs
       where fs.fact_id = new.id and fs.relation = 'supports'
     ) then
    raise exception 'CLAIM_UNSOURCED: a critical claim needs at least one supporting source before it can be confirmed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger facts_confirmation_guard
  before insert or update of status, is_critical on public.facts
  for each row execute function private.facts_confirmation_guard();

-- Removing the last supporting source of a confirmed critical claim downgrades it:
-- evidence gone → the claim is no longer verified (fails safe at the READY gate).
create or replace function private.fact_sources_downgrade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.relation = 'supports' and not exists (
    select 1 from public.fact_sources fs
    where fs.fact_id = old.fact_id and fs.relation = 'supports'
      and not (fs.source_id = old.source_id and tg_op = 'DELETE')
  ) then
    update public.facts set status = 'uncertain'
    where id = old.fact_id and status = 'confirmed' and is_critical;
  end if;
  return null;
end;
$$;

create trigger fact_sources_downgrade
  after delete or update of relation on public.fact_sources
  for each row execute function private.fact_sources_downgrade();

-- -----------------------------------------------------------------------------
-- 4. Research workspace integrity
-- -----------------------------------------------------------------------------
alter table public.research_items
  add constraint research_items_attribution_check check (
    item_type not in ('quote', 'media', 'competitor') or source_id is not null or url is not null
  );

-- -----------------------------------------------------------------------------
-- 5. Stories, scripts, hooks (STORY ≠ FOOTAGE)
-- -----------------------------------------------------------------------------
alter table public.stories
  add column production_formats public.editorial_format[] not null default '{}';

alter table public.scripts
  add column angle public.script_angle,
  add column facts_used uuid[] not null default '{}',
  add column warnings text[] not null default '{}',
  add column language text;
create index scripts_story_angle_idx on public.scripts (story_id, angle, version desc);

alter table public.hooks
  add column angle public.script_angle;

-- -----------------------------------------------------------------------------
-- 6. Human checkpoints: one RPC records the decision and applies it atomically
-- -----------------------------------------------------------------------------
create or replace function private.latest_decision(p_entity_type text, p_entity_id uuid, p_checkpoint public.approval_checkpoint)
returns public.approval_decision
language sql
stable
security definer
set search_path = ''
as $$
  select a.decision from public.approvals a
  where a.entity_type = p_entity_type and a.entity_id = p_entity_id and a.checkpoint = p_checkpoint
  order by a.created_at desc, a.id desc
  limit 1
$$;
grant execute on function private.latest_decision(text, uuid, public.approval_checkpoint) to authenticated, service_role;

create or replace function public.record_approval(
  p_checkpoint public.approval_checkpoint,
  p_entity_id uuid,
  p_decision public.approval_decision,
  p_notes text default null
)
returns public.approvals
language plpgsql
set search_path = ''
as $$
declare
  v_project uuid;
  v_entity_type text;
  v_status public.rights_status;
  v_latest uuid;
  a public.approvals;
begin
  if auth.uid() is null then
    raise exception 'APPROVAL_REQUIRES_HUMAN: approvals are recorded by a signed-in person' using errcode = 'P0001';
  end if;

  case p_checkpoint
    when 'opportunity' then
      select o.project_id into v_project from public.opportunities o where o.id = p_entity_id;
      v_entity_type := 'opportunity';
    when 'story' then
      select s.project_id into v_project from public.stories s where s.id = p_entity_id;
      v_entity_type := 'story';
    when 'script' then
      select s.project_id into v_project from public.scripts s where s.id = p_entity_id;
      v_entity_type := 'script';
    when 'production' then
      select c.project_id into v_project from public.content_items c where c.id = p_entity_id;
      v_entity_type := 'content_item';
    when 'publishing' then
      select j.project_id into v_project from public.publishing_jobs j where j.id = p_entity_id;
      v_entity_type := 'publishing_job';
    when 'rights' then
      select rc.project_id, rc.status into v_project, v_status from public.rights_checks rc where rc.id = p_entity_id;
      v_entity_type := 'rights_check';
      if v_project is not null then
        if v_status <> 'yellow' then
          raise exception 'RIGHTS_APPROVAL_INVALID: only YELLOW classifications need a usage approval (this one is %)', v_status
            using errcode = 'P0001';
        end if;
        select coalesce(v.rights_check_id, s.rights_check_id) into v_latest
        from public.rights_checks rc
        left join public.videos v on v.id = rc.video_id
        left join public.sources s on s.id = rc.source_id
        where rc.id = p_entity_id;
        if v_latest is distinct from p_entity_id then
          raise exception 'RIGHTS_APPROVAL_INVALID: a newer classification exists for this asset' using errcode = 'P0001';
        end if;
      end if;
  end case;

  if v_project is null then
    raise exception 'NOT_FOUND: item not found' using errcode = 'P0001';
  end if;

  insert into public.approvals (project_id, checkpoint, entity_type, entity_id, decision, notes, decided_by)
  values (v_project, p_checkpoint, v_entity_type, p_entity_id, p_decision, nullif(trim(p_notes), ''), auth.uid())
  returning * into a;

  if p_checkpoint = 'opportunity' then
    update public.opportunities
    set status = case when p_decision = 'approved' then 'approved'::public.opportunity_status
                      else 'rejected'::public.opportunity_status end
    where id = p_entity_id;
  elsif p_checkpoint = 'story' then
    update public.stories
    set status = case when p_decision = 'approved' then 'approved'::public.story_status
                      else 'rejected'::public.story_status end
    where id = p_entity_id;
  end if;

  return a;
end;
$$;
revoke execute on function public.record_approval(public.approval_checkpoint, uuid, public.approval_decision, text) from public, anon;
grant execute on function public.record_approval(public.approval_checkpoint, uuid, public.approval_decision, text) to authenticated;

-- Status changes to approved/rejected must be backed by a matching human decision
create or replace function private.require_approval_for_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entity_type text := tg_argv[0];
  v_checkpoint public.approval_checkpoint := tg_argv[1]::public.approval_checkpoint;
  v_decision public.approval_decision;
begin
  if new.status::text in ('approved', 'rejected')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    v_decision := private.latest_decision(v_entity_type, new.id, v_checkpoint);
    if v_decision is null or v_decision::text <> new.status::text then
      raise exception 'APPROVAL_REQUIRED: % must be %ed through a human approval checkpoint', v_entity_type,
        case when new.status::text = 'approved' then 'approv' else 'reject' end
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunities_require_approval
  before insert or update of status on public.opportunities
  for each row execute function private.require_approval_for_status('opportunity', 'opportunity');

create trigger stories_require_approval
  before insert or update of status on public.stories
  for each row execute function private.require_approval_for_status('story', 'story');

-- -----------------------------------------------------------------------------
-- 7. Content workflow: PRODUCTION and later need an APPROVED current script
-- -----------------------------------------------------------------------------
create or replace function private.content_script_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_script uuid;
begin
  if new.stage in ('production', 'ready', 'scheduled', 'published', 'analyzing')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage) then
    if new.story_id is null then
      raise exception 'SCRIPT_NOT_APPROVED: link a story with an approved script before production' using errcode = 'P0001';
    end if;
    select s.id into v_script from public.scripts s where s.story_id = new.story_id and s.is_current;
    if v_script is null or private.latest_decision('script', v_script, 'script') is distinct from 'approved' then
      raise exception 'SCRIPT_NOT_APPROVED: the current script must be approved before production' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger content_items_script_gate
  before insert or update of stage on public.content_items
  for each row execute function private.content_script_gate();

-- -----------------------------------------------------------------------------
-- 8. AI ledger: every model call, its cost and outcome (written by workers)
-- -----------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  task public.ai_task not null,
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 100),
  job_id uuid references public.jobs (id) on delete set null,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  attempt smallint not null default 1 check (attempt between 1 and 10),
  status text not null check (status in ('success', 'error', 'refused')),
  error_code text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index ai_usage_project_created_idx on public.ai_usage (project_id, created_at desc);
create index ai_usage_task_created_idx on public.ai_usage (task, created_at desc);

-- -----------------------------------------------------------------------------
-- 9. RLS for the new tables
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.connectors, public.fact_sources to authenticated;
grant select on public.ai_usage to authenticated;
-- Supabase default privileges grant ALL on new tables; the ledger is worker-written only
revoke insert, update, delete, truncate on public.ai_usage from authenticated;
grant all on public.connectors, public.fact_sources, public.ai_usage to service_role;
revoke all on public.connectors, public.fact_sources, public.ai_usage from anon;

do $$
declare
  t text;
begin
  foreach t in array array['connectors', 'fact_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "members can read" on public.%I for select to authenticated
         using (project_id in (select private.project_ids_for_role(''viewer'')))', t);
    execute format(
      'create policy "editors can insert" on public.%I for insert to authenticated
         with check (project_id in (select private.project_ids_for_role(''editor'')))', t);
    execute format(
      'create policy "editors can update" on public.%I for update to authenticated
         using (project_id in (select private.project_ids_for_role(''editor'')))
         with check (project_id in (select private.project_ids_for_role(''editor'')))', t);
    execute format(
      'create policy "editors can delete" on public.%I for delete to authenticated
         using (project_id in (select private.project_ids_for_role(''editor'')))', t);
  end loop;
end;
$$;

alter table public.ai_usage enable row level security;
create policy "read ai usage" on public.ai_usage for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );

-- AI usage summary for Settings (last N days, per task and model)
create or replace function public.ai_usage_summary(p_project_id uuid, p_days integer default 30)
returns table (
  task public.ai_task,
  provider text,
  model text,
  calls bigint,
  errors bigint,
  input_tokens bigint,
  output_tokens bigint,
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
         sum(u.cost_usd) as cost_usd
  from public.ai_usage u
  where u.project_id = p_project_id
    and u.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  group by u.task, u.provider, u.model
  order by u.task, cost_usd desc nulls last
$$;
revoke execute on function public.ai_usage_summary(uuid, integer) from public, anon;
grant execute on function public.ai_usage_summary(uuid, integer) to authenticated, service_role;

-- workers record runs for the Agent Center; humans only read them (M1 grants)
