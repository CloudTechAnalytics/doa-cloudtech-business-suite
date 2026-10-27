-- Business apps (an account with no industry) and a real CRM: a deal pipeline, quotes and a CRM report.
--   * "general" is a business type like the others, with no industry modules: the shared apps (CRM, Sales, Inventory, Purchases,
--     Finance) are all it has. Existing businesses are untouched.
--   * Deals sit on a customer or a lead and move through fixed stages (new, qualified, proposal, negotiation, won, lost). Every
--     stage change is recorded. Money and numbers are decided here, never in the browser.
--   * Quotes are numbered per business, hold their own lines, and can be printed; an accepted quote does not create a sale by itself.
-- Additive apart from the industry list on businesses. Rollback: drop the objects created here and restore the businesses check.

alter table public.businesses drop constraint businesses_primary_industry_code_check;
alter table public.businesses add constraint businesses_primary_industry_code_check check (primary_industry_code in ('retail', 'farm', 'bakery', 'pharmacy', 'school', 'general'));

insert into public.industry_templates (code, name, description, status) values
  ('general', 'Business apps', 'No industry: pick the apps you need, such as CRM, sales and invoicing, stock, purchasing and finance.', 'active');

insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, true, m.is_core
from public.industry_templates t
join public.modules m on m.is_core or m.code in ('inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports')
where t.code = 'general'
on conflict do nothing;

update public.modules set description = 'Customers, leads, a deal pipeline, quotes, follow-ups and credit limits.' where code = 'customers';

-- ------------------------------------------------------------------- deals
create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  customer_id uuid,
  lead_id uuid,
  value numeric(14, 2) not null default 0 check (value >= 0),
  stage text not null default 'new' check (stage in ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  expected_close date,
  owner_id uuid,
  notes text not null default '',
  lost_reason text,
  closed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.crm_leads (business_id, id),
  foreign key (business_id, owner_id) references public.business_members (business_id, user_id),
  check (customer_id is not null or lead_id is not null),
  check (stage <> 'lost' or lost_reason is not null),
  check ((stage in ('won', 'lost')) = (closed_at is not null))
);
create index crm_deals_stage_idx on public.crm_deals (business_id, stage);
create index crm_deals_customer_idx on public.crm_deals (business_id, customer_id) where customer_id is not null;
create index crm_deals_lead_idx on public.crm_deals (business_id, lead_id) where lead_id is not null;
create trigger crm_deals_updated before update on public.crm_deals for each row execute function public.set_updated_at();
create trigger crm_deals_creator before insert on public.crm_deals for each row execute function public.crm_set_creator();

create table public.crm_deal_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  deal_id uuid not null,
  from_stage text,
  to_stage text not null,
  note text,
  at timestamptz not null default now(),
  by_user uuid references public.profiles (id),
  foreign key (business_id, deal_id) references public.crm_deals (business_id, id) on delete cascade
);
create index crm_deal_events_deal_idx on public.crm_deal_events (deal_id, at);

-- ------------------------------------------------------------------ quotes
create table public.crm_quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  deal_id uuid,
  customer_id uuid,
  lead_id uuid,
  issued_on date not null default current_date,
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  subtotal numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  notes text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, deal_id) references public.crm_deals (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, lead_id) references public.crm_leads (business_id, id),
  check (customer_id is not null or lead_id is not null or deal_id is not null)
);
create index crm_quotes_deal_idx on public.crm_quotes (business_id, deal_id) where deal_id is not null;
create trigger crm_quotes_updated before update on public.crm_quotes for each row execute function public.set_updated_at();
create trigger crm_quotes_creator before insert on public.crm_quotes for each row execute function public.crm_set_creator();

alter table public.crm_deals enable row level security;
alter table public.crm_deal_events enable row level security;
alter table public.crm_quotes enable row level security;
create policy crm_deals_select on public.crm_deals for select to authenticated using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'));
create policy crm_deal_events_select on public.crm_deal_events for select to authenticated using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'));
create policy crm_quotes_select on public.crm_quotes for select to authenticated using (public.has_module_permission(business_id, 'customers', 'customers.read', 'read'));
grant select on public.crm_deals, public.crm_deal_events, public.crm_quotes to authenticated;

