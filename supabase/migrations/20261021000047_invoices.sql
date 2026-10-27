-- DOA Invoices: a standalone app (any business, any industry that allows it) for invoices, their payments and what is still owed.
--   * Customers are the CRM's customers. A quote the CRM marked accepted becomes a draft invoice once (invoices.quote_id is unique).
--   * Money is worked out here: line totals, discount, tax, what is paid and what is owed. The browser never supplies a total.
--   * Payments are never edited or deleted, only reversed with a reason. Recording a payment needs an idempotency key, so a double click or a retry
--     cannot book it twice.
--   * Finance does not get a second copy. Invoice payments are rows of the existing `cashbook` view (cash in) and unpaid invoices are rows of the
--     existing `receivables` view, so every report that already reads those sees them once. Sales keep using their own payments.
--   * Invoice status is stored as draft, sent, partially_paid, paid or cancelled. "Overdue" is not stored: it is an unpaid invoice past its due date.
-- Additive apart from replacing the two views and report_summary (their existing columns and keys are unchanged; one column and one key are added).
-- Rollback: restore the views and report_summary from 0010, then drop the objects created here.

insert into public.permissions (code, description) values
  ('invoices.read', 'View invoices and their payments'),
  ('invoices.manage', 'Create, send and cancel invoices, record and reverse their payments');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('invoices.read', 'invoices.manage') and (
  r.name in ('owner', 'business_admin', 'manager', 'accountant')
) where r.business_id is null;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'invoices.read' and r.name = 'viewer' where r.business_id is null;

insert into public.modules (code, name, description, is_core, required_permission) values
  ('invoices', 'Invoices', 'Quotes become invoices; record payments and see what is owed.', false, 'invoices.read');

-- Business apps uses it by default; every industry that already uses the shared sales apps may switch it on.
insert into public.industry_template_modules (industry_template_id, module_id, is_default, is_required)
select t.id, m.id, t.code = 'general', false
from public.industry_templates t join public.modules m on m.code = 'invoices'
where t.code in ('general', 'retail', 'farm', 'bakery', 'pharmacy')
on conflict do nothing;

insert into public.plan_modules (plan_id, module_id, included)
select p.id, m.id, true from public.subscription_plans p, public.modules m where m.code = 'invoices';

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m where b.primary_industry_code = 'general' and m.code = 'invoices'
on conflict (business_id, module_id) do nothing;

-- Free first: the Starter and Basic plans include Expenses and Reports (the money screens). Purchases and Suppliers stay on the paid plans.
update public.plan_modules pm set included = true
from public.subscription_plans p, public.modules m
where pm.plan_id = p.id and pm.module_id = m.id and p.code in ('starter', 'basic') and m.code in ('expenses', 'reports');

-- ------------------------------------------------------------------ tables
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  customer_id uuid not null,
  quote_id uuid,
  status text not null default 'draft' check (status in ('draft', 'sent', 'partially_paid', 'paid', 'cancelled')),
  issued_on date not null default current_date,
  due_on date,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  tax_percent numeric(5, 2) not null default 0 check (tax_percent between 0 and 100),
  subtotal numeric(14, 2) not null default 0,
  tax_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  notes text not null default '',
  cancel_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, quote_id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, quote_id) references public.crm_quotes (business_id, id),
  check (status <> 'cancelled' or cancel_reason is not null),
  check (due_on is null or due_on >= issued_on)
);
create index invoices_status_idx on public.invoices (business_id, status);
create index invoices_customer_idx on public.invoices (business_id, customer_id);
create trigger invoices_updated before update on public.invoices for each row execute function public.set_updated_at();
create trigger invoices_creator before insert on public.invoices for each row execute function public.crm_set_creator();

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  invoice_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'bank_transfer', 'card', 'pos', 'other')),
  paid_on date not null default current_date,
  reference text,
  status text not null default 'successful' check (status in ('successful', 'reversed')),
  reversal_reason text,
  reversed_at timestamptz,
  idempotency_key text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, invoice_id) references public.invoices (business_id, id),
  check (status = 'successful' or reversal_reason is not null)
);
create index invoice_payments_invoice_idx on public.invoice_payments (business_id, invoice_id);
create trigger invoice_payments_creator before insert on public.invoice_payments for each row execute function public.crm_set_creator();

