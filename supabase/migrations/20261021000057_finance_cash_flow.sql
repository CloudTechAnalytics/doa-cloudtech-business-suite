-- Finance: a cash-flow report for any period, worked out on the server from the cashbook.
--   * Opening balance (all money in less money out before the period), money in and out, and the closing balance, so the period always reconciles.
--   * By month, and by where the money came from and went: sales and invoice payments in; supplier payments, refunds and each expense category out.
--   * "Where the money is": the running balance for each way of paying (cash, bank transfer, card, POS) up to the end of the period.
--   * "Expected": invoices past due, and invoices due in the next 30 days, from what is still owed on them (after credit notes and payments).
-- Read-only; needs the finance reports permission, like report_summary. Cash basis: this is money moved, not profit.
-- Additive. Rollback: drop the function.

create function public.finance_cash_flow(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz;
  v_open numeric; v_in numeric; v_out numeric;
begin
  if not public.has_module_permission(p_business, 'reports', 'reports.finance.read', 'use') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'choose a valid period' using errcode = '22023'; end if;
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_open from public.cashbook where business_id = p_business and entry_at < v_from;
  select coalesce(sum(amount) filter (where direction = 'in'), 0), coalesce(sum(amount) filter (where direction = 'out'), 0) into v_in, v_out
    from public.cashbook where business_id = p_business and entry_at >= v_from and entry_at < v_to;
  return jsonb_build_object(
    'opening', v_open, 'in_total', v_in, 'out_total', v_out, 'closing', v_open + v_in - v_out,
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'in', i, 'out', o) order by m) from (
        select to_char(entry_at, 'YYYY-MM') m, coalesce(sum(amount) filter (where direction = 'in'), 0) i, coalesce(sum(amount) filter (where direction = 'out'), 0) o
          from public.cashbook where business_id = p_business and entry_at >= v_from and entry_at < v_to group by 1) x), '[]'::jsonb),
    'in_by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'total', t) order by t desc) from (
        select kind, sum(amount) t from public.cashbook where business_id = p_business and direction = 'in' and entry_at >= v_from and entry_at < v_to group by kind) x), '[]'::jsonb),
    'out_by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'category', category, 'total', t) order by t desc) from (
        select c.kind, e.category, sum(c.amount) t from public.cashbook c left join public.expenses e on c.kind = 'expense' and e.id = c.source_id
         where c.business_id = p_business and c.direction = 'out' and c.entry_at >= v_from and c.entry_at < v_to group by c.kind, e.category) x), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'balance', b) order by b desc) from (
        select method, sum(case when direction = 'in' then amount else -amount end) b from public.cashbook where business_id = p_business and entry_at < v_to group by method) x), '[]'::jsonb),
    'expected', jsonb_build_object(
      'overdue', (select coalesce(sum(total - credited - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on < current_date),
      'due_30', (select coalesce(sum(total - credited - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on between current_date and current_date + 30),
      'no_date', (select coalesce(sum(total - credited - amount_paid), 0) from public.invoices where business_id = p_business and status in ('sent', 'partially_paid') and due_on is null)));
end $$;

revoke execute on function public.finance_cash_flow(uuid, date, date) from public;
grant execute on function public.finance_cash_flow(uuid, date, date) to authenticated;