create trigger audit_crm_deals after insert or update on public.crm_deals for each row execute function public.audit_row_change();
create trigger audit_crm_quotes after insert or update on public.crm_quotes for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- functions
create function public.crm_save_deal(p_business uuid, p_id uuid, p_title text, p_customer uuid, p_lead uuid, p_value numeric, p_expected date, p_owner uuid, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_stage text;
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'enter what the deal is for' using errcode = '22023'; end if;
  if p_customer is null and p_lead is null then raise exception 'choose the customer or lead this deal is with' using errcode = '22023'; end if;
  if coalesce(p_value, 0) < 0 then raise exception 'the deal value cannot be negative' using errcode = '22023'; end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and business_id = p_business) then raise exception 'customer not found' using errcode = '22023'; end if;
  if p_lead is not null and not exists (select 1 from public.crm_leads where id = p_lead and business_id = p_business) then raise exception 'lead not found' using errcode = '22023'; end if;
  if p_owner is not null and not exists (select 1 from public.business_members where business_id = p_business and user_id = p_owner and status = 'active') then raise exception 'that person is not on this business' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.crm_deals (id, business_id, title, customer_id, lead_id, value, expected_close, owner_id, notes)
    values (v_id, p_business, btrim(p_title), p_customer, p_lead, round(coalesce(p_value, 0), 2), p_expected, p_owner, coalesce(p_notes, ''));
    insert into public.crm_deal_events (business_id, deal_id, from_stage, to_stage, by_user) values (p_business, v_id, null, 'new', auth.uid());
  else
    select stage into v_stage from public.crm_deals where id = p_id and business_id = p_business for update;
    if not found then raise exception 'deal not found' using errcode = '22023'; end if;
    update public.crm_deals set title = btrim(p_title), customer_id = p_customer, lead_id = p_lead, value = round(coalesce(p_value, 0), 2), expected_close = p_expected, owner_id = p_owner, notes = coalesce(p_notes, '')
     where id = p_id and business_id = p_business;
  end if;
  return v_id;
end $$;

