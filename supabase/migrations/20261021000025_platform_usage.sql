-- How much of the hosting plan is used: database size and file storage against the plan's limits, plus platform-wide counts.
-- The limits live in platform_settings so they can be raised in one place when the plan is upgraded (they start at the free Supabase plan: 500 MB and 1 GB).

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
insert into public.platform_settings (key, value) values ('database_cap_mb', '500'::jsonb), ('storage_cap_mb', '1024'::jsonb);

create function public.platform_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_storage bigint := 0;
begin
  perform public._platform_guard('read');
  -- Supabase keeps uploaded files in storage.objects; a project (or test database) without it simply has none.
  if to_regclass('storage.objects') is not null then
    execute 'select coalesce(sum((metadata ->> ''size'')::bigint), 0) from storage.objects' into v_storage;
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'database_cap_bytes', ((select value from public.platform_settings where key = 'database_cap_mb') #>> '{}')::bigint * 1024 * 1024,
    'storage_bytes', v_storage,
    'storage_cap_bytes', ((select value from public.platform_settings where key = 'storage_cap_mb') #>> '{}')::bigint * 1024 * 1024,
    'businesses', (select count(*) from public.businesses where status <> 'archived'),
    'users', (select count(*) from public.profiles),
    'audit_events', (select count(*) from public.audit_logs) + (select count(*) from public.platform_audit_log));
end $$;

revoke execute on function public.platform_usage() from public;
grant execute on function public.platform_usage() to authenticated;
