-- =============================================================================
-- Sports Media OS — 0200 domain tables
-- Every project-scoped table carries project_id and exposes unique (id, project_id)
-- so children reference parents with COMPOSITE foreign keys: a row can never link
-- to a row of another project (RI checks bypass RLS, composite FKs close that gap).
-- `on delete set null (col)` (PG15+) nulls only the link column, never project_id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- INTEL: events → sources → trends → opportunities
-- -----------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sport_id uuid references public.sports (id) on delete set null,
  competition text check (competition is null or char_length(competition) <= 120),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status public.event_status not null default 'scheduled',
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  importance public.score,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create unique index events_external_id_key on public.events (project_id, external_id) where external_id is not null;
create index events_project_starts_idx on public.events (project_id, starts_at desc);
create index events_project_sport_idx on public.events (project_id, sport_id);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sport_id uuid references public.sports (id) on delete set null,
  event_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  title text,
  url text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  source_type public.source_type not null default 'news',
  author text,
  summary text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  credibility public.probability,
  license_status public.license_status not null default 'unknown',
  rights_status public.rights_status not null default 'unchecked',
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, url),
  foreign key (event_id, project_id) references public.events (id, project_id) on delete set null (event_id)
);
create index sources_project_published_idx on public.sources (project_id, published_at desc nulls last);
create index sources_event_idx on public.sources (event_id) where event_id is not null;

create table public.trends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sport_id uuid references public.sports (id) on delete set null,
  event_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  keywords text[] not null default '{}',
  trend_score public.score,
  velocity numeric(10, 3),
  volume integer check (volume is null or volume >= 0),
  status public.trend_status not null default 'emerging',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (event_id, project_id) references public.events (id, project_id) on delete set null (event_id)
);
create index trends_project_status_score_idx on public.trends (project_id, status, trend_score desc nulls last);
create index trends_project_last_seen_idx on public.trends (project_id, last_seen_at desc);

-- Source → Trend normalization link
create table public.trend_sources (
  trend_id uuid not null,
  source_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trend_id, source_id),
  foreign key (trend_id, project_id) references public.trends (id, project_id) on delete cascade,
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade
);
create index trend_sources_source_idx on public.trend_sources (source_id);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sport_id uuid references public.sports (id) on delete set null,
  event_id uuid,
  trend_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  why_now text,
  angle text,
  hook text,
  competition text check (competition is null or char_length(competition) <= 120),
  -- score components (0..100); weights live in lib/scoring
  trend_score public.score,
  timeliness_score public.score,
  curiosity_score public.score,
  audience_score public.score,
  competition_gap_score public.score,
  originality_score public.score,
  production_feasibility_score public.score,
  rights_score public.score,
  monetization_score public.score,
  opportunity_score public.score,
  score_explanation jsonb,
  scored_at timestamptz,
  status public.opportunity_status not null default 'new',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (event_id, project_id) references public.events (id, project_id) on delete set null (event_id),
  foreign key (trend_id, project_id) references public.trends (id, project_id) on delete set null (trend_id)
);
create index opportunities_project_status_score_idx on public.opportunities (project_id, status, opportunity_score desc nulls last);
create index opportunities_project_created_idx on public.opportunities (project_id, created_at desc);

create table public.research_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid not null,
  source_id uuid,
  item_type public.research_item_type not null,
  title text,
  content text,
  url text check (url is null or url ~* '^https?://'),
  occurred_at timestamptz,
  position integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_by_agent public.agent_key,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, project_id) references public.opportunities (id, project_id) on delete cascade,
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete set null (source_id)
);
create index research_items_opportunity_idx on public.research_items (opportunity_id, item_type, position);