-- Payments are financial records: only the reversal fields may change, and never back.
create function public.invoice_payments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'invoice payments cannot be deleted; reverse them' using errcode = '42501'; end if;
  if (new.business_id, new.invoice_id, new.amount, new.method, new.paid_on, new.reference, new.idempotency_key)
     is distinct from (old.business_id, old.invoice_id, old.amount, old.method, old.paid_on, old.reference, old.idempotency_key) then
    raise exception 'payment details are immutable' using errcode = '42501';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then raise exception 'a reversed payment cannot be restored' using errcode = '42501'; end if;
  return new;
end $$;
create trigger invoice_payments_no_change before update or delete on public.invoice_payments for each row execute function public.invoice_payments_guard();

create function public.invoices_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'invoices cannot be deleted; cancel them' using errcode = '42501'; end if;
  return new;
end $$;
create trigger invoices_no_delete before delete on public.invoices for each row execute function public.invoices_guard();

alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
-- Whoever reads invoices, and whoever reads the money reports (Finance reads these through the cashbook and receivables views).
create policy invoices_select on public.invoices for select to authenticated
  using (public.has_module_permission(business_id, 'invoices', 'invoices.read', 'read') or public.has_business_permission(business_id, 'reports.finance.read'));
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (public.has_module_permission(business_id, 'invoices', 'invoices.read', 'read') or public.has_business_permission(business_id, 'reports.finance.read'));
grant select on public.invoices, public.invoice_payments to authenticated;

create trigger audit_invoices after insert or update on public.invoices for each row execute function public.audit_row_change();
create trigger audit_invoice_payments after insert or update on public.invoice_payments for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- functions
-- Checks the lines of an invoice and returns them tidied, with the subtotal.
create function public._invoice_lines(p_lines jsonb, out o_lines jsonb, out o_subtotal numeric)
language plpgsql immutable set search_path = '' as $$
declare v_line jsonb; v_qty numeric; v_price numeric;
begin
  o_lines := '[]'::jsonb; o_subtotal := 0;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line to the invoice' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'an invoice can have at most 100 lines' using errcode = '22023'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if length(btrim(coalesce(v_line ->> 'description', ''))) = 0 then raise exception 'every line needs a description' using errcode = '22023'; end if;
    begin v_qty := (v_line ->> 'quantity')::numeric; v_price := (v_line ->> 'unit_price')::numeric;
    exception when others then raise exception 'the quantity and price of every line must be numbers' using errcode = '22023'; end;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then raise exception 'every line needs a quantity above zero and a price of zero or more' using errcode = '22023'; end if;
    o_subtotal := o_subtotal + round(v_qty * v_price, 2);
    o_lines := o_lines || jsonb_build_array(jsonb_build_object('description', btrim(v_line ->> 'description'), 'quantity', v_qty, 'unit_price', round(v_price, 2)));
  end loop;
end $$;

