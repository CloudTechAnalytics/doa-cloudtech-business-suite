-- Finance: expenses, receivables, payables, cashbook and the summary report (ported from the farm reference system's
-- finance design, on top of the existing sales, purchases and payments tables).
--   * Cash basis: income is recognised when a payment is received, an expense when it is paid. Unpaid invoices are
--     receivables; unpaid purchase orders are payables. Nothing is double counted.
--   * "Operating surplus" is cash in minus cash out. It is not accounting profit (no stock valuation, no depreciation).
--   * Receivables, payables and the cashbook are read-only views over existing ledgers, so they can never drift.
-- Additive only. Rollback: drop the objects created here.

-- The Reports module shows financial figures, so it needs the financial-reports permission to be visible.
update public.modules set required_permission = 'reports.finance.read' where code = 'reports';

-- Either of these modules may carry a farm's money screens (farms use Farm Expenses; other industries use Expenses).
create function public._guard_any(p_business uuid, p_modules text[], p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare m text;
begin
  foreach m in array p_modules loop
    if public.has_module_permission(p_business, m, p_permission, 'use') then return; end if;
  end loop;
  raise exception 'permission denied' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- expenses
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  expense_number text not null,
  category text not null check (category in ('feed', 'labour', 'medication', 'fuel_energy', 'repairs', 'transport', 'utilities', 'rent', 'supplies', 'other')),
  amount numeric(14, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'card', 'pos', 'other')),
  description text not null check (length(btrim(description)) between 2 and 300),
  expense_date date not null default current_date,
  supplier_id uuid,
  farm_batch_id uuid,
  source text not null default 'manual' check (source in ('manual', 'maintenance')),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  voided_at timestamptz,
  created_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, expense_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, farm_batch_id) references public.farm_batches (business_id, id),
  check (status = 'posted' or void_reason is not null)
);
create index expenses_date_idx on public.expenses (business_id, expense_date desc);
create index expenses_batch_idx on public.expenses (farm_batch_id) where farm_batch_id is not null;

-- Financial records: only the void fields may change, and never back.
create function public.expenses_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'expenses cannot be deleted; void them' using errcode = '42501'; end if;
  if (new.business_id, new.expense_number, new.category, new.amount, new.payment_method, new.description, new.expense_date, new.supplier_id, new.farm_batch_id, new.source)
     is distinct from (old.business_id, old.expense_number, old.category, old.amount, old.payment_method, old.description, old.expense_date, old.supplier_id, old.farm_batch_id, old.source) then
    raise exception 'expense details are immutable; void and re-enter' using errcode = '42501';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then raise exception 'a voided expense cannot be reopened' using errcode = '42501'; end if;
  return new;
end $$;
create trigger expenses_guard_trg before update or delete on public.expenses
  for each row execute function public.expenses_guard();
create trigger audit_expenses after insert or update on public.expenses for each row execute function public.audit_row_change();

alter table public.expenses enable row level security;
create policy expenses_select on public.expenses for select to authenticated using (
  public.has_module_permission(business_id, 'expenses', 'expenses.read', 'read')
  or public.has_module_permission(business_id, 'farm-expenses', 'expenses.read', 'read'));
grant select on public.expenses to authenticated;

