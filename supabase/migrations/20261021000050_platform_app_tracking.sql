-- The Platform console can see apps: which app a workspace started from, which apps it has on now, when each was switched on or off and by whom, and how
-- much each is really used. One workspace per business is kept (customers, invoice payments and Finance share data inside it); this only makes it visible.
--   * app_modules says which modules make up each standalone app (the SQL twin of src/core/app-catalogue/apps.ts; a test keeps the two equal).
--   * businesses.started_with_app records the app a person came for. It is set once, by the owner, on a new Business apps workspace.
--   * business_module_events is a history of modules switched on and off, written by a trigger so no screen can skip it. The workspace setup noise (every
--     default switched on, then most of them off) is replaced by one "start" entry per module of the chosen app.
--   * platform_businesses and platform_business_detail now include the apps, and platform_app_adoption() counts workspaces per app.
--     Adoption counts Business apps workspaces only: industry businesses switch several shared apps on by default, which would drown the signal.
-- Additive apart from replacing the two platform read functions (existing keys unchanged, keys added). Rollback: restore them from 0021 and drop what is added here.

create table public.app_modules (
  app text not null check (app in ('crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance')),
  module text not null references public.modules (code),
  primary key (app, module)
);
insert into public.app_modules (app, module) values
  ('crm', 'customers'), ('pos', 'sales'), ('pos', 'inventory'), ('inventory', 'inventory'), ('invoices', 'invoices'), ('expenses', 'expenses'), ('finance', 'reports');
alter table public.app_modules enable row level security;
create policy app_modules_select on public.app_modules for select to authenticated using (true);
grant select on public.app_modules to authenticated;

alter table public.businesses add column started_with_app text check (started_with_app in ('crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance'));

create table public.business_module_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  module_code text not null,
  action text not null check (action in ('start', 'on', 'off')),
  by_user uuid,
  at timestamptz not null default now()
);
create index business_module_events_idx on public.business_module_events (business_id, at desc);
alter table public.business_module_events enable row level security; -- read only through the platform functions

create function public._log_module_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_action text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'enabled' then return new; end if;
    v_action := 'on';
  elsif new.status is distinct from old.status then
    v_action := case when new.status = 'enabled' then 'on' else 'off' end;
  else
    return new;
  end if;
  select code into v_code from public.modules where id = new.module_id;
  insert into public.business_module_events (business_id, module_code, action, by_user) values (new.business_id, v_code, v_action, auth.uid());
  return new;
end $$;
create trigger business_modules_events after insert or update of status on public.business_modules for each row execute function public._log_module_event();

insert into public.business_module_events (business_id, module_code, action, at)
select bm.business_id, m.code, 'on', bm.enabled_at from public.business_modules bm join public.modules m on m.id = bm.module_id where bm.status = 'enabled';

-- Records the app a new Business apps workspace was started for, once, by its owner, shortly after it is made.
create function public.set_started_with_app(p_business uuid, p_app text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses;
begin
  select * into b from public.businesses where id = p_business for update;
  if not found or b.owner_user_id is distinct from auth.uid() then raise exception 'permission denied' using errcode = '42501'; end if;
  if b.primary_industry_code <> 'general' then raise exception 'only a Business apps workspace starts with an app' using errcode = '22023'; end if;
  if b.started_with_app is not null then raise exception 'this workspace already has a starting app' using errcode = '22023'; end if;
  if b.created_at < now() - interval '1 hour' then raise exception 'the starting app can only be set when the workspace is new' using errcode = '22023'; end if;
  if not exists (select 1 from public.app_modules where app = p_app) then raise exception 'unknown app' using errcode = '22023'; end if;
  update public.businesses set started_with_app = p_app where id = p_business;
  delete from public.business_module_events where business_id = p_business;
  insert into public.business_module_events (business_id, module_code, action, by_user) select p_business, module, 'start', auth.uid() from public.app_modules where app = p_app;
end $$;

-- The apps a business has on: every module of the app is enabled.
create function public._business_apps(p_business uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.app order by array_position(array['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance'], a.app)), '{}'::text[]) from (
    select am.app from public.app_modules am
     group by am.app
    having bool_and(exists (select 1 from public.business_modules bm join public.modules m on m.id = bm.module_id
                             where bm.business_id = p_business and bm.status = 'enabled' and m.code = am.module))) a;
$$;

