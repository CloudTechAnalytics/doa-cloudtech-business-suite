-- Architecture stage: audit logging, subscription events, the shared CRM module, validated business settings.
-- Additive only: no existing table is dropped or rewritten, so existing data and features are untouched.
-- Rollback: drop the objects created here (triggers first); nothing else depends on them.

-- ------------------------------------------------------------- permissions
insert into public.permissions (code, description) values ('audit.read', 'View the audit log');
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'audit.read'
where r.business_id is null and r.name in ('owner', 'business_admin');

-- ------------------------------------------------------------------- audit
-- business_id is deliberately not a foreign key: the history must outlive the records it describes.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  request_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_logs_business_idx on public.audit_logs (business_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit records cannot be changed or deleted' using errcode = '42501';
end $$;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (business_id is not null and public.has_business_permission(business_id, 'audit.read'));
grant select on public.audit_logs to authenticated;
-- No INSERT grant: records are written only by the trigger below (trusted backend logic).

-- Records who changed what. Updates store only the columns that changed (minus noise and secrets);
-- inserts store a small descriptive summary.
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_noise text[] := array['updated_at', 'idempotency_key', 'provider_customer_reference', 'provider_subscription_reference'] || tg_argv;
  v_meta jsonb;
  v_business uuid;
  v_request text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)) into v_meta
    from jsonb_each(v_new) where key <> all (v_noise) and v_old -> key is distinct from value;
    if v_meta is null then return null; end if;
  else
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'name', v_new ->> 'name', 'status', v_new ->> 'status', 'amount', v_new ->> 'amount',
      'grand_total', v_new ->> 'grand_total', 'total_amount', v_new ->> 'total_amount',
      'payment_type', v_new ->> 'payment_type', 'role_id', v_new ->> 'role_id', 'to_industry', v_new ->> 'to_industry'));
  end if;
  v_business := coalesce((v_new ->> 'business_id')::uuid, case when tg_table_name = 'businesses' then (v_new ->> 'id')::uuid end);
  begin
    v_request := nullif(current_setting('request.headers', true)::json ->> 'x-request-id', '');
  exception when others then v_request := null;
  end;
  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
  values (v_business, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, (v_new ->> 'id')::uuid, v_request, v_meta);
  return null;
end $$;

create trigger audit_business_members after insert or update on public.business_members for each row execute function public.audit_row_change();
create trigger audit_businesses after update on public.businesses for each row execute function public.audit_row_change();
create trigger audit_business_modules after insert or update on public.business_modules for each row execute function public.audit_row_change();
create trigger audit_industry_changes after insert on public.business_industry_changes for each row execute function public.audit_row_change();
create trigger audit_subscriptions after insert or update on public.subscriptions for each row execute function public.audit_row_change();
create trigger audit_branches after insert or update on public.branches for each row execute function public.audit_row_change();
create trigger audit_products after insert or update on public.products for each row execute function public.audit_row_change();
create trigger audit_customers after insert or update on public.customers for each row execute function public.audit_row_change();
-- Derived money columns change on every payment; only real status/total changes are interesting.
create trigger audit_sales after insert or update on public.sales for each row
  execute function public.audit_row_change('amount_paid', 'returned_total', 'balance_due', 'refund_due', 'payment_status');
create trigger audit_purchases after insert or update on public.purchases for each row
  execute function public.audit_row_change('amount_paid', 'payment_status');
create trigger audit_payments after insert or update on public.payments for each row execute function public.audit_row_change();

revoke all on function public.audit_row_change(), public.audit_logs_immutable() from public;

-- ------------------------------------------------------- subscription events
create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  event_type text not null,
  provider_event_reference text,
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Verified payment-provider events are processed once: a repeated provider reference is rejected.
create unique index subscription_events_provider_uq on public.subscription_events (provider_event_reference)
  where provider_event_reference is not null;
create index subscription_events_business_idx on public.subscription_events (business_id, created_at desc);

alter table public.subscription_events enable row level security;
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (public.has_business_permission(business_id, 'settings.read'));
grant select on public.subscription_events to authenticated;

create function public.record_subscription_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscription_events (business_id, subscription_id, event_type, payload_summary)
  values (new.business_id, new.id,
    case when tg_op = 'INSERT' then 'subscription.created'
         when new.status is distinct from old.status then 'subscription.status_changed'
         when new.plan_id is distinct from old.plan_id then 'subscription.plan_changed'
         else 'subscription.updated' end,
    case when tg_op = 'INSERT' then jsonb_build_object('status', new.status, 'plan_id', new.plan_id)
         else jsonb_build_object('status', jsonb_build_array(old.status, new.status), 'plan_id', jsonb_build_array(old.plan_id, new.plan_id)) end);
  return null;
end $$;
create trigger subscriptions_events after insert or update on public.subscriptions
  for each row execute function public.record_subscription_event();
revoke all on function public.record_subscription_event() from public;

