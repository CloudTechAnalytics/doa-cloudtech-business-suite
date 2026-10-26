-- Platform administration: the people who run DOA itself (not any one business). Completely separate from business roles.
-- Roles: owner (everything, including who else is on the team), engineer (manage businesses and subscriptions), support (read only).
-- Nothing here is reachable from a business: every function checks platform_admins, and the tables have no direct write access.
--
-- To make the first platform owner, run once as the database owner:
--   insert into public.platform_admins (user_id, role) select id, 'owner' from auth.users where email = 'you@example.com';

create table public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'engineer', 'support')),
  added_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
grant select on public.platform_admins to authenticated;

-- Every action taken from the console is recorded with the reason, and the record cannot be changed.
create table public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null,
  actor_email text,
  action text not null,
  business_id uuid,
  detail jsonb not null default '{}'::jsonb,
  reason text
);
create index platform_audit_log_at_idx on public.platform_audit_log (occurred_at desc);
alter table public.platform_audit_log enable row level security;
revoke all on public.platform_audit_log from anon, authenticated;
create trigger platform_audit_log_no_change before update or delete on public.platform_audit_log
  for each row execute function public.audit_logs_immutable();

-- ------------------------------------------------------------------ guards
create function public.platform_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.platform_admins where user_id = auth.uid()
$$;

-- p_need: 'read' (any platform admin), 'write' (owner or engineer), 'owner'.
create function public._platform_guard(p_need text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text := public.platform_role();
begin
  if v is null or (p_need = 'write' and v = 'support') or (p_need = 'owner' and v <> 'owner') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return v;
end $$;

create function public._platform_log(p_action text, p_business uuid, p_detail jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.platform_audit_log (actor_user_id, actor_email, action, business_id, detail, reason)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_action, p_business, coalesce(p_detail, '{}'::jsonb), nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

create function public._platform_reason(p_reason text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why (it is kept in the audit log)' using errcode = '22023'; end if;
end $$;

-- ------------------------------------------------------------------ reads
create function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public._platform_guard('read');
  select jsonb_build_object(
    'businesses', count(*) filter (where b.status <> 'archived'),
    'suspended', count(*) filter (where b.status = 'suspended'),
    'archived', count(*) filter (where b.status = 'archived'),
    'new_this_month', count(*) filter (where b.status <> 'archived' and b.created_at >= date_trunc('month', now())),
    'paid', count(*) filter (where b.status = 'active' and s.status = 'active'),
    'trial', count(*) filter (where b.status = 'active' and s.status = 'trialing'),
    'past_due', count(*) filter (where b.status = 'active' and s.status = 'past_due'),
    'mrr', coalesce(sum(case when b.status = 'active' and s.status = 'active' then case p.billing_interval when 'year' then p.price_amount / 12 else p.price_amount end end), 0)
  ) into r
  from public.businesses b
  left join public.subscriptions s on s.business_id = b.id and s.status in ('trialing', 'active', 'past_due')
  left join public.subscription_plans p on p.id = s.plan_id;
  return r || jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'platform_team', (select count(*) from public.platform_admins),
    'active_today', (select count(*) from auth.users u where (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz >= now() - interval '1 day'),
    'by_industry', coalesce((select jsonb_agg(jsonb_build_object('industry', i, 'businesses', n) order by n desc) from (select primary_industry_code as i, count(*) as n from public.businesses where status <> 'archived' group by 1) x), '[]'::jsonb),
    'trials_ending', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'trial_end', s.trial_end) order by s.trial_end) from public.subscriptions s join public.businesses b on b.id = s.business_id
      where s.status = 'trialing' and b.status = 'active' and s.trial_end <= now() + interval '7 days'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'industry', primary_industry_code, 'created_at', created_at, 'status', status) order by created_at desc) from (select * from public.businesses order by created_at desc limit 6) x), '[]'::jsonb)
  );
end $$;