-- How much each app has really been used: records and the time of the latest one. Finance only reads, so it has none of its own.
create function public._app_activity(p_business uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'crm', (select jsonb_build_object('records', c.n + l.n + d.n + q.n, 'last_at', nullif(greatest(c.t, l.t, d.t, q.t), '-infinity'::timestamptz)) from
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.customers where business_id = p_business) c,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_leads where business_id = p_business) l,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_deals where business_id = p_business) d,
      (select count(*) n, coalesce(max(created_at), '-infinity') t from public.crm_quotes where business_id = p_business) q),
    'pos', (select jsonb_build_object('records', count(*), 'last_at', max(sold_at)) from public.sales where business_id = p_business),
    'inventory', (select jsonb_build_object('records', count(*), 'last_at', max(occurred_at)) from public.stock_movements where business_id = p_business),
    'invoices', (select jsonb_build_object('records', count(*), 'last_at', max(created_at)) from public.invoices where business_id = p_business),
    'expenses', (select jsonb_build_object('records', count(*), 'last_at', max(created_at)) from public.expenses where business_id = p_business),
    'finance', jsonb_build_object('records', 0, 'last_at', null));
$$;

create or replace function public.platform_businesses(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select b.id, b.name, b.primary_industry_code as industry, b.status, b.created_at,
      pr.display_name as owner_name, u.email as owner_email,
      (select count(*) from public.business_members m where m.business_id = b.id and m.status = 'active') as members,
      p.code as plan_code, p.name as plan_name, s.status as subscription_status, s.trial_end, s.current_period_end,
      b.started_with_app, public._business_apps(b.id) as apps
    from public.businesses b
    left join public.profiles pr on pr.id = b.owner_user_id
    left join auth.users u on u.id = b.owner_user_id
    left join public.subscriptions s on s.business_id = b.id and s.status in ('trialing', 'active', 'past_due')
    left join public.subscription_plans p on p.id = s.plan_id
    where nullif(btrim(coalesce(p_search, '')), '') is null
       or b.name ilike '%' || btrim(p_search) || '%' or u.email ilike '%' || btrim(p_search) || '%' or pr.display_name ilike '%' || btrim(p_search) || '%'
    order by b.created_at desc limit 500) x), '[]'::jsonb);
end $$;

create or replace function public.platform_business_detail(p_business uuid) returns jsonb
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
    'platform_actions', coalesce((select jsonb_agg(jsonb_build_object('at', l.occurred_at, 'action', l.action, 'by', l.actor_email, 'reason', l.reason, 'detail', l.detail) order by l.occurred_at desc) from (select * from public.platform_audit_log where business_id = b.id order by occurred_at desc limit 20) l), '[]'::jsonb),
    'started_with_app', b.started_with_app,
    'apps', to_jsonb(public._business_apps(b.id)),
    'app_activity', public._app_activity(b.id),
    -- The setup in the first minute is noise, except the "start" entries that say which app it began with.
    'app_events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'module', e.module_code, 'action', e.action, 'by', pr.display_name) order by e.at desc)
      from (select * from public.business_module_events where business_id = b.id and (action = 'start' or at > b.created_at + interval '1 minute') order by at desc limit 60) e
      left join public.profiles pr on pr.id = e.by_user), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- Per app: workspaces using it now, how many started with it, how many of those later added another app, and how many used it in the last 30 days.
create function public.platform_app_adoption() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._platform_guard('read');
  return coalesce((select jsonb_agg(jsonb_build_object('app', x.app, 'workspaces', coalesce(s.using_now, 0), 'started', coalesce(s.started, 0), 'grew', coalesce(s.grew, 0), 'active_30d', coalesce(s.active, 0)) order by x.o)
    from (values ('crm', 1), ('pos', 2), ('inventory', 3), ('invoices', 4), ('expenses', 5), ('finance', 6)) as x (app, o)
    left join lateral (
      select count(*) filter (where x.app = any (w.apps)) as using_now,
             count(*) filter (where w.started_with_app = x.app) as started,
             count(*) filter (where w.started_with_app = x.app and cardinality(w.apps) > 1) as grew,
             count(*) filter (where x.app = any (w.apps) and (w.act -> x.app ->> 'last_at')::timestamptz >= now() - interval '30 days') as active
        from (select b.started_with_app, public._business_apps(b.id) as apps, public._app_activity(b.id) as act
                from public.businesses b where b.primary_industry_code = 'general' and b.status <> 'archived') w) s on true), '[]'::jsonb);
end $$;

revoke execute on function public._log_module_event(), public.set_started_with_app(uuid, text), public._business_apps(uuid), public._app_activity(uuid), public.platform_app_adoption() from public;
grant execute on function public.set_started_with_app(uuid, text), public.platform_app_adoption() to authenticated;