-- ---------------------------------------------------------- validated settings
-- businesses.settings is limited, validated JSON with defined owners:
--   tax_rate_percent (number 0..100)       read by post_sale
--   allow_negative_stock (boolean)         read by the stock ledger
--   setup (flat object of scalar answers)  written by industry onboarding
create function public.validate_business_settings() returns trigger
language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(new.settings) is distinct from 'object' then raise exception 'settings must be an object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(new.settings) loop
    if k not in ('tax_rate_percent', 'allow_negative_stock', 'setup') then
      raise exception 'unknown business setting "%"', k using errcode = '22023';
    end if;
  end loop;
  if new.settings ? 'tax_rate_percent' then
    if jsonb_typeof(new.settings -> 'tax_rate_percent') <> 'number' or (new.settings ->> 'tax_rate_percent')::numeric not between 0 and 100 then
      raise exception 'tax_rate_percent must be a number between 0 and 100' using errcode = '22023';
    end if;
  end if;
  if new.settings ? 'allow_negative_stock' and jsonb_typeof(new.settings -> 'allow_negative_stock') <> 'boolean' then
    raise exception 'allow_negative_stock must be true or false' using errcode = '22023';
  end if;
  if new.settings ? 'setup' then
    if jsonb_typeof(new.settings -> 'setup') <> 'object' or (select count(*) from jsonb_object_keys(new.settings -> 'setup')) > 30 then
      raise exception 'setup must be an object of at most 30 answers' using errcode = '22023';
    end if;
    for k, v in select * from jsonb_each(new.settings -> 'setup') loop
      if k !~ '^[a-z_]{1,40}$' or jsonb_typeof(v) not in ('string', 'number', 'boolean') or length(v::text) > 200 then
        raise exception 'invalid setup answer "%"', k using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger businesses_validate_settings before insert or update of settings on public.businesses
  for each row execute function public.validate_business_settings();

-- ------------------------------------------------------------------- CRM
update public.modules set name = 'CRM', description = 'Leads, customers, notes, follow-ups and credit limits.' where code = 'customers';

alter table public.customers add column source text, add column category text;
grant insert (source, category) on public.customers to authenticated;
grant update (source, category) on public.customers to authenticated;

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  phone text, email text, source text, notes text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'lost', 'converted')),
  customer_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  -- several leads (e.g. the same person entered twice) may link to one customer; that is how duplicates are avoided
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  -- a lead is "converted" exactly when it points at a customer; only convert_lead() can set that link
  check ((status = 'converted') = (customer_id is not null))
);
create index crm_leads_search_idx on public.crm_leads (business_id, lower(name));
create index crm_leads_customer_idx on public.crm_leads (business_id, customer_id) where customer_id is not null;
create trigger crm_leads_updated before update on public.crm_leads for each row execute function public.set_updated_at();

create table public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 50),
  unique (business_id, id)
);
create unique index crm_tags_name_uq on public.crm_tags (business_id, lower(name));

create table public.crm_entity_tags (
  business_id uuid not null,
  tag_id uuid not null,
  customer_id uuid,
  lead_id uuid,
  foreign key (business_id, tag_id) references public.crm_tags (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade,
  foreign key (business_id, lead_id) references public.crm_leads (business_id, id) on delete cascade,
  check (customer_id is not null or lead_id is not null)
);
create unique index crm_entity_tags_customer_uq on public.crm_entity_tags (tag_id, customer_id) where customer_id is not null;
create unique index crm_entity_tags_lead_uq on public.crm_entity_tags (tag_id, lead_id) where lead_id is not null;

create table public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid,
  lead_id uuid,
  kind text not null default 'note' check (kind in ('note', 'call', 'visit', 'message', 'other')),
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.crm_leads (business_id, id),
  check (customer_id is not null or lead_id is not null)
);
create index crm_interactions_customer_idx on public.crm_interactions (customer_id, occurred_at desc);
create index crm_interactions_lead_idx on public.crm_interactions (lead_id, occurred_at desc);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid,
  lead_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_to uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.crm_leads (business_id, id),
  -- a task can only be assigned to someone who belongs to the same business
  foreign key (business_id, assigned_to) references public.business_members (business_id, user_id),
  check (customer_id is not null or lead_id is not null)
);
create index crm_tasks_due_idx on public.crm_tasks (business_id, status, due_at);

-- One thin trigger sets the creator, so it can never be spoofed from the browser.
create function public.crm_set_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  return new;
end $$;
create trigger crm_leads_creator before insert on public.crm_leads for each row execute function public.crm_set_creator();
create trigger crm_interactions_creator before insert on public.crm_interactions for each row execute function public.crm_set_creator();
create trigger crm_tasks_creator before insert on public.crm_tasks for each row execute function public.crm_set_creator();

create function public.crm_task_completion() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.completed_at := case when new.status = 'done' then coalesce(old.completed_at, now()) else null end;
  return new;
end $$;
create trigger crm_tasks_completion before update on public.crm_tasks for each row execute function public.crm_task_completion();

