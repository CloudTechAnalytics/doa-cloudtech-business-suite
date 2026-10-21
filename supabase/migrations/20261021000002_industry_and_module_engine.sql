-- Prompt 3: industry templates, module registry, business modules, plans/entitlements,
-- backend enforcement helpers and a controlled industry-change workflow.
-- The TypeScript registry (src/modules/module-registry) must stay consistent with this seed;
-- tests/db/registry-consistency.test.ts fails if they drift.

-- ------------------------------------------------------------ registry
create table public.industry_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'coming_soon')),
  configuration_version integer not null default 1
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  version integer not null default 1,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  is_core boolean not null default false,
  required_permission text not null references public.permissions (code)
);

-- Rows = modules compatible with an industry. is_default: enabled on creation.
-- is_required: cannot be disabled while the business is in this industry.
create table public.industry_template_modules (
  industry_template_id uuid not null references public.industry_templates (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  is_default boolean not null default false,
  is_required boolean not null default false,
  primary key (industry_template_id, module_id),
  check (not is_required or is_default)
);

alter table public.businesses
  add constraint businesses_industry_fk foreign key (primary_industry_code)
  references public.industry_templates (code);

create table public.business_modules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  module_id uuid not null references public.modules (id),
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  enabled_at timestamptz not null default now(),
  disabled_at timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  unique (business_id, module_id)
);

create table public.business_industry_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  from_industry text not null,
  to_industry text not null,
  disabled_modules text[] not null default '{}',
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);

-- -------------------------------------------------------- plans / subscriptions
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  price_amount numeric(14, 2) not null default 0 check (price_amount >= 0),
  currency text not null default 'NGN',
  limits jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'retired'))
);

