-- =============================================================================
-- Sports Media OS — 0500 job queue functions (workers only)
-- Postgres-backed queue: no Redis to run/pay for. FOR UPDATE SKIP LOCKED lets
-- many workers claim concurrently without double-processing.
-- Executable by service_role only.
-- =============================================================================

create or replace function public.claim_jobs(
  p_worker text,
  p_types text[] default null,
  p_limit integer default 1
)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      started_at = coalesce(j.started_at, now()),
      attempts = j.attempts + 1,
      error_message = null
  where j.id in (
    select q.id
    from public.jobs q
    where q.status = 'pending'
      and q.run_after <= now()
      and (p_types is null or q.type = any (p_types))
    order by q.priority desc, q.run_after, q.created_at
    limit greatest(least(p_limit, 50), 1)
    for update skip locked
  )
  returning j.*;
$$;

create or replace function public.complete_job(p_job_id uuid, p_result jsonb default null)
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs
  set status = 'completed', result = p_result, finished_at = now(),
      locked_at = null, locked_by = null, error_message = null
  where id = p_job_id and status = 'running'
  returning * into j;
  if not found then
    raise exception 'JOB_NOT_RUNNING: job % is not running', p_job_id using errcode = 'P0001';
  end if;
  return j;
end;
$$;

-- Retries with exponential backoff (30s, 60s, 120s, …) until max_attempts.
create or replace function public.fail_job(p_job_id uuid, p_error text, p_retry boolean default true)
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs
  set status = case when p_retry and attempts < max_attempts then 'pending'::public.job_status
                    else 'failed'::public.job_status end,
      run_after = case when p_retry and attempts < max_attempts
                       then now() + make_interval(secs => 30 * power(2, greatest(attempts - 1, 0)))
                       else run_after end,
      finished_at = case when p_retry and attempts < max_attempts then null else now() end,
      error_message = left(coalesce(p_error, 'unknown error'), 4000),
      locked_at = null,
      locked_by = null
  where id = p_job_id and status = 'running'
  returning * into j;
  if not found then
    raise exception 'JOB_NOT_RUNNING: job % is not running', p_job_id using errcode = 'P0001';
  end if;
  return j;
end;
$$;

-- Recover jobs whose worker died (crash, deploy, OOM).
create or replace function public.requeue_stale_jobs(p_timeout interval default interval '30 minutes')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.jobs
  set status = case when attempts < max_attempts then 'pending'::public.job_status
                    else 'failed'::public.job_status end,
      finished_at = case when attempts < max_attempts then null else now() end,
      error_message = 'worker lease expired',
      locked_at = null,
      locked_by = null
  where status = 'running' and locked_at < now() - p_timeout;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Users may cancel their project's pending jobs (no direct UPDATE grant on jobs).
create or replace function public.cancel_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs
  set status = 'cancelled', finished_at = now()
  where id = p_job_id
    and status = 'pending'
    and project_id in (select private.project_ids_for_role('editor'))
  returning * into j;
  if not found then
    raise exception 'JOB_NOT_CANCELLABLE: job not found or not pending' using errcode = 'P0001';
  end if;
  return j;
end;
$$;

revoke execute on function public.claim_jobs(text, text[], integer) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.requeue_stale_jobs(interval) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, text[], integer) to service_role;
grant execute on function public.complete_job(uuid, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, boolean) to service_role;
grant execute on function public.requeue_stale_jobs(interval) to service_role;

revoke execute on function public.cancel_job(uuid) from public, anon;
grant execute on function public.cancel_job(uuid) to authenticated, service_role;
