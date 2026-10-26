-- Profile pictures. A public storage bucket called "avatars": anyone can look at a picture (it is shown in the top bar and on staff lists), but a person can only add,
-- replace or remove pictures inside their own folder, named after their user id. Only small JPEG, PNG or WebP files are accepted (the app shrinks them first).
-- profiles.avatar_path (already part of the profile) remembers which file is theirs.
--
-- The storage schema exists on Supabase but not in the plain test database, so this does nothing there.

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute 'drop policy if exists avatars_select on storage.objects';
  execute 'drop policy if exists avatars_insert on storage.objects';
  execute 'drop policy if exists avatars_update on storage.objects';
  execute 'drop policy if exists avatars_delete on storage.objects';
  execute $p$create policy avatars_select on storage.objects for select to authenticated using (bucket_id = 'avatars')$p$;
  execute $p$create policy avatars_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy avatars_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy avatars_delete on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;
