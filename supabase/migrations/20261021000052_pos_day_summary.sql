-- POS: the end-of-day summary a shop owner expects from a till. For one day in the business's own time zone it adds up what was sold, what was handed back, what was
-- collected and how (cash, transfer, card...), what is still owed, who sold what, and the best sellers.
--   * Sales counted are those sold that day that were not voided; returns are the ones recorded that day; money collected is the payments received that day
--     (refunds paid out are taken off), whichever day the sale was made.
--   * Reading needs the same permission as reading sales. Nothing is written.
-- Additive. Rollback: drop the function.

create function public.sales_day_summary(p_business uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_day date := coalesce(p_day, current_date); r jsonb;
begin
  if not public.has_module_permission(p_business, 'sales', 'sales.read', 'read') then raise exception 'permission denied' using errcode = '42501'; end if;
  select coalesce(nullif(timezone, ''), 'UTC') into v_tz from public.businesses where id = p_business;
  if v_tz is null then v_tz := 'UTC'; end if;
  select jsonb_build_object(
    'day', v_day,
    'sales_count', (select count(*) from public.sales s where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'gross', (select coalesce(sum(grand_total), 0) from public.sales s where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'discounts', (select coalesce(sum(discount_total), 0) from public.sales s where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'tax', (select coalesce(sum(tax_total), 0) from public.sales s where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'returns', (select coalesce(sum(total_amount), 0) from public.sale_returns x where x.business_id = p_business and (x.created_at at time zone v_tz)::date = v_day),
    'outstanding', (select coalesce(sum(balance_due), 0) from public.sales s where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'voided_count', (select count(*) from public.sales s where s.business_id = p_business and s.status = 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'voided_total', (select coalesce(sum(grand_total), 0) from public.sales s where s.business_id = p_business and s.status = 'voided' and (s.sold_at at time zone v_tz)::date = v_day),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m, 'amount', a) order by a desc) from (
        select p.payment_method as m, sum(case when p.payment_type = 'sale_receipt' then p.amount else -p.amount end) as a
          from public.payments p where p.business_id = p_business and p.status = 'successful' and p.sale_id is not null and p.payment_type in ('sale_receipt', 'refund')
           and (coalesce(p.received_at, p.created_at) at time zone v_tz)::date = v_day group by p.payment_method) x where a <> 0), '[]'::jsonb),
    'by_cashier', coalesce((select jsonb_agg(jsonb_build_object('cashier', c, 'sales', n, 'total', t) order by t desc) from (
        select coalesce(pr.display_name, 'Unknown') as c, count(*) as n, sum(s.grand_total) as t
          from public.sales s left join public.profiles pr on pr.id = s.created_by
         where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day group by 1) y), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', nm, 'quantity', q, 'total', t) order by t desc) from (
        select i.description_snapshot as nm, sum(i.quantity) as q, sum(i.line_total) as t
          from public.sale_items i join public.sales s on s.business_id = i.business_id and s.id = i.sale_id
         where s.business_id = p_business and s.status <> 'voided' and (s.sold_at at time zone v_tz)::date = v_day group by 1 order by sum(i.line_total) desc limit 5) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function public.sales_day_summary(uuid, date) from public;
grant execute on function public.sales_day_summary(uuid, date) to authenticated;
