-- =============================================================================
-- M2 · Deterministic "latest decision"
-- Two decisions recorded in the same transaction share created_at (now()), and
-- uuid ids are random, so "latest" was ambiguous. An identity column gives the
-- insertion order; every gate reads the latest decision by it.
-- =============================================================================

alter table public.approvals add column seq bigint generated always as identity;
create index approvals_latest_idx on public.approvals (entity_type, entity_id, checkpoint, seq desc);

create or replace function private.rights_check_usable(p_check_id uuid, p_status public.rights_status)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_check_id is null then false
    when p_status = 'green' then true
    when p_status = 'yellow' then coalesce((
      select a.decision = 'approved'
      from public.approvals a
      where a.checkpoint = 'rights' and a.entity_type = 'rights_check' and a.entity_id = p_check_id
      order by a.seq desc
      limit 1), false)
    else false
  end
$$;

create or replace function private.latest_decision(p_entity_type text, p_entity_id uuid, p_checkpoint public.approval_checkpoint)
returns public.approval_decision
language sql
stable
security definer
set search_path = ''
as $$
  select a.decision from public.approvals a
  where a.entity_type = p_entity_type and a.entity_id = p_entity_id and a.checkpoint = p_checkpoint
  order by a.seq desc
  limit 1
$$;