-- -----------------------------------------------------------------------------
-- STORY: stories → scripts (immutable versions) → hooks
-- -----------------------------------------------------------------------------
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  logline text,
  angle text,
  status public.story_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (opportunity_id, project_id) references public.opportunities (id, project_id) on delete set null (opportunity_id)
);
create index stories_project_status_idx on public.stories (project_id, status, updated_at desc);
create index stories_opportunity_idx on public.stories (opportunity_id) where opportunity_id is not null;

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  story_id uuid not null,
  version integer not null check (version > 0),
  parent_script_id uuid references public.scripts (id) on delete set null,
  operation public.script_operation not null default 'manual',
  hook text,
  context text,
  escalation text,
  reveal text,
  payoff text,
  cta text,
  full_text text,
  tone text,
  target_duration_sec integer check (target_duration_sec is null or target_duration_sec between 5 and 7200),
  word_count integer check (word_count is null or word_count >= 0),
  is_current boolean not null default false,
  provider text,
  model text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (story_id, version),
  foreign key (story_id, project_id) references public.stories (id, project_id) on delete cascade
);
create unique index scripts_one_current_per_story on public.scripts (story_id) where is_current;

create table public.hooks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid,
  story_id uuid,
  script_id uuid,
  hook_type public.hook_type not null,
  text text not null check (char_length(text) between 1 and 500),
  score public.score,
  score_explanation jsonb,
  is_selected boolean not null default false,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opportunity_id is not null or story_id is not null),
  foreign key (opportunity_id, project_id) references public.opportunities (id, project_id) on delete cascade,
  foreign key (story_id, project_id) references public.stories (id, project_id) on delete cascade,
  foreign key (script_id, project_id) references public.scripts (id, project_id) on delete set null (script_id)
);
create index hooks_story_idx on public.hooks (story_id, score desc nulls last);
create index hooks_opportunity_idx on public.hooks (opportunity_id, score desc nulls last);

-- -----------------------------------------------------------------------------
-- MEDIA: videos → video_segments → clips → captions
-- -----------------------------------------------------------------------------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  original_filename text,
  storage_bucket text not null default 'videos',
  storage_path text not null,
  mime_type text,
  container text check (container is null or container in ('mp4', 'mov', 'mkv', 'webm')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  duration_sec numeric(10, 3) check (duration_sec is null or duration_sec >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  fps numeric(7, 3),
  has_audio boolean,
  language text,
  audio_path text,
  transcript_path text,
  status public.video_status not null default 'uploaded',
  rights_status public.rights_status not null default 'unchecked',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (storage_bucket, storage_path),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete set null (source_id)
);
create index videos_project_created_idx on public.videos (project_id, created_at desc);

create table public.video_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  video_id uuid not null,
  segment_type public.segment_type not null,
  start_sec numeric(10, 3) not null check (start_sec >= 0),
  end_sec numeric(10, 3) not null,
  text text,
  speaker text,
  heuristic_score public.score,
  ai_score public.score,
  features jsonb not null default '{}'::jsonb,
  rank integer,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  check (end_sec > start_sec),
  foreign key (video_id, project_id) references public.videos (id, project_id) on delete cascade
);
create index video_segments_video_type_start_idx on public.video_segments (video_id, segment_type, start_sec);