create function public.platform_businesses(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select b.id, b.name, b.primary_industry_code as industry, b.status, b.created_at,
      pr.display_name as owner_name, u.email as owner_email,
      (select count(*) from public.business_members m where m.business_id = b.id and m.status = 'active') as members,
      p.code as plan_code, p.name as plan_name, s.status as subscription_status, s.trial_end, s.current_period_end
    from public.businesses b
    left join public.profiles pr on pr.id = b.owner_user_id
    left join auth.users u on u.id = b.owner_user_id
    left join public.subscriptions s on s.business_id = b.id and s.status in ('trialing', 'active', 'past_due')
    left join public.subscription_plans p on p.id = s.plan_id
    where nullif(btrim(coalesce(p_search, '')), '') is null
       or b.name ilike '%' || btrim(p_search) || '%' or u.email ilike '%' || btrim(p_search) || '%' or pr.display_name ilike '%' || btrim(p_search) || '%'
    order by b.created_at desc limit 500) x), '[]'::jsonb);
end $$;

create function public.platform_business_detail(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.businesses; r jsonb;
begin
  perform public._platform_guard('read');
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'business not found' using errcode = '22023'; end if;
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'legal_name', b.legal_name, 'industry', b.primary_industry_code, 'status', b.status, 'created_at', b.created_at,
    'country', b.country_code, 'currency', b.default_currency, 'timezone', b.timezone,
    'owner', (select jsonb_build_object('id', pr.id, 'name', pr.display_name, 'email', u.email) from public.profiles pr left join auth.users u on u.id = pr.id where pr.id = b.owner_user_id),
    'subscription', (select jsonb_build_object('plan_code', p.code, 'plan_name', p.name, 'status', s.status, 'trial_end', s.trial_end, 'period_end', s.current_period_end, 'price', p.price_amount)
      from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id where s.business_id = b.id order by (s.status in ('trialing', 'active', 'past_due')) desc, s.created_at desc limit 1),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.display_name, 'email', u.email, 'role', ro.name, 'status', m.status, 'joined_at', m.joined_at) order by m.created_at)
      from public.business_members m join public.roles ro on ro.id = m.role_id left join public.profiles pr on pr.id = m.user_id left join auth.users u on u.id = m.user_id where m.business_id = b.id), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(md.code order by md.code) from public.business_modules bm join public.modules md on md.id = bm.module_id where bm.business_id = b.id and bm.status = 'enabled'), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'entity', a.entity_type) order by a.occurred_at desc) from (select * from public.audit_logs where business_id = b.id order by occurred_at desc limit 15) a), '[]'::jsonb),
    'platform_actions', coalesce((select jsonb_agg(jsonb_build_object('at', l.occurred_at, 'action', l.action, 'by', l.actor_email, 'reason', l.reason, 'detail', l.detail) order by l.occurred_at desc) from (select * from public.platform_audit_log where business_id = b.id order by occurred_at desc limit 20) l), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create function public.platform_users(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select pr.id, pr.display_name as name, u.email, pr.created_at, (to_jsonb(u) ->> 'last_sign_in_at') as last_sign_in, pa.role as platform_role,
      coalesce((select jsonb_agg(jsonb_build_object('business_id', b.id, 'business', b.name, 'role', ro.name, 'status', m.status) order by b.name)
        from public.business_members m join public.businesses b on b.id = m.business_id join public.roles ro on ro.id = m.role_id where m.user_id = pr.id), '[]'::jsonb) as businesses
    from public.profiles pr left join auth.users u on u.id = pr.id left join public.platform_admins pa on pa.user_id = pr.id
    where nullif(btrim(coalesce(p_search, '')), '') is null or pr.display_name ilike '%' || btrim(p_search) || '%' or u.email ilike '%' || btrim(p_search) || '%'
    order by pr.created_at desc limit 500) x), '[]'::jsonb);
end $$;

create function public.platform_plans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'price', p.price_amount, 'currency', p.currency, 'interval', p.billing_interval, 'limits', p.limits, 'status', p.status,
    'modules', (select count(*) from public.plan_modules pm where pm.plan_id = p.id and pm.included),
    'businesses', (select count(*) from public.subscriptions s join public.businesses b on b.id = s.business_id where s.plan_id = p.id and s.status in ('trialing', 'active', 'past_due') and b.status <> 'archived')) order by p.price_amount)
    from public.subscription_plans p), '[]'::jsonb);
end $$;

