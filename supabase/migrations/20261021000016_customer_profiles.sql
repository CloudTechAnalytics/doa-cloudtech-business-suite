-- Customer profiles: fuller contact details, a per-customer summary from the sales records, and a "what they buy" list.
--   * Details are plain columns on customers; writes stay behind the existing RLS policies and column grants.
--   * The summary and the product list are worked out from sales, never stored, so they always match the sales screens.
--     Spend is net of tax and returns, excludes voided sales, and only roles that can read sales see non-zero figures.
-- Additive. Rollback: drop the view and function and the four new columns.

alter table public.customers
  add column company text check (company is null or length(btrim(company)) between 1 and 200),
  add column contact_person text check (contact_person is null or length(btrim(contact_person)) between 1 and 160),
  add column city text check (city is null or length(btrim(city)) between 1 and 120),
  add column notes text check (notes is null or length(notes) <= 2000);
grant insert (company, contact_person, city, notes) on public.customers to authenticated;
grant update (company, contact_person, city, notes) on public.customers to authenticated;

create view public.customer_summary with (security_invoker = true) as
select c.id as customer_id, c.business_id,
  count(s.id) as orders,
  coalesce(sum(s.grand_total - s.tax_total - s.returned_total), 0) as lifetime_spend,
  coalesce(sum(s.amount_paid), 0) as paid,
  coalesce(sum(s.balance_due), 0) as outstanding,
  min(s.sold_at) as first_purchase_at,
  max(s.sold_at) as last_purchase_at
from public.customers c
left join public.sales s on s.business_id = c.business_id and s.customer_id = c.id and s.status <> 'voided'
group by c.id, c.business_id;
grant select on public.customer_summary to authenticated;

-- The customer's most-bought products by net revenue: [{product, units, revenue}].
create function public.customer_top_products(p_customer uuid, p_limit integer default 5) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if not found or not public.has_module_permission(c.business_id, 'customers', 'customers.read', 'read')
     or not public.has_module_permission(c.business_id, 'sales', 'sales.read', 'read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x) from (
      select si.description_snapshot as product, sum(si.quantity) as units, sum(si.line_total - si.tax_amount) as revenue
      from public.sale_items si join public.sales s on s.business_id = si.business_id and s.id = si.sale_id
      where s.customer_id = p_customer and s.status <> 'voided'
      group by si.description_snapshot order by sum(si.line_total - si.tax_amount) desc limit least(greatest(coalesce(p_limit, 5), 1), 20)
    ) x), '[]'::jsonb);
end $$;
revoke execute on function public.customer_top_products(uuid, integer) from public;
grant execute on function public.customer_top_products(uuid, integer) to authenticated;

-- Customers are part of every industry's default set (they were optional for farms and bakeries), so each business has a customer page.
update public.industry_template_modules itm set is_default = true
from public.industry_templates t, public.modules m
where itm.industry_template_id = t.id and itm.module_id = m.id and t.code in ('farm', 'bakery') and m.code = 'customers';

insert into public.business_modules (business_id, module_id)
select b.id, m.id from public.businesses b, public.modules m
where b.primary_industry_code in ('farm', 'bakery') and m.code = 'customers'
on conflict (business_id, module_id) do nothing;