create table public.plan_modules (
  plan_id uuid not null references public.subscription_plans (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  included boolean not null default true,
  usage_limit integer,
  primary key (plan_id, module_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  billing_provider text,
  provider_customer_reference text,
  provider_subscription_reference text,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Policy: at most one live subscription per business.
create unique index subscriptions_one_live_uq on public.subscriptions (business_id)
  where status in ('trialing', 'active', 'past_due');
create trigger subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- seed data
insert into public.industry_templates (code, name, description, status) values
  ('retail', 'Retail & Supermarket', 'Shops, supermarkets and wholesalers.', 'active'),
  ('farm', 'Farm Management', 'Poultry, fishery, crops and livestock.', 'active'),
  ('bakery', 'Bakery & Food Production', 'Recipes, production batches and finished goods.', 'active'),
  ('pharmacy', 'Pharmacy', 'Planned for a later release after workflow and compliance review.', 'coming_soon');

insert into public.modules (code, name, description, is_core, required_permission) values
  ('dashboard', 'Dashboard', 'Indicators for the selected period.', true, 'dashboard.read'),
  ('staff', 'Staff & Roles', 'Invitations, roles and branch access.', true, 'staff.read'),
  ('settings', 'Settings', 'Business profile, modules and subscription.', true, 'settings.read'),
  ('inventory', 'Inventory', 'Products, stock movements and counts.', false, 'inventory.read'),
  ('sales', 'Sales / POS', 'Point of sale and sales history.', false, 'sales.read'),
  ('purchases', 'Purchases', 'Purchase records and goods received.', false, 'purchases.read'),
  ('suppliers', 'Suppliers', 'Supplier records.', false, 'suppliers.read'),
  ('customers', 'Customers', 'Customer profiles and balances.', false, 'customers.read'),
  ('expenses', 'Expenses', 'Expense records and summaries.', false, 'expenses.read'),
  ('reports', 'Reports', 'Operational reports.', false, 'reports.read'),
  ('farm-overview', 'Farm Overview', 'Farm profile and summary.', false, 'farm.read'),
  ('farm-units', 'Production Units', 'Pens, ponds and plots.', false, 'farm.read'),
  ('farm-batches', 'Farm Batches', 'Production cycles and batches.', false, 'farm.read'),
  ('farm-daily', 'Daily Operations', 'Daily activity records.', false, 'farm.record'),
  ('farm-feeding', 'Feeding', 'Feeding records.', false, 'farm.record'),
  ('farm-mortality', 'Mortality', 'Mortality records.', false, 'farm.record'),
  ('farm-harvests', 'Harvests', 'Harvest records.', false, 'farm.record'),
  ('farm-expenses', 'Farm Expenses', 'Operating costs by batch.', false, 'expenses.read'),
  ('bakery-ingredients', 'Ingredients', 'Ingredient inventory.', false, 'inventory.read'),
  ('bakery-recipes', 'Recipes', 'Versioned recipes.', false, 'bakery.read'),
  ('bakery-production', 'Production', 'Production batches.', false, 'bakery.record'),
  ('bakery-finished-goods', 'Finished Goods', 'Finished-goods stock.', false, 'inventory.read');

-- defaults per industry (core modules are default+required everywhere)
insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, m.is_core or m.code = any (d.required)
from public.industry_templates t
join (values
  ('retail', array['inventory','sales','purchases','suppliers','customers','expenses','reports'], array['sales']),
  ('farm', array['farm-overview','farm-units','farm-batches','farm-daily','farm-feeding','farm-mortality','farm-harvests','farm-expenses','inventory','sales','reports'], array['farm-overview']),
  ('bakery', array['bakery-ingredients','bakery-recipes','bakery-production','bakery-finished-goods','inventory','sales','purchases','suppliers','expenses','reports'], array['bakery-production'])
) as d (industry, mods, required) on d.industry = t.code
join public.modules m on m.is_core or m.code = any (d.mods);

-- compatible-but-optional modules
insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, false, false
from public.industry_templates t
join (values
  ('farm', array['purchases','suppliers','expenses','customers']),
  ('bakery', array['customers'])
) as o (industry, mods) on o.industry = t.code
join public.modules m on m.code = any (o.mods)
on conflict do nothing;

insert into public.subscription_plans (code, name, price_amount, limits) values
  ('starter', 'Starter', 0, '{"max_members": 3, "max_branches": 1}'),
  ('basic', 'Basic', 5000, '{"max_members": 5, "max_branches": 1}'),
  ('growth', 'Growth', 15000, '{"max_members": 15, "max_branches": 3}'),
  ('business', 'Business', 40000, '{"max_members": 50, "max_branches": 10}');

-- Plan entitlements. Core modules are never plan-gated.
insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id,
  case p.code
    when 'starter' then m.code <> all (array['purchases','suppliers','expenses','reports','farm-expenses'])
    when 'basic' then m.code <> all (array['reports'])
    else true
  end
from public.subscription_plans p cross join public.modules m;

-- ------------------------------------------------------------------ RLS
alter table public.industry_templates enable row level security;
alter table public.modules enable row level security;
alter table public.industry_template_modules enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.plan_modules enable row level security;
alter table public.business_modules enable row level security;
alter table public.business_industry_changes enable row level security;
alter table public.subscriptions enable row level security;

create policy industry_templates_select on public.industry_templates for select to authenticated using (true);
create policy modules_select on public.modules for select to authenticated using (true);
create policy itm_select on public.industry_template_modules for select to authenticated using (true);
create policy plans_select on public.subscription_plans for select to authenticated using (true);
create policy plan_modules_select on public.plan_modules for select to authenticated using (true);
create policy business_modules_select on public.business_modules for select to authenticated
  using (public.is_active_member(business_id));
create policy industry_changes_select on public.business_industry_changes for select to authenticated
  using (public.has_business_permission(business_id, 'settings.read'));
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.has_business_permission(business_id, 'settings.read'));

grant select on public.industry_templates, public.modules, public.industry_template_modules,
  public.subscription_plans, public.plan_modules, public.business_modules,
  public.business_industry_changes, public.subscriptions to authenticated;
-- No direct writes: enable/disable/industry changes use functions; subscriptions change via
-- verified payment webhooks (service role) in a later stage.

-- ------------------------------------------------------ entitlement helpers
-- Plan of the business's currently valid subscription (7-day grace when past_due), else null.
create function public.entitled_plan(p_business uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.plan_id from public.subscriptions s
  where s.business_id = p_business and (
    (s.status in ('trialing', 'active') and s.current_period_end > now())
    or (s.status = 'past_due' and s.current_period_end + interval '7 days' > now())
  )
  limit 1;
$$;

-- p_mode 'use' = create/change data; 'read' = view historical records (survives expiry or disabling).
create function public.module_usable(p_business uuid, p_module text, p_mode text default 'use') returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_member(p_business) and exists (
    select 1 from public.modules m
    join public.business_modules bm on bm.module_id = m.id and bm.business_id = p_business
    where m.code = p_module and m.status = 'active'
      and (
        p_mode = 'read'
        or (bm.status = 'enabled' and (
          m.is_core
          or exists (select 1 from public.plan_modules pm
                     where pm.plan_id = public.entitled_plan(p_business) and pm.module_id = m.id and pm.included)
        ))
      )
  );
$$;

-- Use in RLS of module-owned tables, e.g.
--   select: has_module_permission(business_id, 'inventory', 'inventory.read', 'read')
--   write : has_module_permission(business_id, 'inventory', 'inventory.adjust')
create function public.has_module_permission(p_business uuid, p_module text, p_permission text, p_mode text default 'use')
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_business_permission(p_business, p_permission)
     and public.module_usable(p_business, p_module, p_mode);
$$;

create type public.module_status as (
  module_code text, is_core boolean, is_default boolean, is_required boolean,
  enabled boolean, entitled boolean, permitted boolean, usable boolean
);

-- Everything the UI needs to build navigation: one row per module compatible with the business.
create function public.my_modules(p_business uuid) returns setof public.module_status
language sql stable security definer set search_path = '' as $$
  select m.code, m.is_core, itm.is_default, itm.is_required,
    coalesce(bm.status = 'enabled', false),
    m.is_core or exists (select 1 from public.plan_modules pm
       where pm.plan_id = public.entitled_plan(p_business) and pm.module_id = m.id and pm.included),
    public.has_business_permission(p_business, m.required_permission),
    public.module_usable(p_business, m.code, 'use') and public.has_business_permission(p_business, m.required_permission)
  from public.businesses b
  join public.industry_templates t on t.code = b.primary_industry_code
  join public.industry_template_modules itm on itm.industry_template_id = t.id
  join public.modules m on m.id = itm.module_id and m.status = 'active'
  left join public.business_modules bm on bm.business_id = b.id and bm.module_id = m.id
  where b.id = p_business and public.is_active_member(p_business)
  order by m.code;
$$;

-- -------------------------------------------------- limits on branches
create function public.enforce_branch_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  -- BEFORE triggers run ahead of RLS: refuse non-managers first so plan details of other
  -- businesses are never revealed.
  if not public.has_business_permission(new.business_id, 'settings.manage') then
    raise exception 'new row violates row-level security policy for table "branches"' using errcode = '42501';
  end if;
  select (p.limits ->> 'max_branches')::integer into v_limit
  from public.subscription_plans p where p.id = public.entitled_plan(new.business_id);
  if public.entitled_plan(new.business_id) is null then
    raise exception 'subscription is not active' using errcode = '42501';
  end if;
  if v_limit is not null and (
    select count(*) from public.branches where business_id = new.business_id and status = 'active'
  ) >= v_limit then
    raise exception 'branch limit reached for the current plan' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger branches_limit before insert on public.branches
  for each row execute function public.enforce_branch_limit();

-- ------------------------------------------------ business creation (replaces v1)
create or replace function public.create_business(
  p_name text, p_industry text, p_country text default 'NG',
  p_currency text default 'NGN', p_timezone text default 'Africa/Lagos'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_business uuid;
  v_owner_role uuid;
  v_template public.industry_templates;
  v_starter uuid;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_template from public.industry_templates where code = p_industry;
  if not found or v_template.status <> 'active' then
    raise exception 'industry % is not available', p_industry using errcode = '22023';
  end if;
  select id into v_owner_role from public.roles where name = 'owner' and business_id is null;
  select id into v_starter from public.subscription_plans where code = 'starter';

  insert into public.businesses (owner_user_id, name, primary_industry_code, country_code, default_currency, timezone)
  values (v_user, btrim(p_name), p_industry, upper(p_country), upper(p_currency), p_timezone)
  returning id into v_business;

  insert into public.business_members (business_id, user_id, role_id, status, joined_at)
  values (v_business, v_user, v_owner_role, 'active', now());

  insert into public.subscriptions (business_id, plan_id, status, current_period_end, trial_end)
  values (v_business, v_starter, 'trialing', now() + interval '14 days', now() + interval '14 days');

  insert into public.branches (business_id, name, code) values (v_business, 'Main', 'MAIN');

  insert into public.business_modules (business_id, module_id)
  select v_business, itm.module_id from public.industry_template_modules itm
  where itm.industry_template_id = v_template.id and itm.is_default;
  return v_business;
end $$;

-- -------------------------------------------- invitations with plan limits (replaces v1)
create or replace function public.invite_member(p_business uuid, p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_id uuid;
  v_limit integer;
  v_plan uuid := public.entitled_plan(p_business);
begin
  if not public.has_business_permission(p_business, 'staff.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_role from public.roles
   where name = p_role and (business_id is null or business_id = p_business);
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;
  if v_role.name = 'owner' then raise exception 'owner role cannot be assigned' using errcode = '42501'; end if;
  if v_role.name = 'business_admin' and not exists (
    select 1 from public.businesses where id = p_business and owner_user_id = auth.uid()
  ) then
    raise exception 'only the owner can assign business_admin' using errcode = '42501';
  end if;

  if v_plan is null then raise exception 'subscription is not active' using errcode = '42501'; end if;
  select (limits ->> 'max_members')::integer into v_limit from public.subscription_plans where id = v_plan;
  if v_limit is not null and (
    (select count(*) from public.business_members where business_id = p_business and status in ('active', 'suspended'))
    + (select count(*) from public.business_invitations where business_id = p_business and status = 'pending')
  ) >= v_limit then
    raise exception 'member limit reached for the current plan' using errcode = '42501';
  end if;

  insert into public.business_invitations (business_id, email, role_id, invited_by)
  values (p_business, lower(btrim(p_email)), v_role.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------ module & industry operations
create function public.enable_module(p_business uuid, p_module text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_mod public.modules;
begin
  if not public.has_business_permission(p_business, 'settings.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.* into v_mod from public.modules m
   join public.industry_template_modules itm on itm.module_id = m.id
   join public.businesses b on b.primary_industry_code = (select code from public.industry_templates where id = itm.industry_template_id)
  where b.id = p_business and m.code = p_module and m.status = 'active';
  if not found then raise exception 'module is not compatible with this industry' using errcode = '22023'; end if;

  -- Existing row (and its configuration/history) is kept; only the status changes.
  insert into public.business_modules (business_id, module_id) values (p_business, v_mod.id)
  on conflict (business_id, module_id) do update set status = 'enabled', enabled_at = now(), disabled_at = null;
end $$;

create function public.disable_module(p_business uuid, p_module text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_required boolean; v_core boolean;
begin
  if not public.has_business_permission(p_business, 'settings.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.is_core, coalesce(itm.is_required, false) into v_core, v_required
  from public.modules m
  join public.businesses b on b.id = p_business
  left join public.industry_template_modules itm on itm.module_id = m.id
    and itm.industry_template_id = (select id from public.industry_templates where code = b.primary_industry_code)
  where m.code = p_module;
  if not found then raise exception 'unknown module' using errcode = '22023'; end if;
  if v_core or v_required then raise exception 'this module cannot be disabled' using errcode = '42501'; end if;

  -- Data is never deleted: the row stays so historical records remain readable.
  update public.business_modules set status = 'disabled', disabled_at = now()
   where business_id = p_business and status = 'enabled'
     and module_id = (select id from public.modules where code = p_module);
end $$;

create function public.preview_industry_change(p_business uuid, p_industry text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_new public.industry_templates;
  v_current text;
  v_incompatible text[];
  v_to_enable text[];
begin
  if not exists (select 1 from public.businesses where id = p_business and owner_user_id = auth.uid()) then
    raise exception 'only the owner can change the industry' using errcode = '42501';
  end if;
  select primary_industry_code into v_current from public.businesses where id = p_business;
  select * into v_new from public.industry_templates where code = p_industry;
  if not found or v_new.status <> 'active' then
    raise exception 'industry % is not available', p_industry using errcode = '22023';
  end if;
  if v_current = p_industry then raise exception 'business already uses this industry' using errcode = '22023'; end if;

  select coalesce(array_agg(m.code order by m.code), '{}') into v_incompatible
  from public.business_modules bm join public.modules m on m.id = bm.module_id
  where bm.business_id = p_business and bm.status = 'enabled'
    and not exists (select 1 from public.industry_template_modules itm
                    where itm.industry_template_id = v_new.id and itm.module_id = m.id);

  select coalesce(array_agg(m.code order by m.code), '{}') into v_to_enable
  from public.industry_template_modules itm join public.modules m on m.id = itm.module_id
  where itm.industry_template_id = v_new.id and itm.is_default
    and not exists (select 1 from public.business_modules bm
                    where bm.business_id = p_business and bm.module_id = m.id and bm.status = 'enabled');

  return jsonb_build_object('from', v_current, 'to', p_industry,
                            'incompatible_modules', to_jsonb(v_incompatible), 'modules_to_enable', to_jsonb(v_to_enable));
end $$;

-- Incompatible modules are only disabled (never deleted) and only with explicit confirmation.
create function public.change_industry(p_business uuid, p_industry text, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan jsonb := public.preview_industry_change(p_business, p_industry);
  v_incompatible text[] := array(select jsonb_array_elements_text(v_plan -> 'incompatible_modules'));
begin
  if array_length(v_incompatible, 1) > 0 and not p_confirm then
    raise exception 'incompatible modules would be disabled: %. Confirm to proceed.', array_to_string(v_incompatible, ', ')
      using errcode = '22023';
  end if;

  update public.business_modules set status = 'disabled', disabled_at = now()
   where business_id = p_business and status = 'enabled'
     and module_id in (select id from public.modules where code = any (v_incompatible));

  update public.businesses set primary_industry_code = p_industry where id = p_business;

  insert into public.business_modules (business_id, module_id)
  select p_business, m.id from public.modules m where m.code in (select jsonb_array_elements_text(v_plan -> 'modules_to_enable'))
  on conflict (business_id, module_id) do update set status = 'enabled', enabled_at = now(), disabled_at = null;

  insert into public.business_industry_changes (business_id, from_industry, to_industry, disabled_modules, changed_by)
  values (p_business, v_plan ->> 'from', p_industry, v_incompatible, auth.uid());
  return v_plan;
end $$;

revoke all on function public.entitled_plan(uuid), public.module_usable(uuid, text, text),
  public.has_module_permission(uuid, text, text, text), public.my_modules(uuid),
  public.enable_module(uuid, text), public.disable_module(uuid, text),
  public.preview_industry_change(uuid, text), public.change_industry(uuid, text, boolean),
  public.enforce_branch_limit() from public;
grant execute on function public.module_usable(uuid, text, text), public.has_module_permission(uuid, text, text, text),
  public.my_modules(uuid), public.enable_module(uuid, text), public.disable_module(uuid, text),
  public.preview_industry_change(uuid, text), public.change_industry(uuid, text, boolean) to authenticated;
-- entitled_plan stays internal (called only from SECURITY DEFINER functions).
