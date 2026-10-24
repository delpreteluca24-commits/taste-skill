-- =============================================================================
-- Sports Media OS — 0100 foundation
-- Types, helper functions, identity (users / projects / members), reference
-- data (sports), settings, activity log and the persistent job queue.
-- =============================================================================

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Domains (shared numeric conventions)
--   score       0..100   every human-readable score (opportunity, virality …)
--   probability 0..1     confidence / credibility
-- -----------------------------------------------------------------------------
create domain public.score as numeric(5, 2) check (value >= 0 and value <= 100);
create domain public.probability as numeric(4, 3) check (value >= 0 and value <= 1);

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('member', 'admin', 'owner');
-- order matters: comparisons use declaration order (viewer < editor < admin < owner)
create type public.member_role as enum ('viewer', 'editor', 'admin', 'owner');
create type public.project_status as enum ('active', 'paused', 'archived');
create type public.job_status as enum ('pending', 'running', 'completed', 'failed', 'cancelled');
create type public.source_type as enum ('news', 'rss', 'api', 'social', 'video', 'official', 'press_release', 'other');
create type public.license_status as enum ('unknown', 'owned', 'licensed', 'public_domain', 'creative_commons', 'fair_use_review', 'restricted');
create type public.event_status as enum ('scheduled', 'live', 'finished', 'postponed', 'cancelled');
create type public.trend_status as enum ('emerging', 'rising', 'peaking', 'declining', 'expired');
create type public.opportunity_status as enum ('new', 'researching', 'approved', 'rejected', 'production', 'ready', 'published', 'archived');
create type public.research_item_type as enum ('article', 'video', 'quote', 'timeline', 'note', 'question', 'context');
create type public.fact_status as enum ('confirmed', 'probable', 'uncertain', 'false');
create type public.rights_status as enum ('unchecked', 'green', 'yellow', 'red');
create type public.story_status as enum ('draft', 'review', 'approved', 'rejected');
create type public.script_operation as enum ('generate', 'regenerate', 'shorten', 'expand', 'rewrite_hook', 'change_tone', 'manual');
create type public.hook_type as enum ('curiosity', 'controversial', 'shock', 'mystery', 'story', 'statistical');
create type public.video_status as enum ('uploaded', 'processing', 'analyzed', 'failed');
create type public.segment_type as enum ('transcript', 'scene', 'candidate');
create type public.clip_status as enum ('candidate', 'approved', 'rejected', 'rendering', 'rendered', 'failed');
create type public.reframe_mode as enum ('speaker', 'face', 'subject', 'center');
create type public.caption_format as enum ('srt', 'ass');
create type public.caption_preset as enum ('clean', 'bold', 'creator');
create type public.thumbnail_status as enum ('concept', 'selected', 'generated', 'rejected');
create type public.content_format as enum ('short', 'long', 'post');
create type public.content_stage as enum ('idea', 'research', 'script', 'production', 'review', 'ready', 'scheduled', 'published', 'analyzing');
create type public.platform as enum ('youtube', 'tiktok', 'instagram');
create type public.connection_status as enum ('not_connected', 'connected', 'expired', 'error');
create type public.publish_mode as enum ('manual_export', 'api');
create type public.agent_key as enum (
  'orchestrator', 'sports_radar', 'trend_hunter', 'researcher', 'fact_checker', 'rights',
  'story', 'hook', 'editor', 'thumbnail', 'publisher', 'analytics', 'ceo'
);
create type public.task_status as enum ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled');
create type public.run_trigger as enum ('manual', 'schedule', 'orchestrator', 'event');
create type public.actor_type as enum ('user', 'agent', 'system');
create type public.log_status as enum ('info', 'success', 'warning', 'failed');
create type public.approval_checkpoint as enum ('opportunity', 'story', 'production', 'publishing');
create type public.approval_decision as enum ('approved', 'rejected');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_valid_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- users — application profile mirrored from auth.users
-- -----------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  avatar_url text,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on public.users (lower(email));

-- The first account becomes the workspace owner (V1 is single-owner).
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    case when exists (select 1 from public.users where role = 'owner')
      then 'member'::public.app_role else 'owner'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- reference data: sports (global, admin-managed)
-- -----------------------------------------------------------------------------
create table public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- projects (channels) and membership
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  description text check (description is null or char_length(description) <= 500),
  primary_sport_id uuid references public.sports (id) on delete set null,
  language text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  timezone text not null default 'UTC' check (private.is_valid_timezone(timezone)),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  status public.project_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);
create index projects_owner_idx on public.projects (owner_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create or replace function private.add_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (project_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger projects_add_owner_membership
  after insert on public.projects
  for each row execute function private.add_project_owner_membership();

-- -----------------------------------------------------------------------------
-- Authorization helpers used by RLS.
-- SECURITY DEFINER avoids recursive RLS on project_members; they only ever
-- answer questions about the *calling* user (auth.uid()).
-- Policies use `project_id in (select private.project_ids_for_role(...))`
-- so the set is computed once per statement (initPlan), not per row.
-- -----------------------------------------------------------------------------
create or replace function private.project_ids_for_role(min_role public.member_role default 'viewer')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pm.project_id
  from public.project_members pm
  where pm.user_id = (select auth.uid())
    and pm.role >= min_role
$$;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.role in ('admin', 'owner')
  )
$$;

grant execute on function private.project_ids_for_role(public.member_role) to authenticated, service_role;
grant execute on function private.is_app_admin() to authenticated, service_role;
grant execute on function private.is_valid_timezone(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- settings — key/value overrides. Defaults live in code (lib/settings).
-- project_id null = workspace-wide setting.
-- Secrets (API keys, tokens) NEVER go here: they live in server env / vault.
-- -----------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and char_length(key) <= 120),
  value jsonb not null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index settings_global_key on public.settings (key) where project_id is null;
create unique index settings_project_key on public.settings (project_id, key) where project_id is not null;

-- -----------------------------------------------------------------------------
-- activity_logs — append-only audit trail (users, agents, system)
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  actor_type public.actor_type not null,
  actor_id uuid references public.users (id) on delete set null,
  agent public.agent_key,
  action text not null check (char_length(action) between 1 and 120),
  entity_type text,
  entity_id uuid,
  input_ref jsonb,
  output_ref jsonb,
  status public.log_status not null default 'info',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (actor_type <> 'agent' or agent is not null)
);
create index activity_logs_project_created_idx on public.activity_logs (project_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- jobs — persistent async queue (video processing, agent runs, exports…).
-- Claimed by workers with FOR UPDATE SKIP LOCKED (see 0500_jobs.sql).
-- -----------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+(\.[a-z_]+)*$' and char_length(type) <= 80),
  status public.job_status not null default 'pending',
  priority smallint not null default 50 check (priority between 0 and 100),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  idempotency_key text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index jobs_idempotency_key on public.jobs (idempotency_key) where idempotency_key is not null;
create index jobs_claim_idx on public.jobs (priority desc, run_after, created_at) where status = 'pending';
create index jobs_project_status_idx on public.jobs (project_id, status, created_at desc);
create index jobs_running_locked_idx on public.jobs (locked_at) where status = 'running';