create function public.platform_audit(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.occurred_at, 'action', l.action, 'by', l.actor_email, 'business_id', l.business_id,
    'business', (select name from public.businesses where id = l.business_id), 'reason', l.reason, 'detail', l.detail) order by l.occurred_at desc)
    from (select * from public.platform_audit_log order by occurred_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l), '[]'::jsonb);
end $$;

-- Real checks over real records; each says what it found.
create function public.platform_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_nosub integer; v_expired integer; v_pastdue integer; v_susp integer; v_invited integer; v_24 integer; v_plat integer;
begin
  perform public._platform_guard('read');
  select count(*) into v_nosub from public.businesses b where b.status = 'active' and not exists (select 1 from public.subscriptions s where s.business_id = b.id and s.status in ('trialing', 'active', 'past_due'));
  select count(*) into v_expired from public.subscriptions s join public.businesses b on b.id = s.business_id where s.status = 'trialing' and s.trial_end < now() and b.status = 'active';
  select count(*) into v_pastdue from public.subscriptions where status = 'past_due';
  select count(*) into v_susp from public.businesses where status = 'suspended';
  select count(*) into v_invited from public.business_members where status = 'invited';
  select count(*) into v_24 from public.audit_logs where occurred_at >= now() - interval '1 day';
  select count(*) into v_plat from public.platform_audit_log where occurred_at >= now() - interval '1 day';
  return jsonb_build_object('checked_at', now(), 'checks', jsonb_build_array(
    jsonb_build_object('name', 'Database', 'ok', true, 'detail', 'Answering queries'),
    jsonb_build_object('name', 'Businesses without a subscription', 'ok', v_nosub = 0, 'detail', v_nosub || ' found'),
    jsonb_build_object('name', 'Trials that ran out but are still marked as trials', 'ok', v_expired = 0, 'detail', v_expired || ' found'),
    jsonb_build_object('name', 'Subscriptions past due', 'ok', v_pastdue = 0, 'detail', v_pastdue || ' found'),
    jsonb_build_object('name', 'Suspended businesses', 'ok', true, 'detail', v_susp || ' suspended'),
    jsonb_build_object('name', 'Invitations waiting to be accepted', 'ok', true, 'detail', v_invited || ' waiting')),
    'activity', jsonb_build_object('business_changes_24h', v_24, 'platform_actions_24h', v_plat));
end $$;

create function public.platform_admins_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', pr.display_name, 'email', u.email, 'role', a.role, 'since', a.created_at) order by a.created_at)
    from public.platform_admins a left join public.profiles pr on pr.id = a.user_id left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ actions (each is logged with its reason)
