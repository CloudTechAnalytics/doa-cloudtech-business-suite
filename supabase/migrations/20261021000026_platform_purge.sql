-- Permanently deleting a business and everything in it. For platform owners only; it cannot be undone.
--
-- Deleting a business normally just archives it (nothing is erased). This is the other option: erase every row that belongs to the business, in every table,
-- and then the business itself. The append-only guards (stock movements, payments, audit trail and so on) are switched off for the length of this one
-- transaction, because the whole point is to remove those records; they are switched back on before it ends, and if anything fails nothing at all is deleted.
-- The platform's own action log is kept: it records who deleted what and why, and is never touched.

create function public.platform_purge_business(p_business uuid, p_confirm_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; t record; g record; v_left text[]; v_free text[]; v_rows bigint; v_total bigint := 0; v_tables integer := 0; v_guards text[] := '{}';
begin
  perform public._platform_guard('owner');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> b.name then raise exception 'type the business name exactly to confirm' using errcode = '22023'; end if;

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

  perform public._platform_log('business.purge', p_business, jsonb_build_object('name', b.name, 'industry', b.primary_industry_code, 'status_was', b.status, 'rows_deleted', v_total + 1, 'tables', v_tables), p_reason);
  return jsonb_build_object('rows_deleted', v_total + 1, 'tables', v_tables);
end $$;

-- A deleted business is no longer in the table, so the log keeps its name in the entry itself.
create or replace function public.platform_audit(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.occurred_at, 'action', l.action, 'by', l.actor_email, 'business_id', l.business_id,
    'business', coalesce((select name from public.businesses where id = l.business_id), l.detail ->> 'name'), 'reason', l.reason, 'detail', l.detail) order by l.occurred_at desc)
    from (select * from public.platform_audit_log order by occurred_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l), '[]'::jsonb);
end $$;

revoke execute on function public.platform_purge_business(uuid, text, text) from public;
grant execute on function public.platform_purge_business(uuid, text, text) to authenticated;
