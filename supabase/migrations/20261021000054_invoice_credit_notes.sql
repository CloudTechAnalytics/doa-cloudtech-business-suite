-- Invoices: credit notes.
--   * A credit note lowers what a customer owes on a sent invoice (goods returned, a price corrected, goodwill) without cancelling it and without touching payments.
--   * It is a financial record: it has its own number (CN-000001), a reason, and can never be edited or deleted.
--   * The invoice keeps its total; `credited` is the sum of its credit notes. Balance = total - credited - paid. An invoice whose credits and payments cover the
--     total is Paid (or Credited, when nothing was paid and the credits cover everything). Credits only apply to a sent invoice that is not yet fully settled.
--   * Finance reads the lower figure: receivables and the invoiced total are net of credit notes.
-- Additive, except that five functions and two views are replaced to subtract credits. Rollback: drop the table and the column, and re-apply 0047's definitions.

alter table public.invoices add column credited numeric(14, 2) not null default 0 check (credited >= 0);
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check check (status in ('draft', 'sent', 'partially_paid', 'paid', 'credited', 'cancelled'));

create table public.invoice_credit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  invoice_id uuid not null,
  number text not null,
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) >= 3),
  issued_on date not null default current_date,
  idempotency_key text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, invoice_id) references public.invoices (business_id, id)
);
create index invoice_credit_notes_invoice_idx on public.invoice_credit_notes (business_id, invoice_id);
create trigger invoice_credit_notes_creator before insert on public.invoice_credit_notes for each row execute function public.crm_set_creator();

create function public.invoice_credit_notes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'credit notes cannot be changed or deleted' using errcode = '42501';
end $$;
create trigger invoice_credit_notes_no_change before update or delete on public.invoice_credit_notes for each row execute function public.invoice_credit_notes_guard();

alter table public.invoice_credit_notes enable row level security;
create policy invoice_credit_notes_select on public.invoice_credit_notes for select to authenticated
  using (public.has_module_permission(business_id, 'invoices', 'invoices.read', 'read') or public.has_business_permission(business_id, 'reports.finance.read'));
grant select on public.invoice_credit_notes to authenticated;
create trigger audit_invoice_credit_notes after insert on public.invoice_credit_notes for each row execute function public.audit_row_change();