-- Any of plan, status and extend_days may be null to leave that part alone.
create function public.platform_set_subscription(p_business uuid, p_plan text, p_status text, p_extend_days integer, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; v_plan public.subscription_plans; v_before jsonb; b public.businesses;
begin
  perform public._platform_guard('write');
  perform public._platform_reason(p_reason);
  select * into b from public.businesses where id = p_business for update;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired') then raise exception 'choose a subscription status' using errcode = '22023'; end if;
  if p_extend_days is not null and (p_extend_days < 1 or p_extend_days > 366) then raise exception 'extend by 1 to 366 days' using errcode = '22023'; end if;
  if p_plan is not null then
    select * into v_plan from public.subscription_plans where code = p_plan and status = 'active';
    if not found then raise exception 'unknown plan' using errcode = '22023'; end if;
  end if;
  select * into s from public.subscriptions where business_id = p_business order by (status in ('trialing', 'active', 'past_due')) desc, created_at desc limit 1 for update;
  if not found then
    if v_plan.id is null then raise exception 'this business has no subscription; choose a plan' using errcode = '22023'; end if;
    insert into public.subscriptions (business_id, plan_id, status, current_period_end, trial_end)
    values (p_business, v_plan.id, coalesce(p_status, 'active'), now() + make_interval(days => coalesce(p_extend_days, 30)), case when coalesce(p_status, 'active') = 'trialing' then now() + make_interval(days => coalesce(p_extend_days, 14)) end);
    perform public._platform_log('subscription.create', p_business, jsonb_build_object('plan', p_plan, 'status', coalesce(p_status, 'active')), p_reason);
    return;
  end if;
  v_before := jsonb_build_object('plan', (select code from public.subscription_plans where id = s.plan_id), 'status', s.status, 'period_end', s.current_period_end, 'trial_end', s.trial_end);
  update public.subscriptions set
    plan_id = coalesce(v_plan.id, plan_id),
    status = coalesce(p_status, status),
    current_period_end = case when p_extend_days is not null then greatest(current_period_end, now()) + make_interval(days => p_extend_days)
                              when p_status = 'active' and current_period_end < now() then now() + interval '30 days' else current_period_end end,
    trial_end = case when p_extend_days is not null and coalesce(p_status, status) = 'trialing' then greatest(coalesce(trial_end, now()), now()) + make_interval(days => p_extend_days) else trial_end end
  where id = s.id;
  perform public._platform_log('subscription.update', p_business, jsonb_build_object('before', v_before, 'plan', p_plan, 'status', p_status, 'extend_days', p_extend_days), p_reason);
exception when unique_violation then raise exception 'this business already has another live subscription' using errcode = '23505';
end $$;

-- Suspending stops every member of the business from using it immediately (is_active_member requires an active business); nothing is deleted.
create function public.platform_set_business_status(p_business uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses;
begin
  perform public._platform_guard('write');
  perform public._platform_reason(p_reason);
  if p_status not in ('active', 'suspended') then raise exception 'choose active or suspended' using errcode = '22023'; end if;
  select * into b from public.businesses where id = p_business for update;
  if not found or b.status = 'archived' then raise exception 'business not found' using errcode = '22023'; end if;
  if b.status = p_status then return; end if;
  update public.businesses set status = p_status where id = p_business;
  perform public._platform_log('business.' || case p_status when 'suspended' then 'suspend' else 'reactivate' end, p_business, jsonb_build_object('from', b.status, 'to', p_status), p_reason);
end $$;

create function public.platform_add_admin(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform public._platform_guard('owner');
  if p_role not in ('owner', 'engineer', 'support') then raise exception 'choose owner, engineer or support' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then raise exception 'no account has that email; they must sign up first' using errcode = '22023'; end if;
  if exists (select 1 from public.platform_admins where user_id = v_user and role = 'owner') and p_role <> 'owner'
     and (select count(*) from public.platform_admins where role = 'owner') = 1 then
    raise exception 'there must always be at least one platform owner' using errcode = '22023';
  end if;
  insert into public.platform_admins (user_id, role, added_by) values (v_user, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role;
  perform public._platform_log('team.set', null, jsonb_build_object('email', lower(btrim(p_email)), 'role', p_role), null);
end $$;

create function public.platform_remove_admin(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.platform_admins;
begin
  perform public._platform_guard('owner');
  select * into a from public.platform_admins where user_id = p_user for update;
  if not found then raise exception 'that person is not on the platform team' using errcode = '22023'; end if;
  if a.role = 'owner' and (select count(*) from public.platform_admins where role = 'owner') = 1 then raise exception 'there must always be at least one platform owner' using errcode = '22023'; end if;
  delete from public.platform_admins where user_id = p_user;
  perform public._platform_log('team.remove', null, jsonb_build_object('user_id', p_user, 'role', a.role), null);
end $$;

-- ------------------------------------------------------------------ privileges
revoke execute on function public._platform_guard(text), public._platform_log(text, uuid, jsonb, text), public._platform_reason(text) from public;
revoke execute on function public.platform_role(), public.platform_overview(), public.platform_businesses(text), public.platform_business_detail(uuid), public.platform_users(text), public.platform_plans(),
  public.platform_audit(integer), public.platform_health(), public.platform_admins_list(), public.platform_set_subscription(uuid, text, text, integer, text),
  public.platform_set_business_status(uuid, text, text), public.platform_add_admin(text, text), public.platform_remove_admin(uuid) from public;
grant execute on function public.platform_role(), public.platform_overview(), public.platform_businesses(text), public.platform_business_detail(uuid), public.platform_users(text), public.platform_plans(),
  public.platform_audit(integer), public.platform_health(), public.platform_admins_list(), public.platform_set_subscription(uuid, text, text, integer, text),
  public.platform_set_business_status(uuid, text, text), public.platform_add_admin(text, text), public.platform_remove_admin(uuid) to authenticated;