-- -----------------------------------------------------------------------------
-- CONTENT: the production unit that moves across the Kanban pipeline
-- -----------------------------------------------------------------------------
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid,
  story_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  format public.content_format not null default 'short',
  stage public.content_stage not null default 'idea',
  position double precision not null default 0,
  target_platforms public.platform[] not null default '{}',
  scheduled_at timestamptz,
  published_at timestamptz,
  predicted_score public.score,
  stage_changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (opportunity_id, project_id) references public.opportunities (id, project_id) on delete set null (opportunity_id),
  foreign key (story_id, project_id) references public.stories (id, project_id) on delete set null (story_id)
);
create index content_items_project_stage_idx on public.content_items (project_id, stage, position);
create index content_items_project_scheduled_idx on public.content_items (project_id, scheduled_at) where scheduled_at is not null;
create index content_items_opportunity_idx on public.content_items (opportunity_id) where opportunity_id is not null;
create index content_items_story_idx on public.content_items (story_id) where story_id is not null;

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  video_id uuid not null,
  segment_id uuid,
  content_item_id uuid,
  start_sec numeric(10, 3) not null check (start_sec >= 0),
  end_sec numeric(10, 3) not null,
  duration_sec numeric(10, 3) generated always as (end_sec - start_sec) stored,
  virality_score public.score,
  virality_breakdown jsonb not null default '{}'::jsonb,
  reason text,
  hook text,
  title text,
  status public.clip_status not null default 'candidate',
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '1:1', '4:5', '16:9')),
  width integer not null default 1080 check (width > 0),
  height integer not null default 1920 check (height > 0),
  reframe_mode public.reframe_mode not null default 'speaker',
  reframe_data jsonb,
  edit_settings jsonb not null default '{}'::jsonb,
  output_path text,
  preview_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  check (end_sec > start_sec),
  foreign key (video_id, project_id) references public.videos (id, project_id) on delete cascade,
  foreign key (segment_id, project_id) references public.video_segments (id, project_id) on delete set null (segment_id),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete set null (content_item_id)
);
create index clips_project_status_score_idx on public.clips (project_id, status, virality_score desc nulls last);
create index clips_video_start_idx on public.clips (video_id, start_sec);
create index clips_content_item_idx on public.clips (content_item_id) where content_item_id is not null;

create table public.captions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  clip_id uuid not null,
  format public.caption_format not null,
  preset public.caption_preset not null default 'clean',
  language text,
  position text not null default 'bottom' check (position in ('top', 'center', 'bottom')),
  max_lines smallint not null default 2 check (max_lines between 1 and 2),
  word_highlight boolean not null default true,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clip_id, project_id) references public.clips (id, project_id) on delete cascade
);
create index captions_clip_idx on public.captions (clip_id);

-- -----------------------------------------------------------------------------
-- PACKAGING: thumbnails, titles
-- -----------------------------------------------------------------------------
create table public.thumbnails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  content_item_id uuid not null,
  clip_id uuid,
  headline text not null check (char_length(headline) between 1 and 120),
  visual_concept text,
  subject text,
  emotion text,
  contrast text,
  curiosity_angle text,
  image_prompt text,
  storage_path text,
  status public.thumbnail_status not null default 'concept',
  score public.score,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete cascade,
  foreign key (clip_id, project_id) references public.clips (id, project_id) on delete set null (clip_id)
);
create index thumbnails_content_item_idx on public.thumbnails (content_item_id);

create table public.titles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  content_item_id uuid not null,
  text text not null check (char_length(text) between 1 and 200),
  curiosity_score public.score,
  clarity_score public.score,
  ctr_potential_score public.score,
  accuracy_score public.score,
  overall_score public.score,
  is_selected boolean not null default false,
  platform public.platform,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete cascade
);
create index titles_content_item_idx on public.titles (content_item_id, overall_score desc nulls last);
create unique index titles_one_selected_per_item on public.titles (content_item_id) where is_selected;

-- -----------------------------------------------------------------------------
-- VERIFICATION: facts, rights_checks
-- -----------------------------------------------------------------------------
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid,
  story_id uuid,
  content_item_id uuid,
  source_id uuid,
  claim text not null check (char_length(claim) between 1 and 2000),
  status public.fact_status not null default 'uncertain',
  confidence public.probability,
  is_critical boolean not null default true,
  checked_at timestamptz,
  checked_by uuid references public.users (id) on delete set null,
  checked_by_agent public.agent_key,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, project_id) references public.opportunities (id, project_id) on delete cascade,
  foreign key (story_id, project_id) references public.stories (id, project_id) on delete set null (story_id),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete set null (content_item_id),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete set null (source_id)
);
create index facts_opportunity_idx on public.facts (opportunity_id) where opportunity_id is not null;
create index facts_story_idx on public.facts (story_id) where story_id is not null;
create index facts_content_item_idx on public.facts (content_item_id) where content_item_id is not null;

