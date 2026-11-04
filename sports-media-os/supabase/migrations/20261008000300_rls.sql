-- =============================================================================
-- Sports Media OS — 0300 grants + row level security
-- Model: a user sees a project's rows iff they are a member of that project.
--   viewer  → read
--   editor  → create / update
--   admin   → delete
--   owner   → manage project + members
-- `anon` gets nothing: every screen requires login.
-- service_role (workers, scripts) bypasses RLS by design — keep its key server-side.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- -----------------------------------------------------------------------------
-- Standard project-scoped tables: one policy set, generated (no copy/paste).
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  standard_tables text[] := array[
    'events', 'sources', 'trends', 'trend_sources', 'opportunities', 'research_items',
    'stories', 'hooks', 'videos', 'video_segments', 'content_items', 'clips', 'captions',
    'thumbnails', 'titles', 'facts', 'rights_checks', 'platform_accounts',
    'publishing_jobs', 'analytics'
  ];
begin
  foreach t in array standard_tables loop
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
      'create policy "admins can delete" on public.%I for delete to authenticated
         using (project_id in (select private.project_ids_for_role(''admin'')))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- scripts: versions are immutable → no delete for clients (story delete cascades)
-- -----------------------------------------------------------------------------
alter table public.scripts enable row level security;
create policy "members can read" on public.scripts for select to authenticated
  using (project_id in (select private.project_ids_for_role('viewer')));
create policy "editors can insert" on public.scripts for insert to authenticated
  with check (project_id in (select private.project_ids_for_role('editor')));
-- only is_current may change (enforced by trigger in 0400_guards.sql)
create policy "editors can update" on public.scripts for update to authenticated
  using (project_id in (select private.project_ids_for_role('editor')))
  with check (project_id in (select private.project_ids_for_role('editor')));
revoke delete on public.scripts from authenticated;

-- -----------------------------------------------------------------------------
-- users: read self (+ co-members), update own profile fields only (no role escalation)
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
create policy "read self and co-members" on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select pm.user_id from public.project_members pm
      where pm.project_id in (select private.project_ids_for_role('viewer'))
    )
  );
create policy "update own profile" on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke insert, update, delete on public.users from authenticated;
grant update (display_name, avatar_url) on public.users to authenticated;

-- -----------------------------------------------------------------------------
-- sports: global reference data
-- -----------------------------------------------------------------------------
alter table public.sports enable row level security;
create policy "authenticated can read" on public.sports for select to authenticated using (true);
create policy "app admins can insert" on public.sports for insert to authenticated with check ((select private.is_app_admin()));
create policy "app admins can update" on public.sports for update to authenticated
  using ((select private.is_app_admin())) with check ((select private.is_app_admin()));
create policy "app admins can delete" on public.sports for delete to authenticated using ((select private.is_app_admin()));

-- -----------------------------------------------------------------------------
-- projects
-- owner_id = auth.uid() in SELECT lets INSERT … RETURNING see the new row before
-- the membership trigger's row is visible to the statement snapshot.
-- -----------------------------------------------------------------------------
alter table public.projects enable row level security;
create policy "members can read" on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) or id in (select private.project_ids_for_role('viewer')));
create policy "users create own projects" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "admins can update" on public.projects for update to authenticated
  using (id in (select private.project_ids_for_role('admin')))
  with check (id in (select private.project_ids_for_role('admin')));
create policy "owners can delete" on public.projects for delete to authenticated
  using (id in (select private.project_ids_for_role('owner')));
-- ownership transfer is an explicit, audited operation (future RPC), not a field edit
revoke update on public.projects from authenticated;
grant update (name, slug, description, primary_sport_id, language, timezone, color, status) on public.projects to authenticated;

-- -----------------------------------------------------------------------------
-- project_members: read for members, manage for owners
-- -----------------------------------------------------------------------------
alter table public.project_members enable row level security;
create policy "members can read" on public.project_members for select to authenticated
  using (project_id in (select private.project_ids_for_role('viewer')));
create policy "owners can insert" on public.project_members for insert to authenticated
  with check (project_id in (select private.project_ids_for_role('owner')));
create policy "owners can update" on public.project_members for update to authenticated
  using (project_id in (select private.project_ids_for_role('owner')))
  with check (project_id in (select private.project_ids_for_role('owner')));
create policy "owners can delete" on public.project_members for delete to authenticated
  using (project_id in (select private.project_ids_for_role('owner')) and user_id <> (select auth.uid()));

-- -----------------------------------------------------------------------------
-- settings: workspace-wide (project_id null) → app admins; per project → admins
-- -----------------------------------------------------------------------------
alter table public.settings enable row level security;
create policy "read settings" on public.settings for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );
create policy "write settings" on public.settings for insert to authenticated
  with check (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('admin'))
  );
create policy "update settings" on public.settings for update to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('admin'))
  )
  with check (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('admin'))
  );
create policy "delete settings" on public.settings for delete to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('admin'))
  );

-- -----------------------------------------------------------------------------
-- append-only tables: activity_logs, approvals
-- -----------------------------------------------------------------------------
alter table public.activity_logs enable row level security;
create policy "read activity" on public.activity_logs for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );
create policy "users log own actions" on public.activity_logs for insert to authenticated
  with check (
    actor_type = 'user'
    and actor_id = (select auth.uid())
    and (project_id is null or project_id in (select private.project_ids_for_role('viewer')))
  );
revoke update, delete on public.activity_logs from authenticated;

alter table public.approvals enable row level security;
create policy "members can read" on public.approvals for select to authenticated
  using (project_id in (select private.project_ids_for_role('viewer')));
create policy "editors record own decisions" on public.approvals for insert to authenticated
  with check (
    decided_by = (select auth.uid())
    and project_id in (select private.project_ids_for_role('editor'))
  );
revoke update, delete on public.approvals from authenticated;

-- -----------------------------------------------------------------------------
-- jobs / agent_runs: written by workers (service role). Clients may only enqueue.
-- -----------------------------------------------------------------------------
alter table public.jobs enable row level security;
create policy "read jobs" on public.jobs for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );
create policy "editors enqueue jobs" on public.jobs for insert to authenticated
  with check (
    project_id in (select private.project_ids_for_role('editor'))
    and status = 'pending'
    and attempts = 0
    and locked_at is null
    and locked_by is null
    and started_at is null
    and finished_at is null
    and result is null
    and created_by = (select auth.uid())
  );
revoke update, delete on public.jobs from authenticated;

alter table public.agent_runs enable row level security;
create policy "read agent runs" on public.agent_runs for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );
revoke insert, update, delete on public.agent_runs from authenticated;

alter table public.agent_tasks enable row level security;
create policy "read agent tasks" on public.agent_tasks for select to authenticated
  using (
    (project_id is null and (select private.is_app_admin()))
    or project_id in (select private.project_ids_for_role('viewer'))
  );
create policy "editors create agent tasks" on public.agent_tasks for insert to authenticated
  with check (project_id in (select private.project_ids_for_role('editor')));
create policy "editors update agent tasks" on public.agent_tasks for update to authenticated
  using (project_id in (select private.project_ids_for_role('editor')))
  with check (project_id in (select private.project_ids_for_role('editor')));
revoke delete on public.agent_tasks from authenticated;