-- What has been paid decides paid, partially paid or sent again (after a reversal). Draft and cancelled invoices keep their status.
create function public._invoice_recompute(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_paid numeric;
begin
  select * into i from public.invoices where id = p_invoice for update;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = p_invoice and status = 'successful';
  update public.invoices set amount_paid = v_paid,
    status = case when i.status in ('draft', 'cancelled') then i.status when v_paid >= i.total then 'paid' when v_paid > 0 then 'partially_paid' else 'sent' end
   where id = p_invoice;
end $$;

create function public.invoice_save(p_business uuid, p_id uuid, p_customer uuid, p_due date, p_lines jsonb, p_discount numeric, p_tax numeric, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_status text; v_lines jsonb; v_sub numeric; v_disc numeric := round(coalesce(p_discount, 0), 2); v_tax numeric := coalesce(p_tax, 0); v_tax_amt numeric; v_issued date;
begin
  perform public._guard(p_business, 'invoices', 'invoices.manage');
  if p_customer is null or not exists (select 1 from public.customers where id = p_customer and business_id = p_business and status = 'active') then raise exception 'choose the customer this invoice is for' using errcode = '22023'; end if;
  select o_lines, o_subtotal into v_lines, v_sub from public._invoice_lines(p_lines);
  if v_disc < 0 or v_disc > v_sub then raise exception 'the discount cannot be more than the invoice total' using errcode = '22023'; end if;
  if v_tax < 0 or v_tax > 100 then raise exception 'the tax rate must be between 0 and 100' using errcode = '22023'; end if;
  v_tax_amt := round((v_sub - v_disc) * v_tax / 100, 2);
  if p_id is null then
    v_issued := current_date;
    if p_due is not null and p_due < v_issued then raise exception 'the due date cannot be before the invoice date' using errcode = '22023'; end if;
    insert into public.invoices (id, business_id, number, customer_id, issued_on, due_on, lines, discount, tax_percent, subtotal, tax_amount, total, notes)
    values (v_id, p_business, public._next_number(p_business, 'invoice', 'INV'), p_customer, v_issued, p_due, v_lines, v_disc, v_tax, v_sub, v_tax_amt, v_sub - v_disc + v_tax_amt, coalesce(p_notes, ''));
  else
    select status, issued_on into v_status, v_issued from public.invoices where id = p_id and business_id = p_business for update;
    if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
    if v_status <> 'draft' then raise exception 'an invoice that has been sent can no longer be changed; cancel it and make a new one' using errcode = '22023'; end if;
    if p_due is not null and p_due < v_issued then raise exception 'the due date cannot be before the invoice date' using errcode = '22023'; end if;
    update public.invoices set customer_id = p_customer, due_on = p_due, lines = v_lines, discount = v_disc, tax_percent = v_tax, subtotal = v_sub, tax_amount = v_tax_amt, total = v_sub - v_disc + v_tax_amt, notes = coalesce(p_notes, '')
     where id = p_id and business_id = p_business;
  end if;
  return v_id;
end $$;

-- An accepted quote becomes a draft invoice, once. The quote must be for a customer (a lead has to be converted first).
create function public.invoice_from_quote(p_quote uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare q public.crm_quotes; v_customer uuid; v_id uuid := gen_random_uuid(); v_lines jsonb; v_sub numeric; v_tax numeric := 0; v_tax_amt numeric;
begin
  select * into q from public.crm_quotes where id = p_quote;
  if not found then raise exception 'quote not found' using errcode = '22023'; end if;
  perform public._guard(q.business_id, 'invoices', 'invoices.manage');
  if q.status <> 'accepted' then raise exception 'only an accepted quote can be turned into an invoice' using errcode = '22023'; end if;
  if exists (select 1 from public.invoices where quote_id = p_quote) then raise exception 'this quote has already been invoiced' using errcode = '22023'; end if;
  v_customer := coalesce(q.customer_id, (select d.customer_id from public.crm_deals d where d.id = q.deal_id), (select l.customer_id from public.crm_leads l where l.id = q.lead_id));
  if v_customer is null then raise exception 'this quote is for a lead; convert the lead to a customer first' using errcode = '22023'; end if;
  select o_lines, o_subtotal into v_lines, v_sub from public._invoice_lines(q.lines);
  v_tax_amt := 0;
  insert into public.invoices (id, business_id, number, customer_id, quote_id, issued_on, lines, discount, tax_percent, subtotal, tax_amount, total, notes)
  values (v_id, q.business_id, public._next_number(q.business_id, 'invoice', 'INV'), v_customer, p_quote, current_date, v_lines, q.discount, v_tax, v_sub, v_tax_amt, v_sub - q.discount + v_tax_amt, q.notes);
  return v_id;
end $$;

create function public.invoice_send(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  if i.status <> 'draft' then raise exception 'only a draft invoice can be sent' using errcode = '22023'; end if;
  update public.invoices set status = 'sent' where id = p_invoice;
  perform public._invoice_recompute(p_invoice);
end $$;

create function public.invoice_cancel(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  select * into i from public.invoices where id = p_invoice for update;
  if i.status = 'cancelled' then raise exception 'the invoice is already cancelled' using errcode = '22023'; end if;
  if exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'successful') then raise exception 'reverse the payments on this invoice before cancelling it' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.invoices set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_invoice;
end $$;

create function public.invoice_record_payment(p_invoice uuid, p_amount numeric, p_method text, p_paid_on date, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_prev jsonb; v_id uuid := gen_random_uuid(); v_amount numeric := round(coalesce(p_amount, 0), 2); v_date date := coalesce(p_paid_on, current_date);
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  v_prev := public._idem_check(i.business_id, p_key, 'invoice_payment'); if v_prev is not null then return v_prev; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if i.status not in ('sent', 'partially_paid') then raise exception 'payments can only be recorded on a sent invoice that is not fully paid' using errcode = '22023'; end if;
  if v_amount <= 0 then raise exception 'enter the amount received' using errcode = '22023'; end if;
  if v_amount > i.total - i.amount_paid then raise exception 'that is more than the balance of %', to_char(i.total - i.amount_paid, 'FM999G999G999G990D00') using errcode = '22023'; end if;
  if v_date > current_date then raise exception 'the payment date cannot be in the future' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'card', 'pos', 'other') then raise exception 'choose how it was paid' using errcode = '22023'; end if;
  insert into public.invoice_payments (id, business_id, invoice_id, amount, method, paid_on, reference, idempotency_key)
  values (v_id, i.business_id, p_invoice, v_amount, p_method, v_date, nullif(btrim(coalesce(p_reference, '')), ''), p_key);
  perform public._invoice_recompute(p_invoice);
  return public._idem_store(i.business_id, p_key, 'invoice_payment', jsonb_build_object('payment_id', v_id, 'amount_paid', (select amount_paid from public.invoices where id = p_invoice), 'status', (select status from public.invoices where id = p_invoice)));
end $$;

create function public.invoice_reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.invoice_payments;
begin
  select * into p from public.invoice_payments where id = p_payment;
  if not found then raise exception 'payment not found' using errcode = '22023'; end if;
  perform public._guard(p.business_id, 'invoices', 'invoices.manage');
  select * into p from public.invoice_payments where id = p_payment for update;
  if p.status = 'reversed' then raise exception 'this payment is already reversed' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.invoice_payments set status = 'reversed', reversal_reason = btrim(p_reason), reversed_at = now() where id = p_payment;
  perform public._invoice_recompute(p.invoice_id);
end $$;

-- Counts and amounts for the Invoices summary. Overdue = not fully paid and past the due date.
create function public.invoice_summary(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, 'invoices', 'invoices.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'outstanding', (select coalesce(sum(total - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid')),
    'overdue', (select coalesce(sum(total - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on < current_date),
    'overdue_count', (select count(*) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on < current_date),
    'paid_this_month', (select coalesce(sum(amount), 0) from public.invoice_payments where business_id = p_business and status = 'successful' and paid_on >= date_trunc('month', current_date)::date),
    'drafts', (select count(*) from public.invoices where business_id = p_business and status = 'draft'),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.invoices where business_id = p_business group by status) s), '{}'::jsonb));
end $$;

-- ------------------------------------------------- Finance reads the same ledgers
-- An unpaid or part-paid invoice is a receivable; a successful invoice payment is cash in. Columns are unchanged, one is added (source).
create or replace view public.receivables with (security_invoker = true) as
select s.id as sale_id, s.business_id, s.sale_number, s.customer_id, c.name as customer_name, s.sold_at,
  s.grand_total, s.amount_paid, s.balance_due, (current_date - s.sold_at::date) as age_days, 'sale'::text as source
from public.sales s left join public.customers c on c.business_id = s.business_id and c.id = s.customer_id
where s.status <> 'voided' and s.balance_due > 0
union all
select i.id, i.business_id, i.number, i.customer_id, c.name, i.issued_on::timestamptz,
  i.total, i.amount_paid, (i.total - i.amount_paid)::numeric(14, 2), (current_date - i.issued_on), 'invoice'::text
from public.invoices i join public.customers c on c.business_id = i.business_id and c.id = i.customer_id
where i.status in ('sent', 'partially_paid') and i.total - i.amount_paid > 0;

create or replace view public.cashbook with (security_invoker = true) as
select pay.business_id, coalesce(pay.received_at, pay.created_at) as entry_at, pay.payment_type as kind,
  case when pay.payment_type = 'sale_receipt' then 'in' else 'out' end as direction,
  pay.payment_method as method, pay.amount, coalesce(s.sale_number, pu.purchase_number) as reference, pay.id as source_id
from public.payments pay
left join public.sales s on s.business_id = pay.business_id and s.id = pay.sale_id
left join public.purchases pu on pu.business_id = pay.business_id and pu.id = pay.purchase_id
where pay.status = 'successful'
union all
select e.business_id, e.expense_date::timestamptz, 'expense', 'out', e.payment_method, e.amount, e.expense_number, e.id
from public.expenses e where e.status = 'posted'
union all
select ip.business_id, ip.paid_on::timestamptz, 'invoice_receipt', 'in', ip.method, ip.amount, i.number, ip.id
from public.invoice_payments ip join public.invoices i on i.business_id = ip.business_id and i.id = ip.invoice_id
where ip.status = 'successful';
grant select on public.receivables, public.cashbook to authenticated;

-- The summary report, as before, plus what was invoiced in the period.
create or replace function public.report_summary(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz;
  v_sales numeric; v_sales_n int; v_purchases numeric; v_expenses numeric; v_cash_in numeric; v_cash_out numeric;
  v_receivable numeric; v_payable numeric; v_stock numeric; v_by_cat jsonb; v_invoiced numeric;
begin
  if not public.has_module_permission(p_business, 'reports', 'reports.finance.read', 'use') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'choose a valid period' using errcode = '22023'; end if;
  select coalesce(sum(grand_total - returned_total), 0), count(*) into v_sales, v_sales_n from public.sales
   where business_id = p_business and status <> 'voided' and sold_at >= v_from and sold_at < v_to;
  select coalesce(sum(total_amount), 0) into v_purchases from public.purchases
   where business_id = p_business and status <> 'cancelled' and purchased_at >= v_from and purchased_at < v_to;
  select coalesce(sum(amount), 0) into v_expenses from public.expenses
   where business_id = p_business and status = 'posted' and expense_date between p_from and p_to;
  select coalesce(sum(amount) filter (where direction = 'in'), 0), coalesce(sum(amount) filter (where direction = 'out'), 0)
    into v_cash_in, v_cash_out from public.cashbook where business_id = p_business and entry_at >= v_from and entry_at < v_to;
  select coalesce(sum(balance_due), 0) into v_receivable from public.receivables where business_id = p_business;
  select coalesce(sum(balance_due), 0) into v_payable from public.payables where business_id = p_business;
  select coalesce(sum(quantity_on_hand * coalesce(avg_unit_cost, 0)), 0) into v_stock from public.inventory_balances where business_id = p_business;
  select coalesce(jsonb_object_agg(category, total), '{}'::jsonb) into v_by_cat from (
    select category, sum(amount) as total from public.expenses
     where business_id = p_business and status = 'posted' and expense_date between p_from and p_to group by category) c;
  select coalesce(sum(total), 0) into v_invoiced from public.invoices where business_id = p_business and status in ('sent', 'partially_paid', 'paid') and issued_on between p_from and p_to;
  return jsonb_build_object(
    'sales_count', v_sales_n, 'sales_total', v_sales, 'purchases_total', v_purchases, 'expenses_total', v_expenses,
    'expenses_by_category', v_by_cat, 'cash_in', v_cash_in, 'cash_out', v_cash_out, 'operating_surplus', v_cash_in - v_cash_out,
    'receivables_open', v_receivable, 'payables_open', v_payable, 'stock_value', v_stock, 'invoiced_total', v_invoiced);
end $$;

revoke execute on function public._invoice_lines(jsonb), public._invoice_recompute(uuid), public.invoice_payments_guard(), public.invoices_guard(),
  public.invoice_save(uuid, uuid, uuid, date, jsonb, numeric, numeric, text), public.invoice_from_quote(uuid), public.invoice_send(uuid), public.invoice_cancel(uuid, text),
  public.invoice_record_payment(uuid, numeric, text, date, text, text), public.invoice_reverse_payment(uuid, text), public.invoice_summary(uuid) from public;
grant execute on function public.invoice_save(uuid, uuid, uuid, date, jsonb, numeric, numeric, text), public.invoice_from_quote(uuid), public.invoice_send(uuid), public.invoice_cancel(uuid, text),
  public.invoice_record_payment(uuid, numeric, text, date, text, text), public.invoice_reverse_payment(uuid, text), public.invoice_summary(uuid) to authenticated;
