-- =============================================================================
-- Sports Media OS — M2 / 0100 enum additions
-- Kept in its own migration: a value added with ALTER TYPE … ADD VALUE cannot be
-- used in the same transaction, and every migration file runs in one.
-- =============================================================================

alter type public.approval_checkpoint add value if not exists 'script';
alter type public.approval_checkpoint add value if not exists 'rights';

alter type public.research_item_type add value if not exists 'media';
alter type public.research_item_type add value if not exists 'competitor';

-- Who holds the rights to an asset (RIGHTS-FIRST classification)
create type public.asset_ownership as enum (
  'owned',            -- our own footage / graphics / recordings
  'licensed',         -- paid or contractual license
  'authorized',       -- written permission from the rights holder
  'creator_provided', -- supplied by a creator/athlete who holds the rights
  'public_domain',
  'third_party',      -- someone else's, no permission on file
  'unknown'
);

-- How a story can be told when footage is missing or unusable (STORY ≠ FOOTAGE)
create type public.editorial_format as enum (
  'original_commentary',
  'voiceover',
  'statistics',
  'graphics',
  'timeline',
  'animation',
  'map',
  'original_visuals',
  'authorized_footage',
  'licensed_footage',
  'screenshots',
  'public_sources',
  'creator_provided'
);

create type public.script_angle as enum ('breaking_news', 'storytelling', 'analysis', 'controversy', 'unexpected_fact');

-- AI work is routed per task so each task can use the cheapest adequate model
create type public.ai_task as enum ('discovery', 'scoring', 'research', 'script', 'fact_check');

create type public.connector_kind as enum ('rss', 'json_api');

create type public.claim_relation as enum ('supports', 'contradicts', 'mentions');

create type public.competition_level as enum ('low', 'medium', 'high');

-- Editorial signals the Sports Radar looks for (not a plain news feed)
create type public.radar_signal as enum (
  'upcoming_event', 'just_finished', 'breaking', 'upset', 'record', 'rivalry',
  'controversy', 'statement', 'unusual_stat', 'injury', 'transfer', 'rising_trend'
);
