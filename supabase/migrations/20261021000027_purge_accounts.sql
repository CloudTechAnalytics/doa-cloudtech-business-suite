-- Permanently deleting a business now also deletes the accounts of the people who belonged only to it. Anyone who also belongs to another business, anyone on the
-- platform team, and the person carrying out the deletion keep their accounts. The result and the platform log say how many accounts were deleted and kept.

create or replace function public.platform_purge_business(p_business uuid, p_confirm_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; t record; g record; v_left text[]; v_free text[]; v_rows bigint; v_total bigint := 0; v_tables integer := 0; v_guards text[] := '{}'; v_users uuid[]; v_u uuid; v_members integer; v_deleted integer := 0;
begin
  perform public._platform_guard('owner');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> b.name then raise exception 'type the business name exactly to confirm' using errcode = '22023'; end if;

  -- The business's people: anyone who belongs to no other business (and is not on the platform team, and is not the person doing this) loses their account too.
  select count(distinct user_id) into v_members from public.business_members where business_id = p_business and user_id is not null;
  select coalesce(array_agg(x.user_id), '{}') into v_users from (
    select distinct m.user_id from public.business_members m
    where m.business_id = p_business and m.user_id is not null
      and not exists (select 1 from public.business_members o where o.user_id = m.user_id and o.business_id <> p_business)
      and not exists (select 1 from public.platform_admins a where a.user_id = m.user_id)
      and m.user_id is distinct from auth.uid()) x;

  -- Every table of the business: any table in public with a business_id column, except the platform's own records.
  select array_agg(c.relname::text) into v_left from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('businesses') and c.relname not like 'platform\_%';

  -- Switch off the append-only guards (row triggers that run before a delete) for this transaction only.
  for g in select c.relname::text as t, tg.tgname::text as name from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not tg.tgisinternal and tg.tgenabled <> 'D' and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 8) = 8 loop
    execute format('alter table public.%I disable trigger %I', g.t, g.name);
    v_guards := v_guards || (g.t || '.' || g.name);
  end loop;

  -- Delete children before the tables they point to, so no foreign key is ever broken half way.
  while coalesce(array_length(v_left, 1), 0) > 0 loop
    select array_agg(x) into v_free from unnest(v_left) x
      where not exists (select 1 from pg_constraint k join pg_class r on r.oid = k.conrelid
                        where k.contype = 'f' and k.confrelid = ('public.' || quote_ident(x))::regclass and r.relnamespace = 'public'::regnamespace
                          and r.relname::text = any (v_left) and r.relname::text <> x);
    if v_free is null then raise exception 'cannot work out a safe deletion order (tables left: %)', array_to_string(v_left, ', ') using errcode = '55000'; end if;
    for t in select unnest(v_free) as name loop
      execute format('delete from public.%I where business_id = $1', t.name) using p_business;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows; v_tables := v_tables + 1;
    end loop;
    v_left := array(select x from unnest(v_left) x where x <> all (v_free));
  end loop;

  delete from public.businesses where id = p_business;

  for g in select c.relname::text as t, tg.tgname::text as name from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not tg.tgisinternal and tg.tgenabled = 'D' and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 8) = 8 loop
    execute format('alter table public.%I enable trigger %I', g.t, g.name);
  end loop;

  -- Delete the accounts (sign-in, sessions and profile go with them). An account that something else still points to is kept rather than failing the whole deletion.
  foreach v_u in array v_users loop
    begin
      delete from auth.users where id = v_u;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then null;
    end;
  end loop;

  perform public._platform_log('business.purge', p_business, jsonb_build_object('name', b.name, 'industry', b.primary_industry_code, 'status_was', b.status, 'rows_deleted', v_total + 1, 'tables', v_tables, 'accounts_deleted', v_deleted, 'accounts_kept', v_members - v_deleted), p_reason);
  return jsonb_build_object('rows_deleted', v_total + 1, 'tables', v_tables, 'accounts_deleted', v_deleted, 'accounts_kept', v_members - v_deleted);
end $$;