create function public.record_expense(
  p_business uuid, p_category text, p_amount numeric, p_method text, p_description text, p_date date,
  p_supplier uuid, p_batch uuid, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text;
begin
  perform public._guard_any(p_business, array['expenses', 'farm-expenses'], 'expenses.record');
  v_prev := public._idem_check(p_business, p_key, 'expense_record'); if v_prev is not null then return v_prev; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then raise exception 'amount must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date then raise exception 'the expense date cannot be in the future' using errcode = '22023'; end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and business_id = p_business) then
    raise exception 'unknown supplier' using errcode = '22023';
  end if;
  if p_batch is not null and not exists (select 1 from public.farm_batches where id = p_batch and business_id = p_business) then
    raise exception 'unknown batch' using errcode = '22023';
  end if;
  v_number := public._next_number(p_business, 'expense', 'EXP');
  insert into public.expenses (id, business_id, expense_number, category, amount, payment_method, description, expense_date, supplier_id, farm_batch_id, created_by, idempotency_key)
  values (v_id, p_business, v_number, p_category, p_amount, p_method, btrim(p_description), p_date, p_supplier, p_batch, auth.uid(), p_key);
  return public._idem_store(p_business, p_key, 'expense_record', jsonb_build_object('expense_id', v_id, 'expense_number', v_number));
end $$;

create function public.void_expense(p_expense uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.expenses; v_prev jsonb;
begin
  select * into e from public.expenses where id = p_expense;
  if not found then raise exception 'expense not found' using errcode = '22023'; end if;
  perform public._guard_any(e.business_id, array['expenses', 'farm-expenses'], 'expenses.record');
  v_prev := public._idem_check(e.business_id, p_key, 'expense_void'); if v_prev is not null then return v_prev; end if;
  select * into e from public.expenses where id = p_expense for update;
  if e.status = 'voided' then raise exception 'expense is already voided' using errcode = '22023'; end if;
  if e.source <> 'manual' then raise exception 'this expense was created by another record; correct it there' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.expenses set status = 'voided', void_reason = btrim(p_reason), voided_at = now() where id = p_expense;
  return public._idem_store(e.business_id, p_key, 'expense_void', jsonb_build_object('expense_id', p_expense));
end $$;

-- ------------------------------------------------- receivables and payables
-- Open invoices and purchase orders with what is still owed and how old they are.
create view public.receivables with (security_invoker = true) as
select s.id as sale_id, s.business_id, s.sale_number, s.customer_id, c.name as customer_name, s.sold_at,
  s.grand_total, s.amount_paid, s.balance_due, (current_date - s.sold_at::date) as age_days
from public.sales s left join public.customers c on c.business_id = s.business_id and c.id = s.customer_id
where s.status <> 'voided' and s.balance_due > 0;

create view public.payables with (security_invoker = true) as
select p.id as purchase_id, p.business_id, p.purchase_number, p.supplier_id, sp.name as supplier_name, p.purchased_at,
  p.total_amount, p.amount_paid, (p.total_amount - p.amount_paid) as balance_due, (current_date - p.purchased_at::date) as age_days
from public.purchases p join public.suppliers sp on sp.business_id = p.business_id and sp.id = p.supplier_id
where p.status <> 'cancelled' and p.total_amount - p.amount_paid > 0;

-- ---------------------------------------------------------------- cashbook
-- Every recorded cash movement in one list: successful payments and posted expenses. Reversed payments and voided
-- expenses are not cash movements and are left out.
create view public.cashbook with (security_invoker = true) as
select pay.business_id, coalesce(pay.received_at, pay.created_at) as entry_at, pay.payment_type as kind,
  case when pay.payment_type = 'sale_receipt' then 'in' else 'out' end as direction,
  pay.payment_method as method, pay.amount, coalesce(s.sale_number, pu.purchase_number) as reference, pay.id as source_id
from public.payments pay
left join public.sales s on s.business_id = pay.business_id and s.id = pay.sale_id
left join public.purchases pu on pu.business_id = pay.business_id and pu.id = pay.purchase_id
where pay.status = 'successful'
union all
select e.business_id, e.expense_date::timestamptz, 'expense', 'out', e.payment_method, e.amount, e.expense_number, e.id
from public.expenses e where e.status = 'posted';

grant select on public.receivables, public.payables, public.cashbook to authenticated;

-- ------------------------------------------------------------ summary report
create function public.report_summary(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz;
  v_sales numeric; v_sales_n int; v_purchases numeric; v_expenses numeric; v_cash_in numeric; v_cash_out numeric;
  v_receivable numeric; v_payable numeric; v_stock numeric; v_by_cat jsonb;
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
  return jsonb_build_object(
    'sales_count', v_sales_n, 'sales_total', v_sales, 'purchases_total', v_purchases, 'expenses_total', v_expenses,
    'expenses_by_category', v_by_cat, 'cash_in', v_cash_in, 'cash_out', v_cash_out, 'operating_surplus', v_cash_in - v_cash_out,
    'receivables_open', v_receivable, 'payables_open', v_payable, 'stock_value', v_stock);
end $$;

revoke all on function public._guard_any(uuid, text[], text), public.expenses_guard(),
  public.record_expense(uuid, text, numeric, text, text, date, uuid, uuid, text), public.void_expense(uuid, text, text),
  public.report_summary(uuid, date, date) from public;
grant execute on function public.record_expense(uuid, text, numeric, text, text, date, uuid, uuid, text), public.void_expense(uuid, text, text),
  public.report_summary(uuid, date, date) to authenticated;
