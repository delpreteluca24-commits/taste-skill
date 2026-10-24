-- =============================================================================
-- Sports Media OS — 0600 storage buckets + policies
-- Object path convention: <project_id>/<entity>/<file>  (first folder = project)
-- All buckets are private; the app serves media through signed URLs.
-- NOTE: hosted Supabase caps uploads by plan (Free: 50 MB/file). Long-form video
-- needs Pro + resumable (TUS) uploads, or an external store — see docs/ARCHITECTURE.md.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos', 'videos', false, 5368709120,
    array['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']),
  ('renders', 'renders', false, 2147483648,
    array['video/mp4', 'audio/wav', 'audio/mpeg', 'application/json']),
  ('thumbnails', 'thumbnails', false, 20971520,
    array['image/png', 'image/jpeg', 'image/webp']),
  ('captions', 'captions', false, 5242880,
    array['text/plain', 'application/x-subrip', 'text/x-ssa', 'text/vtt', 'application/json']),
  ('exports', 'exports', false, 5368709120, null)
on conflict (id) do nothing;

create or replace function private.storage_project_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
  end
$$;
grant execute on function private.storage_project_id(text) to authenticated, service_role;

create policy "smos members read project objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('videos', 'renders', 'thumbnails', 'captions', 'exports')
    and private.storage_project_id(name) in (select private.project_ids_for_role('viewer'))
  );

create policy "smos editors upload project objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('videos', 'renders', 'thumbnails', 'captions', 'exports')
    and private.storage_project_id(name) in (select private.project_ids_for_role('editor'))
  );

create policy "smos editors update project objects" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('videos', 'renders', 'thumbnails', 'captions', 'exports')
    and private.storage_project_id(name) in (select private.project_ids_for_role('editor'))
  )
  with check (
    bucket_id in ('videos', 'renders', 'thumbnails', 'captions', 'exports')
    and private.storage_project_id(name) in (select private.project_ids_for_role('editor'))
  );

create policy "smos admins delete project objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('videos', 'renders', 'thumbnails', 'captions', 'exports')
    and private.storage_project_id(name) in (select private.project_ids_for_role('admin'))
  );
