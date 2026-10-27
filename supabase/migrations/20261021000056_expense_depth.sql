-- Expenses: your own categories, monthly budgets against actual spending, and a spending report.
--   * A category is a short name in lower case with underscores (feed, marketing, staff_welfare). The ten the farm started with still work; a business can now use
--     any other, because a shop or a consultancy does not spend on feed. The screens turn "Staff welfare" into staff_welfare and back.
--   * A monthly budget is an amount per category that applies to every month until it is changed or removed. expense_budget_status() puts it next to what was
--     actually spent (posted expenses only, voided ones are left out) for any month.
--   * expense_report() adds up a period on the server: by category, month, payment method and supplier.
-- Additive. Rollback: drop the table and the two read functions, restore the category check and the old record_expense().

alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category ~ '^[a-z][a-z0-9_]{1,39}$');

create or replace function public.record_expense(
  p_business uuid, p_category text, p_amount numeric, p_method text, p_description text, p_date date,
  p_supplier uuid, p_batch uuid, p_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_number text;
begin
  perform public._guard_any(p_business, array['expenses', 'farm-expenses'], 'expenses.record');
  v_prev := public._idem_check(p_business, p_key, 'expense_record'); if v_prev is not null then return v_prev; end if;
  if p_category is null or p_category !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'choose a category (letters, numbers and underscores, 2 to 40 characters)' using errcode = '22023'; end if;
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

-- ------------------------------------------------------------------ budgets
create table public.expense_budgets (
  business_id uuid not null references public.businesses (id) on delete cascade,
  category text not null check (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  monthly_amount numeric(14, 2) not null check (monthly_amount > 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (business_id, category)
);
alter table public.expense_budgets enable row level security;
create policy expense_budgets_select on public.expense_budgets for select to authenticated using (
  public.has_module_permission(business_id, 'expenses', 'expenses.read', 'read')
  or public.has_module_permission(business_id, 'farm-expenses', 'expenses.read', 'read'));
grant select on public.expense_budgets to authenticated;
create trigger audit_expense_budgets after insert or update on public.expense_budgets for each row execute function public.audit_row_change();

-- Sets the monthly budget for a category; an amount of zero or nothing removes it.
create function public.expense_set_budget(p_business uuid, p_category text, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  perform public._guard_any(p_business, array['expenses', 'farm-expenses'], 'expenses.record');
  if p_category is null or p_category !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'choose a category' using errcode = '22023'; end if;
  if v_amount < 0 then raise exception 'a budget cannot be negative' using errcode = '22023'; end if;
  if v_amount = 0 then
    if exists (select 1 from public.expense_budgets where business_id = p_business and category = p_category) then
      delete from public.expense_budgets where business_id = p_business and category = p_category;
      insert into public.audit_logs (business_id, actor_user_id, action, entity_type, metadata)
      values (p_business, auth.uid(), 'expense_budgets.delete', 'expense_budgets', jsonb_build_object('name', p_category));
    end if;
  else
    insert into public.expense_budgets (business_id, category, monthly_amount, updated_by) values (p_business, p_category, v_amount, auth.uid())
    on conflict (business_id, category) do update set monthly_amount = excluded.monthly_amount, updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;

-- Budget next to actual spending for the month that contains p_month. A category with spending but no budget is listed with a null budget.
create function public.expense_budget_status(p_business uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not (public.has_module_permission(p_business, 'expenses', 'expenses.read', 'read') or public.has_module_permission(p_business, 'farm-expenses', 'expenses.read', 'read')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object('month', v_from, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('category', c.category, 'budget', b.monthly_amount, 'spent', coalesce(s.spent, 0)) order by c.category)
    from (select category from public.expense_budgets where business_id = p_business
          union select category from public.expenses where business_id = p_business and status = 'posted' and expense_date >= v_from and expense_date < v_from + interval '1 month') c
    left join public.expense_budgets b on b.business_id = p_business and b.category = c.category
    left join (select category, sum(amount) as spent from public.expenses where business_id = p_business and status = 'posted' and expense_date >= v_from and expense_date < v_from + interval '1 month' group by category) s on s.category = c.category
  ), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------- report
create function public.expense_report(p_business uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_module_permission(p_business, 'expenses', 'expenses.read', 'read') or public.has_module_permission(p_business, 'farm-expenses', 'expenses.read', 'read')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'choose a valid period' using errcode = '22023'; end if;
  return jsonb_build_object(
    'total', (select coalesce(sum(amount), 0) from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to),
    'count', (select count(*) from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'total', t, 'count', n) order by t desc) from (
        select category, sum(amount) t, count(*) n from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to group by category) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'total', t) order by m) from (
        select to_char(expense_date, 'YYYY-MM') m, sum(amount) t from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to group by 1) x), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', payment_method, 'total', t) order by t desc) from (
        select payment_method, sum(amount) t from public.expenses where business_id = p_business and status = 'posted' and expense_date between p_from and p_to group by 1) x), '[]'::jsonb),
    'by_supplier', coalesce((select jsonb_agg(jsonb_build_object('supplier', name, 'total', t) order by t desc) from (
        select sp.name, sum(e.amount) t from public.expenses e join public.suppliers sp on sp.business_id = e.business_id and sp.id = e.supplier_id
         where e.business_id = p_business and e.status = 'posted' and e.expense_date between p_from and p_to group by sp.name order by t desc limit 10) x), '[]'::jsonb));
end $$;

revoke execute on function public.expense_set_budget(uuid, text, numeric), public.expense_budget_status(uuid, date), public.expense_report(uuid, date, date) from public;
grant execute on function public.expense_set_budget(uuid, text, numeric), public.expense_budget_status(uuid, date), public.expense_report(uuid, date, date) to authenticated;