alter table public.crm_leads enable row level security;
alter table public.crm_tags enable row level security;
alter table public.crm_entity_tags enable row level security;
alter table public.crm_interactions enable row level security;
alter table public.crm_tasks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_leads', 'crm_tags', 'crm_entity_tags', 'crm_interactions', 'crm_tasks'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'))$f$, t || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (public.has_module_permission(business_id, 'customers', 'customers.manage'))$f$, t || '_insert', t);
  end loop;
  foreach t in array array['crm_leads', 'crm_tasks'] loop
    execute format($f$create policy %I on public.%I for update to authenticated
      using (public.has_module_permission(business_id, 'customers', 'customers.manage'))
      with check (public.has_module_permission(business_id, 'customers', 'customers.manage'))$f$, t || '_update', t);
  end loop;
  execute $f$create policy crm_entity_tags_delete on public.crm_entity_tags for delete to authenticated
    using (public.has_module_permission(business_id, 'customers', 'customers.manage'))$f$;
end $$;

grant select on public.crm_leads, public.crm_tags, public.crm_entity_tags, public.crm_interactions, public.crm_tasks to authenticated;
grant insert (business_id, name, phone, email, source, notes) on public.crm_leads to authenticated;
grant update (name, phone, email, source, notes, status) on public.crm_leads to authenticated;
grant insert (business_id, name) on public.crm_tags to authenticated;
grant insert (business_id, tag_id, customer_id, lead_id) on public.crm_entity_tags to authenticated;
grant delete on public.crm_entity_tags to authenticated;
grant insert (business_id, customer_id, lead_id, kind, summary, occurred_at) on public.crm_interactions to authenticated;
grant insert (business_id, customer_id, lead_id, title, due_at, assigned_to) on public.crm_tasks to authenticated;
grant update (title, due_at, status, assigned_to) on public.crm_tasks to authenticated;

-- Converts a lead without creating a duplicate: an existing active customer with the same email or phone is reused.
create function public.convert_lead(p_lead uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.crm_leads; v_prev jsonb; v_customer uuid; v_created boolean := false;
begin
  select * into l from public.crm_leads where id = p_lead;
  if not found then raise exception 'lead not found' using errcode = '22023'; end if;
  perform public._guard(l.business_id, 'customers', 'customers.manage');
  v_prev := public._idem_check(l.business_id, p_key, 'lead_convert'); if v_prev is not null then return v_prev; end if;
  select * into l from public.crm_leads where id = p_lead for update;
  if l.status = 'converted' then raise exception 'lead is already converted' using errcode = '22023'; end if;

  select id into v_customer from public.customers
   where business_id = l.business_id and status = 'active'
     and ((l.email is not null and lower(email) = lower(l.email)) or (l.phone is not null and phone = l.phone))
   order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (business_id, name, phone, email, source) values (l.business_id, l.name, l.phone, l.email, coalesce(l.source, 'lead'))
    returning id into v_customer;
    v_created := true;
  end if;

  update public.crm_leads set status = 'converted', customer_id = v_customer where id = p_lead;
  update public.crm_interactions set customer_id = v_customer where lead_id = p_lead and customer_id is null;
  update public.crm_tasks set customer_id = v_customer where lead_id = p_lead and customer_id is null;
  insert into public.crm_entity_tags (business_id, tag_id, customer_id)
  select business_id, tag_id, v_customer from public.crm_entity_tags where lead_id = p_lead and customer_id is null
  on conflict do nothing;
  return public._idem_store(l.business_id, p_key, 'lead_convert', jsonb_build_object('customer_id', v_customer, 'created', v_created));
end $$;

-- A customer's story across modules: notes, follow-ups and, if the caller may see sales, their sales.
create function public.customer_history(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; v_sales boolean;
begin
  select * into c from public.customers where id = p_customer;
  if not found or not public.has_module_permission(c.business_id, 'customers', 'customers.read', 'read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_sales := public.has_module_permission(c.business_id, 'sales', 'sales.read', 'read');
  return coalesce((
    select jsonb_agg(e order by (e ->> 'at') desc) from (
      select jsonb_build_object('kind', 'interaction', 'at', occurred_at, 'label', kind, 'detail', summary) e
        from public.crm_interactions where customer_id = p_customer
      union all
      select jsonb_build_object('kind', 'task', 'at', coalesce(due_at, created_at), 'label', status, 'detail', title)
        from public.crm_tasks where customer_id = p_customer
      union all
      select jsonb_build_object('kind', 'sale', 'at', sold_at, 'label', status, 'detail', sale_number, 'amount', grand_total, 'balance', balance_due)
        from public.sales where customer_id = p_customer and v_sales
      limit 200
    ) x), '[]'::jsonb);
end $$;

revoke all on function public.crm_set_creator(), public.crm_task_completion(), public.validate_business_settings(),
  public.convert_lead(uuid, text), public.customer_history(uuid) from public;
grant execute on function public.convert_lead(uuid, text), public.customer_history(uuid) to authenticated;