-- What has been paid and credited decides the status. Draft and cancelled invoices keep theirs.
create or replace function public._invoice_recompute(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_paid numeric; v_cred numeric;
begin
  select * into i from public.invoices where id = p_invoice for update;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = p_invoice and status = 'successful';
  select coalesce(sum(amount), 0) into v_cred from public.invoice_credit_notes where invoice_id = p_invoice;
  update public.invoices set amount_paid = v_paid, credited = v_cred,
    status = case
      when i.status in ('draft', 'cancelled') then i.status
      when v_paid + v_cred >= i.total then (case when v_paid = 0 and v_cred > 0 then 'credited' else 'paid' end)
      when v_paid > 0 then 'partially_paid'
      else 'sent' end
   where id = p_invoice;
end $$;

create function public.invoice_issue_credit_note(p_invoice uuid, p_amount numeric, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_prev jsonb; v_id uuid := gen_random_uuid(); v_amount numeric := round(coalesce(p_amount, 0), 2); v_number text; v_left numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  v_prev := public._idem_check(i.business_id, p_key, 'credit_note'); if v_prev is not null then return v_prev; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if i.status not in ('sent', 'partially_paid') then raise exception 'a credit note can only be issued on a sent invoice that is not fully paid' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if v_amount <= 0 then raise exception 'enter the amount to credit' using errcode = '22023'; end if;
  v_left := i.total - i.credited - i.amount_paid;
  if v_amount > v_left then raise exception 'that is more than the balance of %', to_char(v_left, 'FM999G999G999G990D00') using errcode = '22023'; end if;
  v_number := public._next_number(i.business_id, 'credit_note', 'CN');
  insert into public.invoice_credit_notes (id, business_id, invoice_id, number, amount, reason, idempotency_key)
  values (v_id, i.business_id, p_invoice, v_number, v_amount, btrim(p_reason), p_key);
  perform public._invoice_recompute(p_invoice);
  return public._idem_store(i.business_id, p_key, 'credit_note', jsonb_build_object('credit_note_id', v_id, 'number', v_number, 'status', (select status from public.invoices where id = p_invoice)));
end $$;

-- A payment cannot be more than what is still owed after credits.
create or replace function public.invoice_record_payment(p_invoice uuid, p_amount numeric, p_method text, p_paid_on date, p_reference text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_prev jsonb; v_id uuid := gen_random_uuid(); v_amount numeric := round(coalesce(p_amount, 0), 2); v_date date := coalesce(p_paid_on, current_date); v_left numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  v_prev := public._idem_check(i.business_id, p_key, 'invoice_payment'); if v_prev is not null then return v_prev; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if i.status not in ('sent', 'partially_paid') then raise exception 'payments can only be recorded on a sent invoice that is not fully paid' using errcode = '22023'; end if;
  if v_amount <= 0 then raise exception 'enter the amount received' using errcode = '22023'; end if;
  v_left := i.total - i.credited - i.amount_paid;
  if v_amount > v_left then raise exception 'that is more than the balance of %', to_char(v_left, 'FM999G999G999G990D00') using errcode = '22023'; end if;
  if v_date > current_date then raise exception 'the payment date cannot be in the future' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'card', 'pos', 'other') then raise exception 'choose how it was paid' using errcode = '22023'; end if;
  insert into public.invoice_payments (id, business_id, invoice_id, amount, method, paid_on, reference, idempotency_key)
  values (v_id, i.business_id, p_invoice, v_amount, p_method, v_date, nullif(btrim(coalesce(p_reference, '')), ''), p_key);
  perform public._invoice_recompute(p_invoice);
  return public._idem_store(i.business_id, p_key, 'invoice_payment', jsonb_build_object('payment_id', v_id, 'amount_paid', (select amount_paid from public.invoices where id = p_invoice), 'status', (select status from public.invoices where id = p_invoice)));
end $$;

-- An invoice with credit notes is kept, not cancelled.
create or replace function public.invoice_cancel(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = '22023'; end if;
  perform public._guard(i.business_id, 'invoices', 'invoices.manage');
  select * into i from public.invoices where id = p_invoice for update;
  if i.status = 'cancelled' then raise exception 'the invoice is already cancelled' using errcode = '22023'; end if;
  if exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'successful') then raise exception 'reverse the payments on this invoice before cancelling it' using errcode = '22023'; end if;
  if exists (select 1 from public.invoice_credit_notes where invoice_id = p_invoice) then raise exception 'this invoice has credit notes, so it cannot be cancelled' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.invoices set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_invoice;
end $$;

create or replace function public.invoice_summary(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_module_permission(p_business, 'invoices', 'invoices.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'outstanding', (select coalesce(sum(total - credited - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid')),
    'overdue', (select coalesce(sum(total - credited - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on < current_date),
    'overdue_count', (select count(*) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on < current_date),
    'paid_this_month', (select coalesce(sum(amount), 0) from public.invoice_payments where business_id = p_business and status = 'successful' and paid_on >= date_trunc('month', current_date)::date),
    'drafts', (select count(*) from public.invoices where business_id = p_business and status = 'draft'),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.invoices where business_id = p_business group by status) s), '{}'::jsonb));
end $$;

-- Finance reads what is still owed after credit notes.
create or replace view public.receivables with (security_invoker = true) as
select s.id as sale_id, s.business_id, s.sale_number, s.customer_id, c.name as customer_name, s.sold_at,
  s.grand_total, s.amount_paid, s.balance_due, (current_date - s.sold_at::date) as age_days, 'sale'::text as source
from public.sales s left join public.customers c on c.business_id = s.business_id and c.id = s.customer_id
where s.status <> 'voided' and s.balance_due > 0
union all
select i.id, i.business_id, i.number, i.customer_id, c.name, i.issued_on::timestamptz,
  (i.total - i.credited)::numeric(14, 2), i.amount_paid, (i.total - i.credited - i.amount_paid)::numeric(14, 2), (current_date - i.issued_on), 'invoice'::text
from public.invoices i join public.customers c on c.business_id = i.business_id and c.id = i.customer_id
where i.status in ('sent', 'partially_paid') and i.total - i.credited - i.amount_paid > 0;

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
  select coalesce(sum(total - credited), 0) into v_invoiced from public.invoices where business_id = p_business and status in ('sent', 'partially_paid', 'paid', 'credited') and issued_on between p_from and p_to;
  return jsonb_build_object(
    'sales_count', v_sales_n, 'sales_total', v_sales, 'purchases_total', v_purchases, 'expenses_total', v_expenses,
    'expenses_by_category', v_by_cat, 'cash_in', v_cash_in, 'cash_out', v_cash_out, 'operating_surplus', v_cash_in - v_cash_out,
    'receivables_open', v_receivable, 'payables_open', v_payable, 'stock_value', v_stock, 'invoiced_total', v_invoiced);
end $$;

revoke execute on function public.invoice_credit_notes_guard(), public.invoice_issue_credit_note(uuid, numeric, text, text) from public;
grant execute on function public.invoice_issue_credit_note(uuid, numeric, text, text) to authenticated;
