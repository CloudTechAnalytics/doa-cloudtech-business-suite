-- Usage limits per plan: the free-first model needs limits that can be set per plan without changing any code.
--   * A limit is a number in subscription_plans.limits under one of these keys: customers, invoices_per_month, expenses_per_month, sales_per_month.
--     A plan with no such key has no limit (that is how every plan starts: no number is invented here; set the numbers by updating the plan data).
--   * A limit stops NEW records only. Nothing existing is locked, hidden or changed, and a plan that is lowered later never takes records away.
--   * It is enforced in the database by a trigger on each table, so no screen, import or API call can skip it. The interface only explains it.
--   * my_usage() tells a member how much of each limit is used, so the screens can warn before the limit is reached.
-- Additive. Rollback: drop the triggers and functions created here.

create function public._plan_limit(p_business uuid, p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select (p.limits ->> p_key)::integer from public.subscription_plans p where p.id = public.entitled_plan(p_business);
$$;

create function public._usage(p_business uuid, p_key text) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_month timestamptz := date_trunc('month', now()); v_n integer;
begin
  if p_key = 'customers' then select count(*) into v_n from public.customers where business_id = p_business and status = 'active';
  elsif p_key = 'invoices_per_month' then select count(*) into v_n from public.invoices where business_id = p_business and status <> 'cancelled' and created_at >= v_month;
  elsif p_key = 'expenses_per_month' then select count(*) into v_n from public.expenses where business_id = p_business and status = 'posted' and created_at >= v_month;
  elsif p_key = 'sales_per_month' then select count(*) into v_n from public.sales where business_id = p_business and status <> 'voided' and sold_at >= v_month;
  else raise exception 'unknown usage key' using errcode = '22023'; end if;
  return v_n;
end $$;

-- Before a new record: stop it if the plan's limit for this kind of record is already used up.
create function public.enforce_usage_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text := tg_argv[0]; v_limit integer;
begin
  v_limit := public._plan_limit(new.business_id, v_key);
  if v_limit is not null and public._usage(new.business_id, v_key) >= v_limit then
    raise exception 'plan limit reached: your plan allows % %. Upgrade the plan to add more; everything you already have is kept.', v_limit,
      case v_key when 'customers' then 'customers' when 'invoices_per_month' then 'invoices a month' when 'expenses_per_month' then 'expenses a month' else 'sales a month' end
      using errcode = '53400';
  end if;
  return new;
end $$;

create trigger customers_usage_limit before insert on public.customers for each row execute function public.enforce_usage_limit('customers');
create trigger invoices_usage_limit before insert on public.invoices for each row execute function public.enforce_usage_limit('invoices_per_month');
create trigger expenses_usage_limit before insert on public.expenses for each row execute function public.enforce_usage_limit('expenses_per_month');
create trigger sales_usage_limit before insert on public.sales for each row execute function public.enforce_usage_limit('sales_per_month');

-- Used and allowed for each limit (limit null = no limit on this plan).
create function public.my_usage(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_member(p_business) then raise exception 'permission denied' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'used', public._usage(p_business, k), 'limit', public._plan_limit(p_business, k)) order by o), '[]'::jsonb)
          from (values ('customers', 1), ('invoices_per_month', 2), ('sales_per_month', 3), ('expenses_per_month', 4)) as x (k, o));
end $$;

revoke execute on function public._plan_limit(uuid, text), public._usage(uuid, text), public.enforce_usage_limit(), public.my_usage(uuid) from public;
grant execute on function public.my_usage(uuid) to authenticated;