create table public.rights_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_id uuid,
  video_id uuid,
  owner text,
  origin text,
  license text,
  commercial_use boolean,
  authorization_details text,
  risk text,
  notes text,
  status public.rights_status not null check (status <> 'unchecked'),
  checked_by uuid references public.users (id) on delete set null,
  checked_by_agent public.agent_key,
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(source_id, video_id) = 1),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  foreign key (video_id, project_id) references public.videos (id, project_id) on delete cascade
);
create index rights_checks_video_idx on public.rights_checks (video_id, checked_at desc) where video_id is not null;
create index rights_checks_source_idx on public.rights_checks (source_id, checked_at desc) where source_id is not null;

-- -----------------------------------------------------------------------------
-- DISTRIBUTION: platform accounts, publishing jobs, analytics
-- OAuth tokens are NOT stored here (service-role-only table arrives with M5).
-- -----------------------------------------------------------------------------
create table public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  platform public.platform not null,
  account_name text,
  external_account_id text,
  status public.connection_status not null default 'not_connected',
  scopes text[] not null default '{}',
  connected_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, platform, external_account_id)
);

create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  content_item_id uuid not null,
  platform_account_id uuid,
  platform public.platform not null,
  mode public.publish_mode not null default 'manual_export',
  status public.job_status not null default 'pending',
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_url text check (external_url is null or external_url ~* '^https?://'),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete cascade,
  foreign key (platform_account_id, project_id) references public.platform_accounts (id, project_id) on delete set null (platform_account_id)
);
create index publishing_jobs_project_status_idx on public.publishing_jobs (project_id, status, scheduled_at);
create index publishing_jobs_content_item_idx on public.publishing_jobs (content_item_id);

create table public.analytics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  content_item_id uuid not null,
  publishing_job_id uuid,
  platform public.platform not null,
  captured_at timestamptz not null default now(),
  views bigint check (views is null or views >= 0),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  subscribers_gained integer,
  watch_time_sec numeric(14, 2) check (watch_time_sec is null or watch_time_sec >= 0),
  avg_percentage_viewed numeric(5, 2) check (avg_percentage_viewed is null or avg_percentage_viewed between 0 and 100),
  ctr numeric(5, 2) check (ctr is null or ctr between 0 and 100),
  raw jsonb,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, project_id) references public.content_items (id, project_id) on delete cascade,
  foreign key (publishing_job_id, project_id) references public.publishing_jobs (id, project_id) on delete set null (publishing_job_id)
);
create index analytics_content_platform_captured_idx on public.analytics (content_item_id, platform, captured_at desc);
create index analytics_project_captured_idx on public.analytics (project_id, captured_at desc);

-- -----------------------------------------------------------------------------
-- AGENTS: runs, tasks, human approvals
-- -----------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  agent public.agent_key not null,
  status public.job_status not null default 'pending',
  triggered_by public.run_trigger not null default 'manual',
  parent_run_id uuid references public.agent_runs (id) on delete set null,
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index agent_runs_agent_created_idx on public.agent_runs (agent, created_at desc);
create index agent_runs_project_created_idx on public.agent_runs (project_id, created_at desc);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  agent public.agent_key not null,
  run_id uuid references public.agent_runs (id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  task_type text not null check (char_length(task_type) between 1 and 80),
  status public.task_status not null default 'pending',
  priority smallint not null default 50 check (priority between 0 and 100),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  entity_type text,
  entity_id uuid,
  requires_approval boolean not null default false,
  due_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_tasks_agent_status_idx on public.agent_tasks (agent, status, priority desc);
create index agent_tasks_project_status_idx on public.agent_tasks (project_id, status);

-- Human checkpoints (append-only audit of decisions)
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  checkpoint public.approval_checkpoint not null,
  entity_type text not null check (entity_type in ('opportunity', 'story', 'content_item', 'publishing_job')),
  entity_id uuid not null,
  decision public.approval_decision not null,
  notes text,
  decided_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index approvals_entity_idx on public.approvals (entity_type, entity_id, created_at desc);
create index approvals_project_idx on public.approvals (project_id, created_at desc);