create function public.crm_move_deal(p_deal uuid, p_stage text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.crm_deals;
begin
  select * into d from public.crm_deals where id = p_deal;
  if not found then raise exception 'deal not found' using errcode = '22023'; end if;
  perform public._guard(d.business_id, 'customers', 'customers.manage');
  if p_stage is null or p_stage not in ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost') then raise exception 'choose a stage: new, qualified, proposal, negotiation, won or lost' using errcode = '22023'; end if;
  select * into d from public.crm_deals where id = p_deal for update;
  if d.stage = p_stage then return; end if;
  if p_stage = 'lost' and length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'say why the deal was lost' using errcode = '22023'; end if;
  update public.crm_deals set stage = p_stage,
    lost_reason = case when p_stage = 'lost' then btrim(p_reason) else null end,
    closed_at = case when p_stage in ('won', 'lost') then now() else null end
   where id = p_deal;
  insert into public.crm_deal_events (business_id, deal_id, from_stage, to_stage, note, by_user)
  values (d.business_id, p_deal, d.stage, p_stage, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
end $$;

-- A quote's lines are [{description, quantity, unit_price}]; the subtotal and total are worked out here.
create function public.crm_save_quote(p_business uuid, p_id uuid, p_deal uuid, p_customer uuid, p_lead uuid, p_valid date, p_lines jsonb, p_discount numeric, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_status text; v_sub numeric := 0; v_line jsonb; v_clean jsonb := '[]'::jsonb; v_qty numeric; v_price numeric; v_disc numeric := round(coalesce(p_discount, 0), 2);
begin
  perform public._guard(p_business, 'customers', 'customers.manage');
  if p_deal is null and p_customer is null and p_lead is null then raise exception 'choose the customer, lead or deal this quote is for' using errcode = '22023'; end if;
  if p_deal is not null then
    if not exists (select 1 from public.crm_deals where id = p_deal and business_id = p_business) then raise exception 'deal not found' using errcode = '22023'; end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line to the quote' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'a quote can have at most 100 lines' using errcode = '22023'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if length(btrim(coalesce(v_line ->> 'description', ''))) = 0 then raise exception 'every line needs a description' using errcode = '22023'; end if;
    begin v_qty := (v_line ->> 'quantity')::numeric; v_price := (v_line ->> 'unit_price')::numeric;
    exception when others then raise exception 'the quantity and price of every line must be numbers' using errcode = '22023'; end;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then raise exception 'every line needs a quantity above zero and a price of zero or more' using errcode = '22023'; end if;
    v_sub := v_sub + round(v_qty * v_price, 2);
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('description', btrim(v_line ->> 'description'), 'quantity', v_qty, 'unit_price', round(v_price, 2)));
  end loop;
  if v_disc < 0 or v_disc > v_sub then raise exception 'the discount cannot be more than the quote total' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.crm_quotes (id, business_id, number, deal_id, customer_id, lead_id, valid_until, lines, discount, subtotal, total, notes)
    values (v_id, p_business, public._next_number(p_business, 'quote', 'QUO'), p_deal, p_customer, p_lead, p_valid, v_clean, v_disc, v_sub, v_sub - v_disc, coalesce(p_notes, ''));
  else
    select status into v_status from public.crm_quotes where id = p_id and business_id = p_business for update;
    if not found then raise exception 'quote not found' using errcode = '22023'; end if;
    if v_status <> 'draft' then raise exception 'a quote that has been sent can no longer be changed; make a new one' using errcode = '22023'; end if;
    update public.crm_quotes set deal_id = p_deal, customer_id = p_customer, lead_id = p_lead, valid_until = p_valid, lines = v_clean, discount = v_disc, subtotal = v_sub, total = v_sub - v_disc, notes = coalesce(p_notes, '')
     where id = p_id and business_id = p_business;
  end if;
  return v_id;
end $$;

create function public.crm_set_quote_status(p_quote uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.crm_quotes;
begin
  select * into q from public.crm_quotes where id = p_quote;
  if not found then raise exception 'quote not found' using errcode = '22023'; end if;
  perform public._guard(q.business_id, 'customers', 'customers.manage');
  if p_status is null or p_status not in ('sent', 'accepted', 'declined') then raise exception 'choose sent, accepted or declined' using errcode = '22023'; end if;
  if (q.status = 'draft' and p_status not in ('sent')) or (q.status = 'sent' and p_status not in ('accepted', 'declined')) or q.status in ('accepted', 'declined') then
    raise exception 'a % quote cannot be marked %', q.status, p_status using errcode = '22023';
  end if;
  update public.crm_quotes set status = p_status where id = p_quote;
end $$;

-- Figures for the CRM report page.
create function public.crm_report(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', current_date)::date; v_won int; v_lost int;
begin
  if not public.has_module_permission(p_business, 'customers', 'customers.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  select count(*) filter (where stage = 'won'), count(*) filter (where stage = 'lost') into v_won, v_lost from public.crm_deals where business_id = p_business;
  return jsonb_build_object(
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', s, 'deals', n, 'value', v) order by o) from (
        select x.s, x.o, count(d.id) as n, coalesce(sum(d.value), 0) as v
          from (values ('new', 1), ('qualified', 2), ('proposal', 3), ('negotiation', 4), ('won', 5), ('lost', 6)) as x(s, o)
          left join public.crm_deals d on d.business_id = p_business and d.stage = x.s group by x.s, x.o) t), '[]'::jsonb),
    'open_value', (select coalesce(sum(value), 0) from public.crm_deals where business_id = p_business and stage not in ('won', 'lost')),
    'open_deals', (select count(*) from public.crm_deals where business_id = p_business and stage not in ('won', 'lost')),
    'won_this_month', (select coalesce(sum(value), 0) from public.crm_deals where business_id = p_business and stage = 'won' and closed_at >= v_month),
    'won_deals_this_month', (select count(*) from public.crm_deals where business_id = p_business and stage = 'won' and closed_at >= v_month),
    'win_rate', case when v_won + v_lost = 0 then null else round(v_won * 100.0 / (v_won + v_lost), 1) end,
    'leads', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.crm_leads where business_id = p_business group by status) l), '{}'::jsonb),
    'overdue_tasks', (select count(*) from public.crm_tasks where business_id = p_business and status = 'open' and due_at < now()),
    'due_today', (select count(*) from public.crm_tasks where business_id = p_business and status = 'open' and due_at::date = current_date),
    'lost_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', r, 'deals', n) order by n desc) from (select lost_reason as r, count(*) as n from public.crm_deals where business_id = p_business and stage = 'lost' group by 1 order by 2 desc limit 5) z), '[]'::jsonb)
  );
end $$;

revoke execute on function public.crm_save_deal(uuid, uuid, text, uuid, uuid, numeric, date, uuid, text), public.crm_move_deal(uuid, text, text),
  public.crm_save_quote(uuid, uuid, uuid, uuid, uuid, date, jsonb, numeric, text), public.crm_set_quote_status(uuid, text), public.crm_report(uuid) from public;
grant execute on function public.crm_save_deal(uuid, uuid, text, uuid, uuid, numeric, date, uuid, text), public.crm_move_deal(uuid, text, text),
  public.crm_save_quote(uuid, uuid, uuid, uuid, uuid, date, jsonb, numeric, text), public.crm_set_quote_status(uuid, text), public.crm_report(uuid) to authenticated;
